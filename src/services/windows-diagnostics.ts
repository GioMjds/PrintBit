import edge from 'edge-js';
import { runPowerShell } from '@/utils';

export type WindowsDiagnosticsProvider = 'auto' | 'edge' | 'powershell';

export interface WindowsDiagnosticsPrinter {
  name: string;
  driverName: string | null;
  portName: string | null;
  isDefault: boolean;
  printerStatus: number | null;
  printerState: number | null;
  workOffline: boolean | null;
  pnpInstanceId: string | null;
  pnpFriendlyName: string | null;
  pnpStatus: string | null;
  pnpPresent: boolean | null;
  pnpProblem: number | null;
  capabilities: {
    supportsColor: boolean | null;
    supportsDuplex: boolean | null;
    paperSizes: string[];
  };
}

export interface WindowsDiagnosticsScanner {
  name: string;
  deviceId: string | null;
  manufacturer: string | null;
  description: string | null;
  driverType: 'wia' | 'pnp';
  status: string | null;
  present: boolean | null;
  problem: number | null;
  pnpClass: string | null;
  service: string | null;
  hasFlatbed: boolean | null;
  hasDocumentFeeder: boolean | null;
  feederLoaded: boolean | null;
  documentHandlingCapabilities: number | null;
  documentHandlingStatus: number | null;
  diagnosticError: string | null;
}

export interface WindowsDiagnosticsPrintJob {
  id: number;
  name: string;
  printerName: string | null;
  status: string | null;
  jobStatus: string | null;
  totalPages: number | null;
  pagesPrinted: number | null;
  submittedAt: string | null;
}

export interface WindowsDiagnosticsSnapshot {
  provider: 'edge' | 'powershell';
  queriedAt: string;
  ok: boolean;
  error: string | null;
  spooler: {
    status: string | null;
    canStop: boolean | null;
  };
  selectedPrinterName: string | null;
  printers: WindowsDiagnosticsPrinter[];
  scanners: WindowsDiagnosticsScanner[];
  jobs: WindowsDiagnosticsPrintJob[];
  bridgeFailure?: {
    provider: 'edge' | 'powershell';
    message: string;
  } | null;
}

type EdgeBridge = (
  payload: Record<string, unknown>,
  callback: (error: Error | null, result?: unknown) => void,
) => void;

let edgeBridge: EdgeBridge | null | undefined;

function configuredProvider(): WindowsDiagnosticsProvider {
  const raw =
    process.env.PRINTBIT_WINDOWS_DIAGNOSTICS_PROVIDER?.trim().toLowerCase();
  if (raw === 'edge' || raw === 'powershell' || raw === 'auto') return raw;
  return 'auto';
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === '0') return false;
  if (value === 1 || value === '1') return true;
  return null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeString(item))
    .filter((item): item is string => item !== null);
}

function getEdgeBridge(): EdgeBridge {
  if (edgeBridge !== undefined) {
    if (!edgeBridge) throw new Error('edge-js bridge is unavailable.');
    return edgeBridge;
  }

  if (process.platform !== 'win32') {
    edgeBridge = null;
    throw new Error('edge-js Windows diagnostics require win32.');
  }

  edgeBridge = edge.func(`
    #r "System.Management.dll"
    #r "System.ServiceProcess.dll"
    #r "System.Drawing.dll"

    using System;
    using System.Collections.Generic;
    using System.Drawing.Printing;
    using System.Linq;
    using System.Management;
    using System.ServiceProcess;
    using System.Threading.Tasks;

    public class Startup
    {
      public async Task<object> Invoke(dynamic input)
      {
        string selected = null;
        try { selected = (string)input.selectedPrinterName; } catch {}

        var printers = new List<Dictionary<string, object>>();
        var pnpDevices = new List<Dictionary<string, object>>();
        var scanners = new List<Dictionary<string, object>>();
        var jobs = new List<Dictionary<string, object>>();

        using (var searcher = new ManagementObjectSearcher("SELECT Name, DriverName, PortName, Default, PrinterStatus, PrinterState, WorkOffline FROM Win32_Printer"))
        {
          foreach (ManagementObject printer in searcher.Get())
          {
            var name = Convert.ToString(printer["Name"]);
            var caps = GetCapabilities(name);
            printers.Add(new Dictionary<string, object> {
              { "name", name },
              { "driverName", Convert.ToString(printer["DriverName"]) },
              { "portName", Convert.ToString(printer["PortName"]) },
              { "isDefault", Convert.ToBoolean(printer["Default"] ?? false) },
              { "printerStatus", ToNullableInt(printer["PrinterStatus"]) },
              { "printerState", ToNullableInt(printer["PrinterState"]) },
              { "workOffline", printer["WorkOffline"] == null ? null : (object)Convert.ToBoolean(printer["WorkOffline"]) },
              { "capabilities", caps }
            });
          }
        }

        try
        {
          using (var searcher = new ManagementObjectSearcher("SELECT Name, DeviceID, PNPClass, Service, Status, Present, ConfigManagerErrorCode FROM Win32_PnPEntity WHERE PNPClass = 'Printer' OR Service = 'usbprint' OR PNPClass = 'Image' OR PNPClass = 'Camera' OR Service = 'usbscan' OR Name LIKE '%scanner%'"))
          {
            foreach (ManagementObject device in searcher.Get())
            {
              pnpDevices.Add(new Dictionary<string, object> {
                { "friendlyName", Convert.ToString(device["Name"]) },
                { "instanceId", Convert.ToString(device["DeviceID"]) },
                { "pnpClass", Convert.ToString(device["PNPClass"]) },
                { "service", Convert.ToString(device["Service"]) },
                { "status", Convert.ToString(device["Status"]) },
                { "present", device["Present"] == null ? null : (object)Convert.ToBoolean(device["Present"]) },
                { "problem", ToNullableInt(device["ConfigManagerErrorCode"]) }
              });
            }
          }
        }
        catch {}

        try
        {
          using (var searcher = new ManagementObjectSearcher("SELECT JobId, Name, Status, JobStatus, TotalPages, PagesPrinted, TimeSubmitted FROM Win32_PrintJob"))
          {
            foreach (ManagementObject job in searcher.Get())
            {
              var name = Convert.ToString(job["Name"]);
              jobs.Add(new Dictionary<string, object> {
                { "id", ToNullableInt(job["JobId"]) ?? 0 },
                { "name", name },
                { "printerName", PrinterNameFromJobName(name) },
                { "status", Convert.ToString(job["Status"]) },
                { "jobStatus", Convert.ToString(job["JobStatus"]) },
                { "totalPages", ToNullableInt(job["TotalPages"]) },
                { "pagesPrinted", ToNullableInt(job["PagesPrinted"]) },
                { "submittedAt", WmiDateToIso(job["TimeSubmitted"]) }
              });
            }
          }
        }
        catch {}

        scanners = GetWiaScanners(pnpDevices);
        AddPnpOnlyScanners(scanners, pnpDevices);

        foreach (var printer in printers)
        {
          var matched = MatchPnp(printer, pnpDevices);
          printer["pnpInstanceId"] = matched == null ? null : matched["instanceId"];
          printer["pnpFriendlyName"] = matched == null ? null : matched["friendlyName"];
          printer["pnpStatus"] = matched == null ? null : matched["status"];
          printer["pnpPresent"] = matched == null ? null : matched["present"];
          printer["pnpProblem"] = matched == null ? null : matched["problem"];
        }

        string spoolerStatus = null;
        bool? canStop = null;
        try
        {
          using (var spooler = new ServiceController("Spooler"))
          {
            spoolerStatus = spooler.Status.ToString();
            canStop = spooler.CanStop;
          }
        }
        catch {}

        return new Dictionary<string, object> {
          { "provider", "edge" },
          { "queriedAt", DateTimeOffset.UtcNow.ToString("o") },
          { "ok", true },
          { "error", null },
          { "selectedPrinterName", selected },
          { "spooler", new Dictionary<string, object> {
            { "status", spoolerStatus },
            { "canStop", canStop }
          }},
          { "printers", printers },
          { "scanners", scanners },
          { "jobs", jobs }
        };
      }

      private static int? ToNullableInt(object value)
      {
        if (value == null) return null;
        try { return Convert.ToInt32(value); } catch { return null; }
      }

      private static string WmiDateToIso(object value)
      {
        if (value == null) return null;
        try
        {
          return ManagementDateTimeConverter.ToDateTime(Convert.ToString(value)).ToUniversalTime().ToString("o");
        }
        catch { return null; }
      }

      private static string PrinterNameFromJobName(string value)
      {
        if (String.IsNullOrWhiteSpace(value)) return null;
        var idx = value.LastIndexOf(',');
        if (idx <= 0) return value;
        return value.Substring(0, idx);
      }

      private static Dictionary<string, object> GetCapabilities(string printerName)
      {
        bool? supportsDuplex = null;
        bool? supportsColor = null;
        var paperSizes = new List<string>();
        try
        {
          var settings = new PrinterSettings();
          settings.PrinterName = printerName;
          if (settings.IsValid)
          {
            supportsDuplex = settings.CanDuplex;
            supportsColor = settings.SupportsColor;
            foreach (PaperSize paper in settings.PaperSizes)
            {
              paperSizes.Add(paper.PaperName);
            }
          }
        }
        catch {}
        return new Dictionary<string, object> {
          { "supportsDuplex", supportsDuplex },
          { "supportsColor", supportsColor },
          { "paperSizes", paperSizes.ToArray() }
        };
      }

      private static List<Dictionary<string, object>> GetWiaScanners(List<Dictionary<string, object>> pnpDevices)
      {
        var scanners = new List<Dictionary<string, object>>();
        try
        {
          var managerType = Type.GetTypeFromProgID("WIA.DeviceManager");
          if (managerType == null) return scanners;

          dynamic manager = Activator.CreateInstance(managerType);
          foreach (dynamic deviceInfo in manager.DeviceInfos)
          {
            int? type = ToNullableInt(deviceInfo.Type);
            if (type != 1) continue;

            var infoProps = ReadComProperties(deviceInfo.Properties);
            var deviceId = FirstString(infoProps, new [] { "DeviceID", "Unique Device ID", "2" });
            var name = FirstString(infoProps, new [] { "Name", "Description", "7" }) ?? "WIA scanner";
            var manufacturer = FirstString(infoProps, new [] { "Manufacturer", "3" });
            var description = FirstString(infoProps, new [] { "Description", "4" });
            var matched = MatchScannerPnp(name, deviceId, pnpDevices);

            int? handlingCapabilities = null;
            int? handlingStatus = null;
            string diagnosticError = null;
            try
            {
              dynamic device = deviceInfo.Connect();
              var deviceProps = ReadComProperties(device.Properties);
              handlingCapabilities = FirstInt(deviceProps, new [] { "Document Handling Capabilities", "3086" });
              handlingStatus = FirstInt(deviceProps, new [] { "Document Handling Status", "3087" });
            }
            catch (Exception ex)
            {
              diagnosticError = ex.Message;
            }

            bool? hasFeeder = handlingCapabilities == null ? (bool?)null : (handlingCapabilities.Value & 1) != 0;
            bool? hasFlatbed = handlingCapabilities == null ? (bool?)null : (handlingCapabilities.Value & 2) != 0;
            bool? feederLoaded = handlingStatus == null ? (bool?)null : (handlingStatus.Value & 1) != 0;

            scanners.Add(new Dictionary<string, object> {
              { "name", name },
              { "deviceId", deviceId },
              { "manufacturer", manufacturer },
              { "description", description },
              { "driverType", "wia" },
              { "status", matched == null ? null : matched["status"] },
              { "present", matched == null ? null : matched["present"] },
              { "problem", matched == null ? null : matched["problem"] },
              { "pnpClass", matched == null ? null : matched["pnpClass"] },
              { "service", matched == null ? null : matched["service"] },
              { "hasFlatbed", hasFlatbed },
              { "hasDocumentFeeder", hasFeeder },
              { "feederLoaded", feederLoaded },
              { "documentHandlingCapabilities", handlingCapabilities },
              { "documentHandlingStatus", handlingStatus },
              { "diagnosticError", diagnosticError }
            });
          }
        }
        catch {}

        return scanners;
      }

      private static Dictionary<string, object> ReadComProperties(dynamic properties)
      {
        var result = new Dictionary<string, object>();
        try
        {
          foreach (dynamic prop in properties)
          {
            string name = Convert.ToString(prop.Name);
            string id = Convert.ToString(prop.PropertyID);
            object value = null;
            try { value = prop.Value; } catch {}
            if (!String.IsNullOrWhiteSpace(name)) result[name] = value;
            if (!String.IsNullOrWhiteSpace(id)) result[id] = value;
          }
        }
        catch {}
        return result;
      }

      private static string FirstString(Dictionary<string, object> props, string[] keys)
      {
        foreach (var key in keys)
        {
          if (props.ContainsKey(key) && props[key] != null)
          {
            var value = Convert.ToString(props[key]);
            if (!String.IsNullOrWhiteSpace(value)) return value;
          }
        }
        return null;
      }

      private static int? FirstInt(Dictionary<string, object> props, string[] keys)
      {
        foreach (var key in keys)
        {
          if (props.ContainsKey(key))
          {
            var value = ToNullableInt(props[key]);
            if (value != null) return value;
          }
        }
        return null;
      }

      private static void AddPnpOnlyScanners(List<Dictionary<string, object>> scanners, List<Dictionary<string, object>> pnpDevices)
      {
        foreach (var device in pnpDevices)
        {
          var pnpClass = Normalize(Convert.ToString(device.ContainsKey("pnpClass") ? device["pnpClass"] : null));
          var service = Normalize(Convert.ToString(device.ContainsKey("service") ? device["service"] : null));
          var friendly = Convert.ToString(device["friendlyName"]);
          var normalizedFriendly = Normalize(friendly);
          var looksLikeScanner =
            pnpClass == "image" ||
            pnpClass == "camera" ||
            service == "usbscan" ||
            normalizedFriendly.Contains("scanner");
          if (!looksLikeScanner) continue;
          if (scanners.Any(scanner => Normalize(Convert.ToString(scanner["name"])) == normalizedFriendly)) continue;

          scanners.Add(new Dictionary<string, object> {
            { "name", friendly },
            { "deviceId", device["instanceId"] },
            { "manufacturer", null },
            { "description", friendly },
            { "driverType", "pnp" },
            { "status", device["status"] },
            { "present", device["present"] },
            { "problem", device["problem"] },
            { "pnpClass", device.ContainsKey("pnpClass") ? device["pnpClass"] : null },
            { "service", device.ContainsKey("service") ? device["service"] : null },
            { "hasFlatbed", null },
            { "hasDocumentFeeder", null },
            { "feederLoaded", null },
            { "documentHandlingCapabilities", null },
            { "documentHandlingStatus", null },
            { "diagnosticError", null }
          });
        }
      }

      private static Dictionary<string, object> MatchScannerPnp(string name, string deviceId, List<Dictionary<string, object>> devices)
      {
        var normalizedName = Normalize(name);
        var normalizedDeviceId = Normalize(deviceId);
        foreach (var device in devices)
        {
          var friendly = Normalize(Convert.ToString(device["friendlyName"]));
          var instanceId = Normalize(Convert.ToString(device["instanceId"]));
          if (
            (normalizedDeviceId.Length > 0 && instanceId == normalizedDeviceId) ||
            (normalizedName.Length > 0 && friendly.Length > 0 && (friendly.Contains(normalizedName) || normalizedName.Contains(friendly)))
          )
          {
            return device;
          }
        }
        return null;
      }

      private static Dictionary<string, object> MatchPnp(Dictionary<string, object> printer, List<Dictionary<string, object>> devices)
      {
        var name = Normalize(Convert.ToString(printer["name"]));
        var driver = Normalize(Convert.ToString(printer["driverName"]));
        foreach (var device in devices)
        {
          var friendly = Normalize(Convert.ToString(device["friendlyName"]));
          if (friendly == name || (friendly.Length > 0 && driver.Length > 0 && (friendly.Contains(driver) || driver.Contains(friendly))))
          {
            return device;
          }
        }
        return null;
      }

      private static string Normalize(string value)
      {
        if (String.IsNullOrWhiteSpace(value)) return "";
        return System.Text.RegularExpressions.Regex.Replace(value.Trim().ToLowerInvariant(), "\\\\s+", " ");
      }
    }
  `);

  return edgeBridge;
}

function normalizePrinter(
  row: Record<string, unknown>,
): WindowsDiagnosticsPrinter {
  const capabilities =
    row.capabilities && typeof row.capabilities === 'object'
      ? (row.capabilities as Record<string, unknown>)
      : {};
  return {
    name: normalizeString(row.name ?? row.Name) ?? '',
    driverName: normalizeString(row.driverName ?? row.DriverName),
    portName: normalizeString(row.portName ?? row.PortName),
    isDefault: normalizeBoolean(row.isDefault ?? row.Default) === true,
    printerStatus: normalizeNumber(row.printerStatus ?? row.PrinterStatus),
    printerState: normalizeNumber(row.printerState ?? row.PrinterState),
    workOffline: normalizeBoolean(row.workOffline ?? row.WorkOffline),
    pnpInstanceId: normalizeString(row.pnpInstanceId ?? row.PnpInstanceId),
    pnpFriendlyName: normalizeString(
      row.pnpFriendlyName ?? row.PnpFriendlyName,
    ),
    pnpStatus: normalizeString(row.pnpStatus ?? row.PnpStatus),
    pnpPresent: normalizeBoolean(row.pnpPresent ?? row.PnpPresent),
    pnpProblem: normalizeNumber(row.pnpProblem ?? row.PnpProblem),
    capabilities: {
      supportsColor: normalizeBoolean(
        capabilities.supportsColor ?? capabilities.SupportsColor,
      ),
      supportsDuplex: normalizeBoolean(
        capabilities.supportsDuplex ?? capabilities.SupportsDuplex,
      ),
      paperSizes: normalizeStringArray(
        capabilities.paperSizes ?? capabilities.PaperSizes,
      ),
    },
  };
}

function normalizeScanner(
  row: Record<string, unknown>,
): WindowsDiagnosticsScanner {
  const rawDriverType = normalizeString(row.driverType ?? row.DriverType);
  return {
    name: normalizeString(row.name ?? row.Name) ?? '',
    deviceId: normalizeString(row.deviceId ?? row.DeviceId ?? row.DeviceID),
    manufacturer: normalizeString(row.manufacturer ?? row.Manufacturer),
    description: normalizeString(row.description ?? row.Description),
    driverType: rawDriverType === 'pnp' ? 'pnp' : 'wia',
    status: normalizeString(row.status ?? row.Status),
    present: normalizeBoolean(row.present ?? row.Present),
    problem: normalizeNumber(row.problem ?? row.Problem),
    pnpClass: normalizeString(row.pnpClass ?? row.PnpClass ?? row.PNPClass),
    service: normalizeString(row.service ?? row.Service),
    hasFlatbed: normalizeBoolean(row.hasFlatbed ?? row.HasFlatbed),
    hasDocumentFeeder: normalizeBoolean(
      row.hasDocumentFeeder ?? row.HasDocumentFeeder,
    ),
    feederLoaded: normalizeBoolean(row.feederLoaded ?? row.FeederLoaded),
    documentHandlingCapabilities: normalizeNumber(
      row.documentHandlingCapabilities ?? row.DocumentHandlingCapabilities,
    ),
    documentHandlingStatus: normalizeNumber(
      row.documentHandlingStatus ?? row.DocumentHandlingStatus,
    ),
    diagnosticError: normalizeString(
      row.diagnosticError ?? row.DiagnosticError,
    ),
  };
}

function normalizeJob(
  row: Record<string, unknown>,
): WindowsDiagnosticsPrintJob {
  return {
    id: normalizeNumber(row.id ?? row.Id) ?? 0,
    name: normalizeString(row.name ?? row.Name) ?? '',
    printerName: normalizeString(row.printerName ?? row.PrinterName),
    status: normalizeString(row.status ?? row.Status),
    jobStatus: normalizeString(row.jobStatus ?? row.JobStatus),
    totalPages: normalizeNumber(row.totalPages ?? row.TotalPages),
    pagesPrinted: normalizeNumber(row.pagesPrinted ?? row.PagesPrinted),
    submittedAt: normalizeString(row.submittedAt ?? row.SubmittedAt),
  };
}

function normalizeSnapshot(
  value: unknown,
  provider: 'edge' | 'powershell',
  bridgeFailure: WindowsDiagnosticsSnapshot['bridgeFailure'] = null,
): WindowsDiagnosticsSnapshot {
  const row =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  const spooler =
    row.spooler && typeof row.spooler === 'object'
      ? (row.spooler as Record<string, unknown>)
      : {};
  const rawPrinters = Array.isArray(row.printers ?? row.Printers)
    ? ((row.printers ?? row.Printers) as unknown[])
    : [];
  const rawScanners = Array.isArray(row.scanners ?? row.Scanners)
    ? ((row.scanners ?? row.Scanners) as unknown[])
    : [];
  const rawJobs = Array.isArray(row.jobs ?? row.Jobs)
    ? ((row.jobs ?? row.Jobs) as unknown[])
    : [];

  return {
    provider,
    queriedAt:
      normalizeString(row.queriedAt ?? row.QueriedAt) ??
      new Date().toISOString(),
    ok: row.ok === true || row.Ok === true,
    error: normalizeString(row.error ?? row.Error),
    selectedPrinterName: normalizeString(
      row.selectedPrinterName ?? row.SelectedPrinterName,
    ),
    spooler: {
      status: normalizeString(spooler.status ?? spooler.Status),
      canStop: normalizeBoolean(spooler.canStop ?? spooler.CanStop),
    },
    printers: rawPrinters
      .filter((item): item is Record<string, unknown> => {
        return !!item && typeof item === 'object' && !Array.isArray(item);
      })
      .map(normalizePrinter)
      .filter((printer) => printer.name.length > 0),
    scanners: rawScanners
      .filter((item): item is Record<string, unknown> => {
        return !!item && typeof item === 'object' && !Array.isArray(item);
      })
      .map(normalizeScanner)
      .filter((scanner) => scanner.name.length > 0),
    jobs: rawJobs
      .filter((item): item is Record<string, unknown> => {
        return !!item && typeof item === 'object' && !Array.isArray(item);
      })
      .map(normalizeJob),
    bridgeFailure,
  };
}

function invokeEdgeBridge(
  selectedPrinterName?: string | null,
): Promise<WindowsDiagnosticsSnapshot> {
  const bridge = getEdgeBridge();
  return new Promise((resolve, reject) => {
    bridge(
      { selectedPrinterName: selectedPrinterName ?? null },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(normalizeSnapshot(result, 'edge'));
      },
    );
  });
}

async function getPowerShellSnapshot(
  selectedPrinterName?: string | null,
  bridgeFailure: WindowsDiagnosticsSnapshot['bridgeFailure'] = null,
): Promise<WindowsDiagnosticsSnapshot> {
  const escaped = selectedPrinterName?.replace(/'/g, "''") ?? '';
  const script = `
$printers = @(Get-CimInstance -ClassName Win32_Printer | ForEach-Object {
  $name = $_.Name
  $caps = [PSCustomObject]@{ SupportsColor = $null; SupportsDuplex = $null; PaperSizes = @() }
  try {
    Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue
    $settings = New-Object System.Drawing.Printing.PrinterSettings
    $settings.PrinterName = $name
    if ($settings.IsValid) {
      $paper = @()
      foreach ($p in $settings.PaperSizes) { $paper += [string]$p.PaperName }
      $caps = [PSCustomObject]@{ SupportsColor = $settings.SupportsColor; SupportsDuplex = $settings.CanDuplex; PaperSizes = $paper }
    }
  } catch {}
  [PSCustomObject]@{
    name = $name
    driverName = $_.DriverName
    portName = $_.PortName
    isDefault = $_.Default
    printerStatus = $_.PrinterStatus
    printerState = $_.PrinterState
    workOffline = $_.WorkOffline
    pnpInstanceId = $null
    pnpFriendlyName = $null
    pnpStatus = $null
    pnpPresent = $null
    pnpProblem = $null
    capabilities = $caps
  }
})
$jobs = @(Get-CimInstance -ClassName Win32_PrintJob -ErrorAction SilentlyContinue | ForEach-Object {
  [PSCustomObject]@{
    id = $_.JobId
    name = $_.Name
    printerName = if ($_.Name -match '^(.*),') { $Matches[1] } else { $null }
    status = $_.Status
    jobStatus = $_.JobStatus
    totalPages = $_.TotalPages
    pagesPrinted = $_.PagesPrinted
    submittedAt = if ($_.TimeSubmitted) { [System.Management.ManagementDateTimeConverter]::ToDateTime($_.TimeSubmitted).ToUniversalTime().ToString('o') } else { $null }
  }
})
$scanners = @()
try {
  $wia = New-Object -ComObject WIA.DeviceManager
  foreach ($info in @($wia.DeviceInfos)) {
    if ([int]$info.Type -ne 1) { continue }
    $props = @{}
    foreach ($prop in @($info.Properties)) {
      try {
        $props[[string]$prop.Name] = $prop.Value
        $props[[string]$prop.PropertyID] = $prop.Value
      } catch {}
    }
    $handlingCapabilities = $null
    $handlingStatus = $null
    $diagnosticError = $null
    try {
      $device = $info.Connect()
      $deviceProps = @{}
      foreach ($prop in @($device.Properties)) {
        try {
          $deviceProps[[string]$prop.Name] = $prop.Value
          $deviceProps[[string]$prop.PropertyID] = $prop.Value
        } catch {}
      }
      $handlingCapabilities = if ($deviceProps.ContainsKey('3086')) { [int]$deviceProps['3086'] } elseif ($deviceProps.ContainsKey('Document Handling Capabilities')) { [int]$deviceProps['Document Handling Capabilities'] } else { $null }
      $handlingStatus = if ($deviceProps.ContainsKey('3087')) { [int]$deviceProps['3087'] } elseif ($deviceProps.ContainsKey('Document Handling Status')) { [int]$deviceProps['Document Handling Status'] } else { $null }
    } catch {
      $diagnosticError = $_.Exception.Message
    }
    $scanners += [PSCustomObject]@{
      name = if ($props.ContainsKey('Name')) { [string]$props['Name'] } elseif ($props.ContainsKey('Description')) { [string]$props['Description'] } else { 'WIA scanner' }
      deviceId = if ($props.ContainsKey('DeviceID')) { [string]$props['DeviceID'] } elseif ($props.ContainsKey('2')) { [string]$props['2'] } else { $null }
      manufacturer = if ($props.ContainsKey('Manufacturer')) { [string]$props['Manufacturer'] } elseif ($props.ContainsKey('3')) { [string]$props['3'] } else { $null }
      description = if ($props.ContainsKey('Description')) { [string]$props['Description'] } elseif ($props.ContainsKey('4')) { [string]$props['4'] } else { $null }
      driverType = 'wia'
      status = $null
      present = $null
      problem = $null
      pnpClass = $null
      service = $null
      hasFlatbed = if ($handlingCapabilities -ne $null) { (($handlingCapabilities -band 2) -ne 0) } else { $null }
      hasDocumentFeeder = if ($handlingCapabilities -ne $null) { (($handlingCapabilities -band 1) -ne 0) } else { $null }
      feederLoaded = if ($handlingStatus -ne $null) { (($handlingStatus -band 1) -ne 0) } else { $null }
      documentHandlingCapabilities = $handlingCapabilities
      documentHandlingStatus = $handlingStatus
      diagnosticError = $diagnosticError
    }
  }
} catch {}
if ($scanners.Count -eq 0) {
  $scanners = @(Get-CimInstance -ClassName Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object {
    $_.PNPClass -in @('Image', 'Camera') -or $_.Service -eq 'usbscan' -or $_.Name -match 'scanner'
  } | ForEach-Object {
    [PSCustomObject]@{
      name = $_.Name
      deviceId = $_.DeviceID
      manufacturer = $null
      description = $_.Name
      driverType = 'pnp'
      status = $_.Status
      present = $_.Present
      problem = $_.ConfigManagerErrorCode
      pnpClass = $_.PNPClass
      service = $_.Service
      hasFlatbed = $null
      hasDocumentFeeder = $null
      feederLoaded = $null
      documentHandlingCapabilities = $null
      documentHandlingStatus = $null
      diagnosticError = $null
    }
  })
}
$svc = Get-Service -Name Spooler -ErrorAction SilentlyContinue
[PSCustomObject]@{
  provider = 'powershell'
  queriedAt = (Get-Date).ToUniversalTime().ToString('o')
  ok = $true
  error = $null
  selectedPrinterName = '${escaped}'
  spooler = [PSCustomObject]@{ status = if ($svc) { [string]$svc.Status } else { $null }; canStop = if ($svc) { $svc.CanStop } else { $null } }
  printers = $printers
  scanners = $scanners
  jobs = $jobs
} | ConvertTo-Json -Depth 8 -Compress
`.trim();

  let json: string | null;
  try {
    json = await runPowerShell(script, 12_000);
  } catch (error) {
    return {
      provider: 'powershell',
      queriedAt: new Date().toISOString(),
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      selectedPrinterName: selectedPrinterName ?? null,
      spooler: { status: null, canStop: null },
      printers: [],
      scanners: [],
      jobs: [],
      bridgeFailure,
    };
  }
  if (!json || json === 'null') {
    return {
      provider: 'powershell',
      queriedAt: new Date().toISOString(),
      ok: false,
      error: 'PowerShell diagnostics returned no output.',
      selectedPrinterName: selectedPrinterName ?? null,
      spooler: { status: null, canStop: null },
      printers: [],
      scanners: [],
      jobs: [],
      bridgeFailure,
    };
  }
  return normalizeSnapshot(JSON.parse(json), 'powershell', bridgeFailure);
}

export async function getWindowsDiagnosticsSnapshot(
  selectedPrinterName?: string | null,
): Promise<WindowsDiagnosticsSnapshot> {
  const provider = configuredProvider();

  if (provider === 'powershell') {
    return getPowerShellSnapshot(selectedPrinterName);
  }

  try {
    return await invokeEdgeBridge(selectedPrinterName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (provider === 'edge') {
      return {
        provider: 'edge',
        queriedAt: new Date().toISOString(),
        ok: false,
        error: message,
        selectedPrinterName: selectedPrinterName ?? null,
        spooler: { status: null, canStop: null },
        printers: [],
        scanners: [],
        jobs: [],
        bridgeFailure: { provider: 'edge', message },
      };
    }
    return getPowerShellSnapshot(selectedPrinterName, {
      provider: 'edge',
      message,
    });
  }
}
