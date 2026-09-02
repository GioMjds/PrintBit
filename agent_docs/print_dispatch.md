# Print dispatch

Read this when working on print job dispatch, the spooler, or `PRINTBIT_PRINT_DISPATCH_MODE`.

## Dispatch modes

Controlled by `PRINTBIT_PRINT_DISPATCH_MODE` (default `legacy`):

| Mode       | Behavior                                                             |
| ---------- | -------------------------------------------------------------------- |
| `legacy`   | Sumatra PDF only                                                     |
| `phased`   | PDFtoPrinter → GhostScript, Sumatra emergency fallback |
| `new-only` | PDFtoPrinter → GhostScript only                        |

## Key binaries and env vars

- `PRINTBIT_PDFTOPRINTER_PATH` — default `bin/PDFtoPrinter.exe`
- `PRINTBIT_GHOSTSCRIPT_PATH` — explicit path to `gswin64c.exe`
- `PRINTBIT_SUMATRA_PATH` — Sumatra fallback path
- `PRINTBIT_PRINT_DISPATCH_TIMEOUT_MS` — default `60000`

## Spooler monitoring env vars

- `PRINTBIT_PRINT_SPOOLER_MONITOR_WINDOW_MS` — default `180000`, min `30000`
- `PRINTBIT_PRINT_SPOOLER_POLL_INTERVAL_MS` — default `1500`, min `250`
- `PRINTBIT_PRINT_SPOOLER_LOOKBACK_MINUTES` — default `3`, min `1`
- `PRINTBIT_PRINT_SPOOLER_QUERY_TIMEOUT_MS` — default `20000`, min `5000`

## Common failure patterns

| Symptom                       | Likely cause                                              |
| ----------------------------- | --------------------------------------------------------- |
| Job hangs indefinitely        | LibreOffice first-launch timeout too low                  |
| "binary not found"            | Path env var wrong or binary missing from `bin/`          |
| Spooler never clears          | Windows print queue stuck — restart print spooler service |
| DOCX prints garbled           | LibreOffice headless not installed or wrong path          |
| Sumatra fallback always fires | PDFtoPrinter or GhostScript failing silently              |
