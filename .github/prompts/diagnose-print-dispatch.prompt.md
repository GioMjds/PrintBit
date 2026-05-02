# Diagnose a PrintBit print dispatch or spooler issue

## When to use

Use when a print job is failing, hanging, or producing wrong output — whether in `legacy`, `phased`, or `new-only` dispatch mode.

## Context

PrintBit uses a **mode-gated print dispatcher**:

- `legacy` — Sumatra PDF only
- `phased` — PDFtoPrinter → GhostScript → LibreOffice, with Sumatra emergency fallback
- `new-only` — PDFtoPrinter → GhostScript → LibreOffice only

Current mode is set by `PRINTBIT_PRINT_DISPATCH_MODE` env var.

## Diagnostic steps

1. **Read first:**
   - `src/services/` dispatcher service (look for `dispatch`, `spooler`, or `print`)
   - Relevant route in `src/routes/` for `/confirm` or `/print`
   - Current `.env` for active dispatch mode and binary paths

2. **Check binary availability:**

   ```powershell
   # From kiosk machine
   Test-Path "bin\PDFtoPrinter.exe"
   Test-Path "bin\SumatraPDF.exe"
   gswin64c --version     # or check PRINTBIT_GHOSTSCRIPT_PATH
   soffice --version      # or check PRINTBIT_LIBREOFFICE_PATH
   ```

3. **Check spooler state:**
   - `PRINTBIT_PRINT_SPOOLER_MONITOR_WINDOW_MS` (default 180000)
   - `PRINTBIT_PRINT_SPOOLER_POLL_INTERVAL_MS` (default 1500)
   - Look for Windows print queue stuck jobs: `Get-PrintJob -PrinterName <name>`

4. **Check timeout values:**
   - `PRINTBIT_PRINT_DISPATCH_TIMEOUT_MS` (default 60000)
   - `PRINTBIT_PRINT_DISPATCH_LIBREOFFICE_TIMEOUT_MS` (default 120000, min 10000) — LibreOffice is slow on first launch

5. **Common failure patterns and fixes:**

   | Symptom                       | Likely cause                             | Fix                                                       |
   | ----------------------------- | ---------------------------------------- | --------------------------------------------------------- |
   | Job hangs indefinitely        | LibreOffice first-launch timeout too low | Increase `PRINTBIT_PRINT_DISPATCH_LIBREOFFICE_TIMEOUT_MS` |
   | "binary not found" error      | Path env var wrong or binary missing     | Check `PRINTBIT_PDFTOPRINTER_PATH` etc.                   |
   | Spooler never clears          | Windows print queue stuck                | Restart print spooler service                             |
   | DOCX prints garbled           | LibreOffice headless not installed       | Install LibreOffice, set path                             |
   | Sumatra fallback always fires | PDFtoPrinter/GS failing silently         | Check GS installation, test manually                      |

6. **Run validation after any fix:**
   ```bash
   pnpm exec tsc --noEmit --ignoreDeprecations 6.0
   ```

## Output format

Produce:

- Root cause diagnosis
- The specific code change or config change needed
- Any env var updates with recommended values
- Updated `OPERATIONS.md` runbook entry if this is a new known failure pattern
