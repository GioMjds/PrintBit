# Printing HIGH Quality

Yes, but **not directly through SumatraPDF's `-print-settings`**.

SumatraPDF currently supports options such as `color`, `monochrome`, `paper=A4`, `duplex`, `simplex`, `fit`, `noscale`, copies, orientation, and trays. There is **no documented `quality=high`, `dpi=...`, or similar command-line option**. ([GitHub][1])

This explains what you are seeing in PrintBit:

```text
/config
Print Quality: High
        ↓
PrintBit backend
        ↓
SumatraPDF.exe
        ↓
EPSON L5290 driver
        ↓
Standard quality
```

Your `High` value exists in the PrintBit configuration, but unless your printing backend explicitly applies that value to the Epson driver, SumatraPDF will simply use the printer driver's current/default quality.

### Why this happens

Internally, SumatraPDF asks Windows for the printer's `DEVMODE`, using `DocumentPropertiesW()`, then creates the printer device context from that configuration. Its source even reads fields such as:

```cpp
dm->dmPrintQuality
dm->dmYResolution
```

but its command-line print settings do not expose those fields as configurable options. ([GitHub][2])

Sumatra's documentation also specifically states that print quality follows the printer resolution/driver configuration. ([GitHub][1])

So something like this will **not** solve it:

```powershell
SumatraPDF.exe `
  -print-to "EPSON L5290 Series" `
  -print-settings "quality=high" `
  document.pdf
```

There is no supported `quality=high` Sumatra setting.

## Recommended solution for PrintBit

For your kiosk architecture, I would use **separate Windows printer queues/profiles**.

Create two logical printer queues that both point to the physical Epson L5290:

```text
EPSON L5290 - Standard
    Printing Preferences:
    Quality = Standard

EPSON L5290 - High
    Printing Preferences:
    Quality = High
```

Both can ultimately use the same physical Epson printer.

Then your PrintBit worker maps:

```csharp
quality switch
{
    PrintQuality.Standard => "EPSON L5290 - Standard",
    PrintQuality.High     => "EPSON L5290 - High",
    _                     => "EPSON L5290 - Standard"
};
```

and invokes:

```powershell
SumatraPDF.exe `
  -print-to "EPSON L5290 - High" `
  -print-settings "color,paper=A4,fit" `
  "document.pdf"
```

Sumatra then obtains the **DEVMODE belonging to the High-quality printer queue**, which already has Epson's High setting configured.

Your architecture becomes:

```text
/config
     │
     ├── Print Quality
     │      ├── Standard
     │      └── High
     │
     ▼
PrintBit PrintService
     │
     ├── Standard
     │      ↓
     │   "EPSON L5290 - Standard"
     │
     └── High
            ↓
         "EPSON L5290 - High"
                 │
                 ▼
           SumatraPDF.exe
                 │
                 ▼
            Epson Driver
                 │
                 ▼
            EPSON L5290
```

### Why I prefer this over changing Windows preferences dynamically

You _could_ make your C# worker manipulate Windows `DEVMODE` / printer defaults before launching Sumatra. But Epson's `Standard` and `High` modes may include Epson-specific driver data inside the driver's private `DEVMODE` area, not merely `dmPrintQuality`.

That makes this approach more fragile:

```text
Get DEVMODE
→ modify quality
→ save printer defaults
→ launch Sumatra
→ wait for submission
→ restore defaults
```

It also introduces a race condition if another print job begins while the printer defaults are temporarily changed.

Separate queues avoid that entirely.

### One useful test right now

Run:

```powershell
.\SumatraPDF.exe -list-printers
```

Find your:

```text
EPSON L5290 Series
```

Sumatra can report information from the printer's DEVMODE, including something similar to:

```text
devmode defaults:
 print quality: 600 dpi
 y resolution: 600 dpi
 color: color
```

The Sumatra source explicitly supports reporting those DEVMODE values. ([GitHub][2])

Try changing Epson Printing Preferences from **Standard → High**, then run `-list-printers` again.

If the reported DPI changes, for example:

```text
Standard
print quality: 360 dpi

High
print quality: 720 dpi
```

then we know Epson exposes quality through the standard Windows DEVMODE.

If the DPI **doesn't change**, but the Epson UI still says High, then Epson is almost certainly storing the quality preset in its driver-specific configuration. In that case, the **two-printer-queue approach becomes even more appropriate**.

So I would keep your new `/config → Print Quality` option. The missing part is simply that **PrintBit needs to map `Standard` and `High` to the Epson driver configuration**, because SumatraPDF cannot select those two Epson quality modes itself.

## PrintBit implementation status

The Node.js application must preserve the customer's choice before the worker
can act on it. The confirmed-print and copy paths now build `PrintJobOptions`
with the selected `quality`, rather than allowing the worker handoff to default
it to `standard`. The print queue then writes that value to the JSON sidecar.

The remaining driver-specific responsibility belongs to the separately deployed
C# worker (its source is not part of this repository): it must read
`quality: "high"` and target the `EPSON L5290 - High` queue, and target
`EPSON L5290 - Standard` for `standard`. The worker must use the exact queue
names installed on the kiosk.

### Kiosk verification

1. Create and configure the two Windows queues as above.
2. Confirm the C# worker maps the JSON `quality` value to the matching queue.
3. Print one `Standard` and one `High` job from `/config`.
4. On the kiosk, run `SumatraPDF.exe -list-printers` before and after switching
   each queue's preferences. If the driver exposes the setting through
   `DEVMODE`, the reported DPI should differ.
5. Keep a visual sample from each job; Epson drivers may store the quality
   preset in private driver data even when the DPI report is unchanged.

[1]: https://github.com/sumatrapdfreader/sumatrapdf/blob/master/docs/md/Printing.md?utm_source=chatgpt.com 'sumatrapdf/docs/md/Printing.md at master · sumatrapdfreader/sumatrapdf · GitHub'
[2]: https://github.com/sumatrapdfreader/sumatrapdf/blob/master/src/Print.cpp?utm_source=chatgpt.com 'sumatrapdf/src/Print.cpp at master · sumatrapdfreader/sumatrapdf · GitHub'
