# Defender Upload Gate Audit Evidence

**Date:** 2026-08-29
**Branch:** `feature/idle-screen`
**Design Document:** `docs/superpowers/specs/2026-08-29-defender-upload-gate-design.md`
**Plan Document:** `docs/superpowers/plans/2026-08-29-defender-upload-gate.md`

---

## 1. Summary of Controls Implemented

1. **Fail-Closed Antivirus Scanning Gate (`src/services/defender-scanner.ts`, `src/middleware/file-validation.ts`):**
   - Microsoft Defender engine (`MpCmdRun.exe`) execution is strictly isolated and managed without showing UI or relying on background Defender notification tasks.
   - Fail-closed gate: if Defender service is disabled, in passive mode, or signatures are older than `PRINTBIT_DEFENDER_MAX_SIGNATURE_AGE_HOURS` (default 168h), all uploads are rejected with HTTP 503 `SCAN_UNAVAILABLE` before persistence.
   - Any infected file is quarantined into `uploads/quarantine` and rejected with HTTP 422 `FILE_INFECTED`.
   - Any timeout or process failure rejects with HTTP 503 `SCAN_FAILED` and discards the staged upload.

2. **Untrusted Upload Staging & Isolation (`src/services/upload-staging.ts`, `src/services/quarantine.ts`):**
   - Inbound uploads never land directly in final document storage or static roots.
   - Custom Multer storage engine stages files in `uploads/.staging/<uuid>.upload` with generated random UUID filenames.
   - Staging byte quotas are strictly enforced: 25 MiB per file, 100 MiB per session/ip scope, 256 MiB globally across staging.
   - Content and magic-byte checks read bounded chunks from disk via `readStagedFileRange()`.
   - File promotion to final upload storage is performed atomically via same-volume rename only after all validation and Defender scanning pass cleanly.

3. **Multi-Surface Coverage:**
   - Wireless Session Uploads: `/api/wireless/sessions/:sessionId/upload`
   - Legacy Uploads: `/upload`
   - Issue Report Attachments: `/api/report-issues/sessions/:sessionId/attachments`

4. **SYSTEM Startup & Access Control List (ACL) Hardening (`scripts/configure-upload-storage-acl.ps1`, `scripts/verify-defender-upload-gate.ps1`):**
   - `uploads/.staging` and `uploads/quarantine` are protected with restricted ACLs granting access exclusively to `SYSTEM` and `BUILTIN\Administrators`.
   - Standard user accounts and the kiosk account (`printbit`) have no read, write, execute, or directory listing permissions on staging and quarantine directories.
   - Verification script `pnpm run defender:verify` validates scheduled task SYSTEM principal, Defender engine health, signature freshness, and private ACLs.

---

## 2. Test Verification Results

### Upload Security & Defender Test Suite
```
Test Suites: 4 passed, 4 total
Tests:       40 passed, 40 total
Snapshots:   0 total
Time:        11.757 s
```

- `tests/services/defender-scanner.spec.ts`: 18/18 passed
- `tests/services/upload-staging.spec.ts`: 8/8 passed
- `tests/middleware/file-validation.spec.ts`: 12/12 passed
- `tests/scripts/defender-upload-gate.spec.ts`: 2/2 passed

### TypeScript Compilation & Build
- `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`: PASSED (Exit code 0, no errors)
- `pnpm run build`: PASSED (Client bundles and Node server compiled successfully)
