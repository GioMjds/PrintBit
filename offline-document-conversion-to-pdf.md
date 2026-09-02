For **PrintBit**, I would put offline document-to-PDF conversion in the **C# Worker**, not directly in Node.js + Express.js.

Your architecture already treats the C# Worker as the machine-facing service for printing, Windows integration, printer monitoring, queue handling, and hardware-adjacent operations. Document conversion fits that same boundary much better.

### Recommended architecture

```text
User uploads document
       │
       ▼
Node.js + Express
- validate extension
- validate MIME/magic bytes
- generate jobId
- store upload temporarily
       │
       ▼
C# Worker
- validate again
- convert document → PDF
- enforce timeout
- verify generated PDF
       │
       ▼
Converted PDF
       │
       ▼
Node.js
- preview
- page counting
- pricing
- print configuration
       │
       ▼
C# Worker
- actual printing
- printer monitoring
```

For example:

```text
.docx
.xlsx
.pptx
.odt
.ods
.rtf
.txt
   │
   ▼
ConversionService
   │
   ▼
job-abc123.pdf
```

## Why C# Worker is the better location

The biggest reason is that conversion is **system-level processing**, not really web-server business logic.

Your Node.js server should primarily handle things such as:

```text
HTTP requests
/uploads
/config
/print
WebSocket/SSE events
pricing
job metadata
UI communication
```

Your C# Worker should handle:

```text
Windows
printers
spooler
files
conversion
process execution
hardware
system monitoring
```

That gives you a cleaner separation:

```text
┌──────────────────────────┐
│ Node.js + Express        │
│ Application Layer        │
│                          │
│ Upload                    │
│ Validation                │
│ Pricing                   │
│ UI/API                    │
│ Job orchestration         │
└────────────┬─────────────┘
             │
             │ IPC / HTTP / Queue
             ▼
┌──────────────────────────┐
│ PrintBit C# Worker       │
│ Machine Layer            │
│                          │
│ Document conversion       │
│ Printer                   │
│ Scanner                   │
│ Print spooler             │
│ Windows monitoring        │
│ Hardware integration      │
└──────────────────────────┘
```

### Node.js vs C# for your specific case

| Area                           | Node.js              | C# Worker     |
| ------------------------------ | -------------------- | ------------- |
| Upload handling                | **Excellent**        | Unnecessary   |
| Web/API operations             | **Excellent**        | Good          |
| File validation                | **Excellent**        | **Excellent** |
| Windows integration            | Okay                 | **Excellent** |
| Child-process management       | Good                 | **Excellent** |
| Printer integration            | Weak                 | **Excellent** |
| LibreOffice integration        | Good                 | **Excellent** |
| MS Office automation           | Possible but awkward | Better        |
| Timeout/process killing        | Good                 | **Excellent** |
| Logging conversion errors      | Good                 | **Excellent** |
| Kiosk service operation        | Good                 | **Excellent** |
| Your PrintBit architecture fit | Good                 | **Best**      |

So I would use Node as the **orchestrator**, while C# owns the **conversion engine**.

---

# Conversion engine recommendation

For PrintBit, I would specifically recommend:

> **C# Worker + LibreOffice Headless**

rather than trying to implement DOCX, XLSX, PPTX rendering yourself.

LibreOffice can operate completely offline.

For example, conceptually:

```powershell
soffice.exe `
  --headless `
  --convert-to pdf `
  --outdir "C:\PrintBit\jobs\abc123\converted" `
  "C:\PrintBit\jobs\abc123\upload\document.docx"
```

It supports many formats:

```text
DOC
DOCX
ODT

XLS
XLSX
ODS

PPT
PPTX
ODP

RTF
TXT

etc.
```

Your C# Worker can execute `soffice.exe` and monitor it.

For example:

```csharp
public interface IDocumentConversionService
{
    Task<ConversionResult> ConvertToPdfAsync(
        string inputPath,
        string outputDirectory,
        CancellationToken cancellationToken);
}
```

Implementation:

```text
LibreOfficeConversionService
        │
        ├── Start soffice.exe
        ├── --headless
        ├── --convert-to pdf
        ├── wait
        ├── enforce timeout
        ├── inspect exit code
        ├── confirm PDF exists
        └── return ConversionResult
```

I would place it approximately here in your unified architecture:

```text
PrintBit.Application
│
├── Documents
│   ├── IDocumentConversionService.cs
│   ├── DocumentConversionRequest.cs
│   └── ConversionResult.cs
│
PrintBit.Infrastructure.Windows
│
├── Documents
│   └── LibreOfficeDocumentConversionService.cs
│
PrintBit.HardwareService
│
└── Workers
    └── DocumentConversionWorker.cs
```

Or, if you want to keep document conversion separate from hardware:

```text
PrintBit.Infrastructure
└── DocumentConversion
    └── LibreOfficeDocumentConversionService.cs
```

That second organization is arguably cleaner because LibreOffice isn't technically hardware.

---

## Do not use Microsoft Office Interop as the primary solution

You might encounter implementations like:

```csharp
Microsoft.Office.Interop.Word
```

and:

```csharp
wordDocument.ExportAsFixedFormat(...)
```

It works, but I wouldn't make that PrintBit's production conversion engine.

Office Interop has several problems in kiosk/service environments:

```text
Requires Microsoft Office
        ↓
COM automation
        ↓
May display hidden dialogs
        ↓
Can leave WINWORD.EXE running
        ↓
Can behave badly in non-interactive services
        ↓
Harder kiosk recovery
```

Imagine:

```text
Customer uploads DOCX
       ↓
WINWORD.EXE starts
       ↓
Document has unusual formatting
       ↓
Word produces a dialog
       ↓
C# Worker hangs
       ↓
PrintBit transaction hangs
```

Not something you want in an unattended kiosk.

LibreOffice headless is much better suited to:

```text
Upload
   ↓
CLI
   ↓
PDF
   ↓
exit
```

---

# One especially important architectural decision

I would **not let uploaded documents go directly to the conversion executable**.

Given your earlier security concerns around malicious uploads, use:

```text
UPLOAD
   ↓
Extension check
   ↓
MIME validation
   ↓
Magic-byte/file signature validation
   ↓
Maximum file size
   ↓
Virus/malware scan
   ↓
Safe temporary directory
   ↓
CONVERSION
   ↓
PDF validation
   ↓
PREVIEW/PRINT
```

For example:

```text
C:\ProgramData\PrintBit\
└── Jobs\
    └── PB-20260902-A91E\
        ├── incoming\
        │   └── report.docx
        │
        ├── converted\
        │   └── report.pdf
        │
        └── metadata.json
```

After the transaction completes:

```text
Print completed
      ↓
retention timer
      ↓
secure cleanup
```

That is much safer than something like:

```text
public/uploads/file.docx
```

and then directly passing it around.

---

# Node.js should still participate

I wouldn't remove conversion responsibility completely from Node's workflow.

Node should request it:

```ts
const result = await worker.convertDocument({
    jobId,
    inputPath,
    outputFormat: "pdf",
});
```

Then C# returns:

```json
{
  "jobId": "PB-A91E",
  "status": "completed",
  "sourceFormat": "docx",
  "outputFormat": "pdf",
  "outputPath": "...",
  "pageCount": 7
}
```

Then Node can continue:

```text
conversion completed
        ↓
GET /print/:jobId
        ↓
PDF preview
        ↓
paper settings
        ↓
color detection
        ↓
price calculation
        ↓
payment
        ↓
print
```

This also benefits PrintBit because **everything ultimately becomes a PDF before printing**.

I'd formalize that as a PrintBit rule:

> **PDF is PrintBit's canonical print format.**

So:

```text
PDF ────────────────────────┐
                            │
DOCX ──┐                    │
XLSX ──┤                    ▼
PPTX ──┼─► PDF conversion ─► Print Pipeline
ODT  ──┤
RTF  ──┘
```

That greatly simplifies everything downstream.

Your existing SumatraPDF printing path can then continue operating on **one standardized document type** instead of having separate Word, Excel, PowerPoint, and PDF print implementations.

### Recommended final ownership

```text
NODE.JS
════════════════════════════
Upload API
File restrictions
Job creation
UI state
Pricing
Print settings
Transaction orchestration


C# WORKER
════════════════════════════
Malware/security validation
Document → PDF conversion
PDF verification
Page analysis where appropriate
SumatraPDF execution
Print queue
Printer status
Windows spooler
Hardware monitoring


ESP32
════════════════════════════
Coins
Hopper
Sensors
Heartbeat
```

So for PrintBit specifically, I would choose:

**C# Worker + LibreOffice headless for conversion, Node.js + Express.js for orchestration.**

That also gives you a natural foundation for the `/upload → conversion → /print` security pipeline you were planning.

Yes, **LibreOffice document conversion can work completely offline** for your PrintBit implementation.

If you install LibreOffice locally on the Windows tablet or kiosk machine, your C# Worker can call **`soffice.exe` in headless mode** without needing internet.

## What “offline” means here

It means this flow can happen fully inside the machine:

```text
Uploaded file
→ C# Worker
→ LibreOffice headless conversion
→ PDF output
→ Print pipeline
```

No cloud API, no online service, no internet connection required.

## Example

Your worker can run something like:

```powershell
soffice.exe --headless --convert-to pdf --outdir "C:\PrintBit\converted" "C:\PrintBit\uploads\file.docx"
```

That command works locally as long as:

* LibreOffice is installed
* the input file exists
* the output directory exists or is writable

## Why this is good for PrintBit

For your kiosk setup, this is ideal because:

* it does not rely on internet
* it avoids cloud conversion fees
* it is faster and more private
* it works even if the kiosk is disconnected
* it fits your offline-first printing workflow

## Important caveats

It is offline, but there are still some practical things to remember.

### 1. LibreOffice must be installed on the machine

Your C# Worker is not magically converting files by itself. It is using the LibreOffice executable already installed on Windows.

So your deployment requirement becomes:

```text
PrintBit Kiosk Machine
- Node.js app
- C# Worker
- LibreOffice
- SumatraPDF
```

### 2. Some complex files may not convert perfectly

LibreOffice is very useful, but not every document is guaranteed to render exactly like Microsoft Office, especially for:

* very complex `.docx`
* advanced `.pptx` animations/layouts
* heavily formatted `.xlsx`
* unusual fonts
* macros or embedded objects

For a printing kiosk, this is usually acceptable if you clearly standardize that uploaded files are converted to PDF for printing.

### 3. Fonts matter

If a document uses a font that is not installed on the kiosk machine, the converted output may look different.

So if possible:

* install common fonts on the machine
* or encourage PDF upload as the most reliable option

### 4. Macros and scripts should not be trusted

Even though conversion is offline, uploaded files can still be risky.

So still keep your validation pipeline:

* extension check
* MIME / magic byte validation
* file size limit
* optional malware scan
* safe temp folder
* conversion timeout
* verify PDF output exists

## Best practice for PrintBit

I recommend this policy:

### Canonical rule

**All non-PDF supported documents are converted locally to PDF before preview and printing.**

### Supported flow

```text
PDF upload
→ no conversion
→ preview
→ print

DOCX/XLSX/PPTX/ODT/RTF/TXT upload
→ local LibreOffice conversion
→ PDF
→ preview
→ print
```

### Recommended UX

On your `/upload` page or instructions, tell users something like:

* **Best compatibility:** upload PDF
* **Supported formats:** DOCX, XLSX, PPTX, ODT, RTF, TXT
* **Note:** non-PDF files are converted to PDF before printing

That helps set expectations.

## Final answer

Yes, **LibreOffice is completely offline for this use case**, as long as it is installed locally and your C# Worker calls it on the machine.

For PrintBit, that is actually one of the best reasons to use it.

If you want, I can next help you with:

1. a **C# Worker implementation plan** for LibreOffice conversion,
2. the **exact `soffice.exe` command handling with timeout and error checking**, or
3. a **supported file-type policy for PrintBit**.
