# Offline Document & Image Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a centralized offline document and image conversion-to-PDF pipeline in the C# Worker (`printbit-worker`), and remove all direct LibreOffice and Microsoft Word execution from Node.js (`printbit`).

**Architecture:** A dedicated Windows Named Pipe (`\\.\pipe\printbit-document-conversion`) connects Node.js to the C# Worker. The C# Worker uses headless LibreOffice (`soffice.exe`) with dedicated profile isolation and a `SemaphoreSlim(1,1)` lock for Office formats, plus a native C# image-to-PDF converter for image formats. Node.js delegates all document-to-PDF conversion to this pipe while maintaining caching and HTML spreadsheet previews.

**Tech Stack:** C# (.NET 10, Windows Service, System.IO.Pipes, System.Diagnostics.Process), TypeScript (Node.js, net.Socket, Jest).

**Spec:** `docs/superpowers/specs/2026-09-02-offline-document-conversion-design.md`

## Global Constraints

- Purely offline: zero cloud APIs, zero external network downloads, zero Docker.
- LibreOffice executable defaults to `C:\Program Files\LibreOffice\program\soffice.exe`.
- Isolated LibreOffice user profile via `-env:UserInstallation` to prevent profile collisions.
- Serialized execution via `SemaphoreSlim(1, 1)` in C# Worker to eliminate process concurrency bugs.
- Node.js `PreviewService.convertToPdfPreview()` signature and caching remain unchanged for callers.
- Standardized canonical PDF print pipeline: all non-PDFs are converted to PDF before print dispatch.

---

### Task 1: C# Worker Configuration & Models

**Files:**

- Create: `C:\Users\printbit\printbit-worker\src\PrintBit.Shared\Configurations\DocumentConversionSettings.cs`
- Create: `C:\Users\printbit\printbit-worker\src\PrintBit.Infrastructure\Services\DocumentConversion\DocumentConversionContracts.cs`
- Modify: `C:\Users\printbit\printbit-worker\src\PrintBit.HardwareService\appsettings.json`
- Modify: `C:\Users\printbit\printbit-worker\src\PrintBit.HardwareService\appsettings.Development.json`
- Test: `C:\Users\printbit\printbit-worker\tests\PrintBit.Tests\DocumentConversionSettingsTests.cs`

**Interfaces:**

- Produces:
  - `DocumentConversionSettings`: `SofficePath`, `DefaultTimeoutSeconds`, `PipeName`, `UserProfileDirectory`, `DefaultOutputDirectory`
  - `DocumentConversionRequest`: `RequestId`, `SourcePath`, `OutputDirectory`, `TargetFormat`, `TimeoutSeconds`
  - `DocumentConversionResult`: `RequestId`, `Success`, `OutputPath`, `PageCount`, `SourceFormat`, `DurationMs`, `ErrorMessage`

- [ ] **Step 1: Write failing configuration and model tests**

```csharp
namespace PrintBit.Tests;

using PrintBit.Shared.Configurations;
using PrintBit.Infrastructure.Services.DocumentConversion;
using Xunit;

public class DocumentConversionSettingsTests
{
    [Fact]
    public void DocumentConversionSettings_HasSensibleDefaults()
    {
        var settings = new DocumentConversionSettings();
        Assert.Equal(@"C:\Program Files\LibreOffice\program\soffice.exe", settings.SofficePath);
        Assert.Equal(60, settings.DefaultTimeoutSeconds);
        Assert.Equal("printbit-document-conversion", settings.PipeName);
        Assert.False(string.IsNullOrWhiteSpace(settings.UserProfileDirectory));
    }

    [Fact]
    public void DocumentConversionContracts_SerializeAndDeserializeCleanly()
    {
        var request = new DocumentConversionRequest
        {
            RequestId = "req-1",
            SourcePath = @"C:\test\sample.docx",
            OutputDirectory = @"C:\test\out",
            TargetFormat = "pdf",
            TimeoutSeconds = 45
        };

        var json = System.Text.Json.JsonSerializer.Serialize(request);
        var deserialized = System.Text.Json.JsonSerializer.Deserialize<DocumentConversionRequest>(json);

        Assert.NotNull(deserialized);
        Assert.Equal("req-1", deserialized.RequestId);
        Assert.Equal(@"C:\test\sample.docx", deserialized.SourcePath);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test C:\Users\printbit\printbit-worker\tests\PrintBit.Tests\PrintBit.Tests.csproj --filter FullyQualifiedName~DocumentConversionSettingsTests`
Expected: Compilation failure due to missing types.

- [ ] **Step 3: Implement settings and contracts**

Create `DocumentConversionSettings.cs`:

```csharp
namespace PrintBit.Shared.Configurations;

public sealed class DocumentConversionSettings
{
    public string SofficePath { get; set; } = @"C:\Program Files\LibreOffice\program\soffice.exe";
    public int DefaultTimeoutSeconds { get; set; } = 60;
    public string PipeName { get; set; } = "printbit-document-conversion";
    public string UserProfileDirectory { get; set; } = @"C:\ProgramData\PrintBit\lo-profile";
    public string DefaultOutputDirectory { get; set; } = @"C:\ProgramData\PrintBit\converted";
}
```

Create `DocumentConversionContracts.cs`:

```csharp
namespace PrintBit.Infrastructure.Services.DocumentConversion;

public sealed class DocumentConversionRequest
{
    public string RequestId { get; set; } = string.Empty;
    public string SourcePath { get; set; } = string.Empty;
    public string? OutputDirectory { get; set; }
    public string TargetFormat { get; set; } = "pdf";
    public int TimeoutSeconds { get; set; } = 60;
}

public sealed class DocumentConversionResult
{
    public string RequestId { get; set; } = string.Empty;
    public bool Success { get; set; }
    public string? OutputPath { get; set; }
    public int? PageCount { get; set; }
    public string? SourceFormat { get; set; }
    public long DurationMs { get; set; }
    public string? ErrorMessage { get; set; }
}
```

Add `"DocumentConversionSettings"` section to `appsettings.json` and `appsettings.Development.json`.

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test C:\Users\printbit\printbit-worker\tests\PrintBit.Tests\PrintBit.Tests.csproj --filter FullyQualifiedName~DocumentConversionSettingsTests`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git -C C:\Users\printbit\printbit-worker add .
git -C C:\Users\printbit\printbit-worker commit -m "feat(conversion): add DocumentConversionSettings and DTO contracts"
```

---

### Task 2: Native C# Image-to-PDF Converter

**Files:**

- Create: `C:\Users\printbit\printbit-worker\src\PrintBit.Infrastructure\Services\DocumentConversion\ImageToPdfConverter.cs`
- Test: `C:\Users\printbit\printbit-worker\tests\PrintBit.Tests\ImageToPdfConverterTests.cs`

**Interfaces:**

- Produces: `ImageToPdfConverter.Convert(string imagePath, string outputPdfPath): Task<int>` (returns page count: 1)

- [ ] **Step 1: Write failing image converter tests**

```csharp
namespace PrintBit.Tests;

using System.IO;
using System.Threading.Tasks;
using PrintBit.Infrastructure.Services.DocumentConversion;
using PrintBit.Infrastructure.Services.PrintService;
using Xunit;

public class ImageToPdfConverterTests
{
    [Fact]
    public async Task Convert_PngImage_ProducesValidPdf()
    {
        var tempPng = Path.Combine(Path.GetTempPath(), $"{System.Guid.NewGuid()}.png");
        var tempPdf = Path.Combine(Path.GetTempPath(), $"{System.Guid.NewGuid()}.pdf");

        try
        {
            // 1x1 transparent PNG base64
            var pngBytes = System.Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");
            await File.WriteAllBytesAsync(tempPng, pngBytes);

            var pageCount = await ImageToPdfConverter.ConvertAsync(tempPng, tempPdf);

            Assert.Equal(1, pageCount);
            Assert.True(File.Exists(tempPdf));
            var counted = PdfPageCounter.Count(tempPdf);
            Assert.Equal(1, counted);
        }
        finally
        {
            if (File.Exists(tempPng)) File.Delete(tempPng);
            if (File.Exists(tempPdf)) File.Delete(tempPdf);
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test C:\Users\printbit\printbit-worker\tests\PrintBit.Tests\PrintBit.Tests.csproj --filter FullyQualifiedName~ImageToPdfConverterTests`
Expected: Compilation failure.

- [ ] **Step 3: Implement ImageToPdfConverter**

Implement `ImageToPdfConverter.cs` producing a valid standard PDF 1.4 wrapping the image, reading dimensions from headers, and embedding into `/Type /XObject /Subtype /Image`.

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test C:\Users\printbit\printbit-worker\tests\PrintBit.Tests\PrintBit.Tests.csproj --filter FullyQualifiedName~ImageToPdfConverterTests`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git -C C:\Users\printbit\printbit-worker add .
git -C C:\Users\printbit\printbit-worker commit -m "feat(conversion): implement native C# ImageToPdfConverter"
```

---

### Task 3: LibreOffice Document Conversion Service

**Files:**

- Create: `C:\Users\printbit\printbit-worker\src\PrintBit.Infrastructure\Services\DocumentConversion\IDocumentConversionService.cs`
- Create: `C:\Users\printbit\printbit-worker\src\PrintBit.Infrastructure\Services\DocumentConversion\LibreOfficeDocumentConversionService.cs`
- Test: `C:\Users\printbit\printbit-worker\tests\PrintBit.Tests\LibreOfficeDocumentConversionServiceTests.cs`

**Interfaces:**

- Produces: `IDocumentConversionService.ConvertAsync(DocumentConversionRequest request, CancellationToken ct): Task<DocumentConversionResult>`

- [ ] **Step 1: Write failing conversion service unit tests**

```csharp
namespace PrintBit.Tests;

using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using PrintBit.Infrastructure.Services.DocumentConversion;
using PrintBit.Shared.Configurations;
using Xunit;

public class LibreOfficeDocumentConversionServiceTests
{
    [Fact]
    public async Task ConvertAsync_RejectsNonExistentFile()
    {
        var settings = Options.Create(new DocumentConversionSettings());
        var service = new LibreOfficeDocumentConversionService(settings, NullLogger<LibreOfficeDocumentConversionService>.Instance);

        var result = await service.ConvertAsync(new DocumentConversionRequest
        {
            RequestId = "test-1",
            SourcePath = @"C:\nonexistent\fake.docx"
        }, CancellationToken.None);

        Assert.False(result.Success);
        Assert.Contains("does not exist", result.ErrorMessage, StringComparison.OrdinalIgnoreCase);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test C:\Users\printbit\printbit-worker\tests\PrintBit.Tests\PrintBit.Tests.csproj --filter FullyQualifiedName~LibreOfficeDocumentConversionServiceTests`
Expected: FAIL.

- [ ] **Step 3: Implement LibreOfficeDocumentConversionService**

- Implements `IDocumentConversionService`.
- Checks extension. If image (`.jpg`, `.jpeg`, `.png`, `.webp`, `.bmp`, `.gif`), calls `ImageToPdfConverter`.
- If office document (`.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, `.odt`, `.ods`, `.odp`, `.rtf`, `.txt`):
  - Acquires `SemaphoreSlim(1, 1)`
  - Spawns `soffice.exe` with `--headless --nologo --nodefault --norestore --nolockcheck -env:UserInstallation=file:///<profilePath> --convert-to pdf --outdir <outDir> <sourcePath>`
  - Enforces timeout via `CancellationTokenSource`, kills process tree on timeout
  - Confirms output `.pdf` exists, non-empty, and validates page count via `PdfPageCounter.Count()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test C:\Users\printbit\printbit-worker\tests\PrintBit.Tests\PrintBit.Tests.csproj --filter FullyQualifiedName~LibreOfficeDocumentConversionServiceTests`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git -C C:\Users\printbit\printbit-worker add .
git -C C:\Users\printbit\printbit-worker commit -m "feat(conversion): implement LibreOfficeDocumentConversionService"
```

---

### Task 4: Named Pipe IPC Hosted Service in C# Worker

**Files:**

- Create: `C:\Users\printbit\printbit-worker\src\PrintBit.HardwareService\Services\DocumentConversionPipeHostedService.cs`
- Modify: `C:\Users\printbit\printbit-worker\src\PrintBit.HardwareService\Program.cs`
- Test: `C:\Users\printbit\printbit-worker\tests\PrintBit.Tests\DocumentConversionPipeHostedServiceTests.cs`

**Interfaces:**

- Produces: `DocumentConversionPipeHostedService` BackgroundService listening on `\\.\pipe\printbit-document-conversion`

- [ ] **Step 1: Write failing IPC handler tests using in-memory streams**

```csharp
namespace PrintBit.Tests;

using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using PrintBit.HardwareService.Services;
using PrintBit.Infrastructure.Services.DocumentConversion;
using PrintBit.Shared.Configurations;
using Xunit;

public class DocumentConversionPipeHostedServiceTests
{
    [Fact]
    public async Task ProcessStreamRequestAsync_DispatchesRequestAndSerializesResult()
    {
        var mockService = new Mock<IDocumentConversionService>();
        mockService.Setup(s => s.ConvertAsync(It.IsAny<DocumentConversionRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new DocumentConversionResult
            {
                RequestId = "r1",
                Success = true,
                OutputPath = @"C:\test\out.pdf",
                PageCount = 2
            });

        var handler = new DocumentConversionPipeHostedService(
            NullLogger<DocumentConversionPipeHostedService>.Instance,
            mockService.Object,
            Options.Create(new DocumentConversionSettings()));

        var req = new DocumentConversionRequest { RequestId = "r1", SourcePath = @"C:\in.docx" };
        var reqBytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(req) + "\n");
        using var inStream = new MemoryStream(reqBytes);
        using var outStream = new MemoryStream();

        await handler.ProcessRequestStreamAsync(inStream, outStream, CancellationToken.None);

        var respJson = Encoding.UTF8.GetString(outStream.ToArray()).Trim();
        var resp = JsonSerializer.Deserialize<DocumentConversionResult>(respJson);
        Assert.NotNull(resp);
        Assert.True(resp.Success);
        Assert.Equal(@"C:\test\out.pdf", resp.OutputPath);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test C:\Users\printbit\printbit-worker\tests\PrintBit.Tests\PrintBit.Tests.csproj --filter FullyQualifiedName~DocumentConversionPipeHostedServiceTests`
Expected: Compilation failure.

- [ ] **Step 3: Implement DocumentConversionPipeHostedService and DI registration**

- Create `DocumentConversionPipeHostedService.cs`
- In `Program.cs`:

  ```csharp
  builder.Services.Configure<DocumentConversionSettings>(builder.Configuration.GetSection("DocumentConversionSettings"));
  builder.Services.AddSingleton<IDocumentConversionService, LibreOfficeDocumentConversionService>();
  builder.Services.AddHostedService<DocumentConversionPipeHostedService>();
  ```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test C:\Users\printbit\printbit-worker\tests\PrintBit.Tests\PrintBit.Tests.csproj --filter FullyQualifiedName~DocumentConversionPipeHostedServiceTests`
Expected: PASS.

- [ ] **Step 5: Run full test suite in printbit-worker**

Run: `dotnet test C:\Users\printbit\printbit-worker\printbit-worker.slnx`
Expected: All tests pass.

- [ ] **Step 6: Commit changes**

```bash
git -C C:\Users\printbit\printbit-worker add .
git -C C:\Users\printbit\printbit-worker commit -m "feat(conversion): register DocumentConversionPipeHostedService in HardwareService"
```

---

### Task 5: Node.js IPC Client & Configuration

**Files:**

- Modify: `src/config/http.config.ts:30-40`
- Create: `src/services/document-conversion-pipe.ts`
- Test: `tests/services/document-conversion-pipe.spec.ts`

**Interfaces:**

- Produces: `convertDocumentViaWorker(sourcePath: string, options?: { outputDirectory?: string; timeoutSeconds?: number }): Promise<DocumentConversionResult>`

- [ ] **Step 1: Write failing unit test for conversion client**

```ts
import { convertDocumentViaWorker } from '@/services/document-conversion-pipe';
import net from 'node:net';

jest.mock('node:net');

describe('document-conversion-pipe', () => {
  it('throws error when worker pipe fails to connect', async () => {
    (net.connect as jest.Mock).mockImplementation(() => {
      const emitter = new (require('node:events').EventEmitter)();
      setTimeout(
        () => emitter.emit('error', new Error('ENOENT pipe not found')),
        10,
      );
      return emitter;
    });

    await expect(
      convertDocumentViaWorker('C:\\test\\doc.docx'),
    ).rejects.toThrow(/Document conversion service is offline/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/services/document-conversion-pipe.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement document-conversion-pipe.ts**

Add `DOCUMENT_CONVERSION_PIPE_NAME` to `src/config/http.config.ts`.
Implement `convertDocumentViaWorker` connecting via `net.connect`, framing request with `\n`, parsing response.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/services/document-conversion-pipe.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add src/config/http.config.ts src/services/document-conversion-pipe.ts tests/services/document-conversion-pipe.spec.ts
git commit -m "feat: add document-conversion-pipe IPC client in Node.js"
```

---

### Task 6: Refactor Node.js Preview Service

**Files:**

- Modify: `src/services/preview.ts`
- Test: `tests/services/preview.spec.ts`

**Interfaces:**

- Modifies: `PreviewService.convertToPdfPreview(sourcePath: string): Promise<string>` to use `convertDocumentViaWorker` instead of local child processes.

- [ ] **Step 1: Update failing tests in preview.spec.ts**

Update `tests/services/preview.spec.ts` to mock `convertDocumentViaWorker` and verify:

1. `convertToPdfPreview()` calls `convertDocumentViaWorker` with the source path.
2. Concurrent requests for the same source share one conversion call via the in-flight deduplication map.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/services/preview.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Clean up preview.ts**

* Remove `execFile`, `spawnSync` from `node:child_process`.
* Remove `resolveLibreOfficePath`, `convertViaLibreOffice`, `convertViaWordCom`.
* Update `convertToPdfPreviewUncached` to invoke `convertDocumentViaWorker` and place result into `PREVIEW_CACHE_DIR`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/services/preview.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add src/services/preview.ts tests/services/preview.spec.ts
git commit -m "refactor: delegate convertToPdfPreview to C# Worker conversion pipe"
```

---

### Task 7: Remove LibreOffice Direct Printing from Print Dispatcher

**Files:**

- Modify: `src/services/print-dispatcher.ts`
- Test: `tests/services/print-dispatcher.spec.ts`

**Interfaces:**

- Removes: `libreoffice` engine from `PrintDispatchEngine` union type and `--pt` branch.

- [ ] **Step 1: Update print-dispatcher.spec.ts**

Ensure tests no longer expect `libreoffice` engine in fallback chains.

- [ ] **Step 2: Refactor print-dispatcher.ts**

* Remove `libreoffice` from `PrintDispatchEngine`.
* Remove `resolveLibreOfficePath`, `warmLibreOfficeProfile`.
* Remove `libreoffice` case in `runAttempt` and `resolveEngineChain`.

- [ ] **Step 3: Run print dispatcher tests**

Run: `pnpm test tests/services/print-dispatcher.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit changes**

```bash
git add src/services/print-dispatcher.ts tests/services/print-dispatcher.spec.ts
git commit -m "refactor: remove direct LibreOffice --pt print engine from print-dispatcher"
```

---

### Task 8: End-to-End Build & Test Verification

**Files:**

- None (verification only)

- [ ] **Step 1: Run full test suite in C# Worker**

Run: `dotnet test C:\Users\printbit\printbit-worker\printbit-worker.slnx`
Expected: All tests pass.

- [ ] **Step 2: Run full build and tests in Node.js**

Run: `pnpm test`
Run: `pnpm run build`
Expected: Build succeeds with 0 errors.

- [ ] **Step 3: Live end-to-end verification**

Test converting a sample `.docx` and a sample `.png` through the C# Worker pipe using a scratch script, confirming valid PDF creation.
