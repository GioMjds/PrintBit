# Microsoft Defender Upload Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a fail-closed malware-scanning boundary for every PrintBit file upload using local Microsoft Defender Antivirus, while preserving a customer-only Edge Assigned Access kiosk session.

**Architecture:** Uploads stream into a private server-owned staging directory. Existing filename/MIME/signature checks operate on that staged file, then a Defender adapter validates local Defender health and scans the generated path without a shell. Only a clean result is atomically promoted into session, legacy, or report storage; every other result is deleted or held in bounded quarantine.

**Tech Stack:** Node.js 22+, TypeScript 6, Express 5, Multer 2, Jest/ts-jest, Windows Task Scheduler, Microsoft Defender Antivirus `MpCmdRun.exe`, PowerShell Defender module.

**Spec:** `docs/superpowers/specs/2026-08-29-defender-upload-gate-design.md`

## Global Constraints

- Start the production backend with `scripts/install-startup.ps1 -AtStartup`, whose task principal is `SYSTEM`; the Assigned Access account runs Edge only.
- Every Defender result except `clean` blocks the upload. The default maximum security-intelligence age is exactly 168 hours.
- Invoke a fixed Microsoft executable with `spawn`/`spawnFile` and an argument array. Never invoke a shell or interpolate an original filename, scanner output, or request data into a command string.
- Keep staged and quarantined uploads outside all static routes. Do not log contents, upload tokens, or full Defender output.
- Preserve the existing extension, declared-MIME, magic-byte, and OOXML-structure checks; they are filters before the scan, not a substitute for it.
- This slice does not update vulnerable runtime dependencies, add CSP/security headers, or sandbox converters. `PB-FILE-001` remains open until those separately reviewed controls have evidence.
- Current workspace blocker: tracked test files are deleted in the working tree. Do not restore, overwrite, or commit those user changes. Execute this plan only from a clean worktree/checkout where the `tests/` tree is present, or after the user explicitly resolves those deletions.

## File Structure

- Create `src/config/defender.config.ts` — validated Defender timeout, signature-age, staging, and retention configuration.
- Create `src/services/defender-scanner.ts` — Windows-only Defender health and custom-file scan adapter with dependency injection for tests.
- Create `src/services/upload-staging.ts` — Multer disk storage, path-safe promotion, cleanup, and quota accounting.
- Modify `src/middleware/file-validation.ts` — validate staged files, call the Defender gate, map non-clean results, and remove memory storage.
- Modify `src/services/quarantine.ts` — move staged files into bounded quarantine and clean expired/over-quota entries.
- Modify `src/services/session.ts`, `src/modules/financial/financial.service.ts`, and `src/modules/report/report.service.ts` — promote clean staged files without recreating `Buffer` copies.
- Modify `src/modules/wireless-session/wireless-session.controller.ts`, `src/modules/financial/financial.controller.ts`, and `src/modules/report/report.controller.ts` — mount the shared scan gate after file-content validation and before persistence.
- Create `scripts/configure-upload-storage-acl.ps1` and `scripts/verify-defender-upload-gate.ps1`, then modify `scripts/verify-kiosk-lockdown.ps1`, `package.json`, and `WINDOWS_10_PRODUCTION_DEPLOYMENT_QUICKSTART.md` — configure and verify SYSTEM-only upload storage, Defender health/freshness, and kiosk operation without opening customer-visible UI.
- Create `tests/services/defender-scanner.spec.ts`, `tests/services/upload-staging.spec.ts`, and `tests/middleware/file-validation.spec.ts` — regression coverage for scanner, staging, and all upload surfaces.

---

### Task 1: Defender configuration and process adapter

**Files:**

- Create: `src/config/defender.config.ts`
- Create: `src/services/defender-scanner.ts`
- Test: `tests/services/defender-scanner.spec.ts`

**Interfaces:**

- Produces `DefenderScanner`, `DefenderHealth`, `DefenderScanResult`, and `DefenderScanStatus` exactly as specified.
- Consumes only a test-injected `CommandRunner` and filesystem adapter; callers receive no raw process object.
- Produces `createDefenderScanner()` for the upload-security middleware.

- [ ] **Step 1: Write the failing scanner tests**

```ts
import { createDefenderScanner } from '@/services/defender-scanner';

const runner = {
  run: jest.fn(),
};

it('fails closed when Defender is inactive or signatures are older than 168 hours', async () => {
  runner.run.mockResolvedValueOnce({
    exitCode: 0,
    stdout: JSON.stringify({
      AMRunningMode: 'Normal',
      AntivirusEnabled: true,
      AntivirusSignatureLastUpdated: new Date(
        Date.now() - 169 * 60 * 60 * 1000,
      ).toISOString(),
    }),
    stderr: '',
    timedOut: false,
  });

  await expect(
    createDefenderScanner({ runner }).getHealth(),
  ).resolves.toMatchObject({
    status: 'stale',
    signatureAgeHours: expect.any(Number),
  });
});

it('reports an EICAR-style Defender detection as infected and never as clean', async () => {
  runner.run.mockResolvedValueOnce({
    exitCode: 2,
    stdout: 'Threat detected: EICAR-Test-File',
    stderr: '',
    timedOut: false,
  });

  await expect(
    createDefenderScanner({ runner }).scanFile('C:\\staging\\uuid.upload'),
  ).resolves.toEqual({
    status: 'infected',
    detectionName: 'EICAR-Test-File',
    detail: null,
  });
});
```

- [ ] **Step 2: Run the scanner test to verify it fails for the missing module**

Run: `pnpm exec jest tests/services/defender-scanner.spec.ts --runInBand`

Expected: FAIL with a module-resolution error for `@/services/defender-scanner`.

- [ ] **Step 3: Implement validated configuration**

Create `src/config/defender.config.ts` with strict numeric parsing. Export this shape:

```ts
export interface DefenderConfig {
  readonly maxSignatureAgeHours: number;
  readonly scanTimeoutMs: number;
}

export function getDefenderConfig(env = process.env): DefenderConfig {
  return {
    maxSignatureAgeHours: readBoundedPositiveInt(
      env.PRINTBIT_DEFENDER_MAX_SIGNATURE_AGE_HOURS,
      168,
      1,
      24 * 30,
      'PRINTBIT_DEFENDER_MAX_SIGNATURE_AGE_HOURS',
    ),
    scanTimeoutMs: readBoundedPositiveInt(
      env.PRINTBIT_DEFENDER_SCAN_TIMEOUT_MS,
      60_000,
      1_000,
      5 * 60_000,
      'PRINTBIT_DEFENDER_SCAN_TIMEOUT_MS',
    ),
  };
}
```

An invalid configured value throws during startup rather than silently falling back to a weaker setting.

- [ ] **Step 4: Implement `DefenderScanner` with an injected runner**

Define the runner so tests do not spawn Windows processes:

```ts
export interface CommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface CommandRunner {
  run(
    executable: string,
    args: readonly string[],
    timeoutMs: number,
  ): Promise<CommandResult>;
}
```

Resolve `MpCmdRun.exe` only from the newest installed directory below `C:\ProgramData\Microsoft\Windows Defender\Platform` or the fallback `C:\Program Files\Windows Defender\MpCmdRun.exe`. Reject a result outside those exact roots. Query `Get-MpComputerStatus` with a fixed PowerShell command string and `-NoProfile -NonInteractive`; parse only JSON fields `AMRunningMode`, `AntivirusEnabled`, and `AntivirusSignatureLastUpdated`.

Run the custom scan as an argument array equivalent to:

```ts
['-Scan', '-ScanType', '3', '-File', stagedPath, '-DisableRemediation'];
```

Classify a timed-out process as `timeout`, unavailable executable/status-command failure as `unavailable`, an output explicitly identifying a detection as `infected`, a zero exit with no detection as `clean`, and every other result as `failed`. Truncate internal diagnostic text to 500 characters before it reaches logs.

- [ ] **Step 5: Run the focused tests and type-check**

Run: `pnpm exec jest tests/services/defender-scanner.spec.ts --runInBand`

Expected: PASS, including clean, stale, inactive, unavailable, timeout, infected, and unknown-nonzero result cases.

Run: `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`

Expected: exit code 0.

- [ ] **Step 6: Commit the isolated scanner increment**

```bash
git add src/config/defender.config.ts src/services/defender-scanner.ts tests/services/defender-scanner.spec.ts
git commit -m "feat: add fail-closed Defender upload scanner"
```

### Task 2: Disk-backed private staging and bounded quarantine

**Files:**

- Create: `src/services/upload-staging.ts`
- Modify: `src/services/quarantine.ts`
- Test: `tests/services/upload-staging.spec.ts`

**Interfaces:**

- Produces `createUploadStagingStorage(surface)`, `promoteStagedUpload(file, destination)`, `discardStagedUpload(file)`, `purgeStaging()`, and `readStagedFileRange(filePath, offset, length)`.
- Consumes a Multer file with a server-generated `path`; callers never depend on `file.buffer`.
- Produces `quarantineStagedUpload(file, reason, detectionName?)` and `purgeQuarantine()`.

- [ ] **Step 1: Write failing staging and retention tests**

```ts
it('keeps the original filename out of the staging path and atomically promotes a clean file', async () => {
  const staged = await writeStagedFixture(
    Buffer.from('%PDF-1.7'),
    'invoice.exe.pdf',
  );
  expect(path.basename(staged.path)).toMatch(/^[0-9a-f-]+\.upload$/i);

  const finalPath = path.join(tempDir, 'uploads', 'document.pdf');
  await promoteStagedUpload(staged, finalPath);

  await expect(fs.readFile(finalPath, 'utf8')).resolves.toBe('%PDF-1.7');
  await expect(fs.access(staged.path)).rejects.toThrow();
});

it('purges quarantine entries older than the configured retention window before accepting another quarantine entry', async () => {
  await writeExpiredQuarantineFixture();
  await purgeQuarantine();
  await expect(listQuarantineFiles()).resolves.toEqual([]);
});
```

- [ ] **Step 2: Run the staging test to verify it fails for missing exports**

Run: `pnpm exec jest tests/services/upload-staging.spec.ts --runInBand`

Expected: FAIL because `upload-staging.ts` and its exported functions do not yet exist.

- [ ] **Step 3: Implement custom Multer staging storage**

Use a Multer `StorageEngine`, not `memoryStorage()` or `diskStorage()`. In `_handleFile`, derive the scope from `req.params.sessionId` for wireless/report uploads and from the literal `legacy` for legacy uploads; create `uploads/.staging/<uuid>.upload` with `flags: 'wx'`; pipe `file.stream` into it; count bytes before writing each chunk; and abort/unlink when the per-file, active-scope, or active-global quota is exceeded. Keep the staging directory under `uploads` so successful `rename` promotion stays on the same filesystem.

Expose these exact configuration defaults through a validated staging config in the new service:

```ts
const MAX_STAGING_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ACTIVE_STAGING_BYTES_PER_SCOPE = 100 * 1024 * 1024;
const MAX_ACTIVE_STAGING_BYTES = 256 * 1024 * 1024;
const STAGING_RETENTION_MS = 60 * 60 * 1000;
const QUARANTINE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_QUARANTINE_BYTES = 256 * 1024 * 1024;
```

Derive the stage filename from `randomUUID()` only. Store the display filename solely in Multer metadata. Run `purgeStaging()` before accepting a new file and remove `.upload` files older than one hour. Use `path.relative` containment checks before every rename, unlink, range read, or quarantine move.

- [ ] **Step 4: Refactor quarantine to move files rather than copy buffers**

Replace `quarantineBuffer()` with `quarantineStagedUpload()`. It moves the already-staged file into `uploads/quarantine` with a generated name, records a reason from this union, and then calls `purgeQuarantine()`:

```ts
type QuarantineReason =
  | 'UNSUPPORTED_TYPE'
  | 'MAGIC_BYTE_MISMATCH'
  | 'OOXML_STRUCTURE_INVALID'
  | 'FILE_INFECTED';
```

The purge routine removes the oldest entries first until both the 7-day retention and 256 MiB total-size limits are satisfied. It logs only generated name, display name, size, reason, source, and optional detection family.

- [ ] **Step 5: Run the focused staging tests**

Run: `pnpm exec jest tests/services/upload-staging.spec.ts --runInBand`

Expected: PASS for generated filenames, path-containment rejection, quota rejection/unlink, atomic promotion, explicit discard, and retention/byte-quota purge.

- [ ] **Step 6: Commit the staging increment**

```bash
git add src/services/upload-staging.ts src/services/quarantine.ts tests/services/upload-staging.spec.ts
git commit -m "feat: stage and bound untrusted uploads on disk"
```

### Task 3: File-content and Defender gate middleware

**Files:**

- Modify: `src/middleware/file-validation.ts`
- Modify: `src/utils/file-types.ts`
- Test: `tests/middleware/file-validation.spec.ts`

**Interfaces:**

- Consumes `DefenderScanner` and staged-file helpers through `createUploadSecurityMiddleware(deps)`.
- Produces per-surface middleware `validateMagicBytes`, `validateLegacyUploadMagicBytes`, `validateReportIssueAttachmentMagicBytes`, `scanForMalware`, `scanLegacyUploadForMalware`, and `scanReportIssueAttachmentForMalware`.
- The default exports use the real scanner; tests pass fakes through the factory.

- [ ] **Step 1: Write the failing middleware tests**

```ts
it.each([
  ['wireless-session-upload', 'scanForMalware'],
  ['legacy-upload', 'scanLegacyUploadForMalware'],
  ['report-issue-attachment', 'scanReportIssueAttachmentForMalware'],
] as const)(
  '%s rejects stale Defender before persistence',
  async (_surface, middlewareName) => {
    const { middleware } = createUploadSecurityMiddleware({
      scanner: fakeScanner({
        health: { status: 'stale', signatureAgeHours: 169, detail: null },
      }),
      staging: tempStaging,
    });
    const res = mockResponse();

    await middleware[middlewareName](
      mockRequest(validPdfStagedFile),
      res,
      jest.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SCAN_UNAVAILABLE' }),
    );
  },
);

it('quarantines an infected valid PDF and does not call next', async () => {
  const next = jest.fn();
  const { middleware } = createUploadSecurityMiddleware({
    scanner: fakeScanner({
      scan: {
        status: 'infected',
        detectionName: 'EICAR-Test-File',
        detail: null,
      },
    }),
    staging: tempStaging,
  });

  await middleware.scanForMalware(
    mockRequest(validPdfStagedFile),
    mockResponse(),
    next,
  );

  expect(next).not.toHaveBeenCalled();
  expect(tempStaging.quarantine).toHaveBeenCalledWith(
    validPdfStagedFile,
    'FILE_INFECTED',
    'EICAR-Test-File',
  );
});
```

- [ ] **Step 2: Run the middleware test to verify it fails**

Run: `pnpm exec jest tests/middleware/file-validation.spec.ts --runInBand`

Expected: FAIL because the scanner-gate factory and malware middleware exports do not exist.

- [ ] **Step 3: Convert type and structural validation to staged-file reads**

Keep the current filename and declared-MIME file filter because Multer executes it before writing. Replace every use of `file.buffer` after staging with bounded reads:

- Read only the magic-byte length from offset zero.
- Read only the ZIP end-of-central-directory tail (at most 65,557 bytes) to locate the central directory.
- Reject an OOXML central-directory size greater than 8 MiB before reading entries.
- Read central-directory entries through `readStagedFileRange`; require `[Content_Types].xml` and the expected `word/`, `xl/`, or `ppt/` directory marker.

For a mismatch, quarantine the staged file and return 422 `UNSUPPORTED_TYPE`; do not invoke Defender or a document parser.

- [ ] **Step 4: Add the common Defender gate and public error mapping**

Implement one `scanStagedUploadWithSurface(req, res, next, surface, deps)` used by all three exported scan middleware functions. It must:

1. call `scanner.getHealth()`;
2. return 503 `SCAN_UNAVAILABLE` and discard the stage for `unavailable`/`stale`;
3. call `scanner.scanFile(file.path)` only when health is `clean`;
4. quarantine and return 422 `FILE_INFECTED` for `infected`;
5. discard and return 503 `SCAN_FAILED` for `timeout`/`failed`;
6. call `next()` only for `clean`.

Extend `handleMulterError` only for Multer/staging failures; retain generic customer messages and send precise reason/source to the existing anomaly and admin log paths.

- [ ] **Step 5: Replace memory storage and run focused tests**

Replace all three `multer.memoryStorage()` instances with their corresponding shared staging storage. Do not add a second Multer parser.

Run: `pnpm exec jest tests/middleware/file-validation.spec.ts --runInBand`

Expected: PASS for simple renamed executable, valid-header invalid OOXML, scanner unavailable, stale definitions, timeout, failed scan, infected scan, and clean scan for each applicable surface.

- [ ] **Step 6: Commit the shared security gate**

```bash
git add src/middleware/file-validation.ts src/utils/file-types.ts tests/middleware/file-validation.spec.ts
git commit -m "fix: block unscanned and malicious file uploads"
```

### Task 4: Promote only clean staged files on every upload surface

**Files:**

- Modify: `src/services/session.ts`
- Modify: `src/modules/financial/financial.service.ts`
- Modify: `src/modules/report/report.service.ts`
- Modify: `src/modules/wireless-session/wireless-session.controller.ts`
- Modify: `src/modules/financial/financial.controller.ts`
- Modify: `src/modules/report/report.controller.ts`
- Test: `tests/middleware/file-validation.spec.ts`
- Test: `tests/services/upload-staging.spec.ts`

**Interfaces:**

- Consumes a clean staged Multer file with `file.path`.
- Produces final storage through same-volume atomic rename and always releases staging quota.
- All three controllers mount scan middleware before their service handler.

- [ ] **Step 1: Add failing persistence assertions for no-buffer promotion**

```ts
it('stores a clean wireless upload by renaming the staged path without reading a file buffer', async () => {
  const staged = await writeStagedFixture(
    Buffer.from('%PDF-1.7'),
    'receipt.pdf',
  );
  const store = createSessionStoreForTest();

  await expect(
    store.storeUpload(sessionId, token, staged),
  ).resolves.toMatchObject({ isSuccess: true });

  expect(readFileSpy).not.toHaveBeenCalledWith(staged.path);
  await expect(fs.access(staged.path)).rejects.toThrow();
});
```

- [ ] **Step 2: Run the relevant tests to verify they fail**

Run: `pnpm exec jest tests/services/upload-staging.spec.ts tests/middleware/file-validation.spec.ts --runInBand`

Expected: FAIL because the current services require `req.file.buffer` and controllers do not mount scanner middleware.

- [ ] **Step 3: Refactor session, legacy, and report persistence**

Replace these buffer-based calls:

- `SessionStore.storeUpload()` writes `file.buffer`.
- `persistLegacyUploadWithStaging(buffer, storedFilename)` writes an intermediate `.part` buffer.
- `ReportService.persistAttachmentWithStaging(buffer, storedName)` writes an intermediate `.part` buffer.

With `promoteStagedUpload(file, finalPath)`. Preserve the existing generated destination names and path-containment checks. On persistence failure, discard the stage and preserve each route's current generic 500 error. Never call `readFile` merely to recreate an in-memory buffer.

- [ ] **Step 4: Mount scanning before every persistence handler**

Insert middleware in each route in this order:

```ts
uploadMiddleware.single('file'),
validateMagicBytes,
scanForMalware,
wirelessSessionService.uploadToSession,
```

```ts
legacyUploadMiddleware.single('file'),
validateLegacyUploadMagicBytes,
scanLegacyUploadForMalware,
this.uploadLegacy,
```

```ts
reportIssueAttachmentUploadMiddleware.single('file'),
validateReportIssueAttachmentMagicBytes,
scanReportIssueAttachmentForMalware,
this.uploadAttachment.bind(this),
```

Use method references that preserve the current controller/service `this` binding.

- [ ] **Step 5: Run focused tests and static checks**

Run: `pnpm exec jest tests/services/upload-staging.spec.ts tests/middleware/file-validation.spec.ts --runInBand`

Expected: PASS. Verify each clean route reaches only its own persistence service and every non-clean scanner result reaches none.

Run: `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`

Expected: exit code 0.

- [ ] **Step 6: Commit clean-file promotion**

```bash
git add src/services/session.ts src/modules/financial/financial.service.ts src/modules/report/report.service.ts src/modules/wireless-session/wireless-session.controller.ts src/modules/financial/financial.controller.ts src/modules/report/report.controller.ts tests/services/upload-staging.spec.ts tests/middleware/file-validation.spec.ts
git commit -m "fix: promote only Defender-clean staged uploads"
```

### Task 5: SYSTEM-task and Assigned Access verification

**Files:**

- Create: `scripts/configure-upload-storage-acl.ps1`
- Create: `scripts/verify-defender-upload-gate.ps1`
- Modify: `scripts/verify-kiosk-lockdown.ps1`
- Modify: `package.json`
- Modify: `WINDOWS_10_PRODUCTION_DEPLOYMENT_QUICKSTART.md`
- Test: `tests/scripts/defender-upload-gate.spec.ts`

**Interfaces:**

- Produces `pnpm run upload-storage:secure -- -KioskUser .\\printbit` and `pnpm run defender:verify`, administrator-only commands with nonzero exit status when a prerequisite is unsafe.
- Consumes optional `-KioskUser` only to verify ACLs; it never starts an interactive process.
- Produces deployment instructions that explicitly use `install-startup.ps1 -AtStartup` and retain Assigned Access Edge at `/loading`.

- [ ] **Step 1: Write the failing script-contract test**

```ts
it('requires SYSTEM startup, Defender health, signature freshness, and private upload ACLs', async () => {
  const script = await fs.readFile(
    'scripts/verify-defender-upload-gate.ps1',
    'utf8',
  );

  expect(script).toContain("Get-ScheduledTask -TaskName 'PrintBit Kiosk'");
  expect(script).toContain("'SYSTEM'");
  expect(script).toContain('Get-MpComputerStatus');
  expect(script).toContain('PRINTBIT_DEFENDER_MAX_SIGNATURE_AGE_HOURS');
  expect(script).toContain('uploads\\.staging');
  expect(script).toContain('uploads\\quarantine');
});

it('creates private staging ACLs without granting the kiosk user access', async () => {
  const script = await fs.readFile('scripts/configure-upload-storage-acl.ps1', 'utf8');

  expect(script).toContain('NTAccount');
  expect(script).toContain('/inheritance:r');
  expect(script).toContain('SYSTEM:(OI)(CI)(F)');
  expect(script).toContain('BUILTIN\\Administrators:(OI)(CI)(F)');
});
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `pnpm exec jest tests/scripts/defender-upload-gate.spec.ts --runInBand`

Expected: FAIL because `verify-defender-upload-gate.ps1` does not yet exist.

- [ ] **Step 3: Implement private upload-storage ACL configuration**

`configure-upload-storage-acl.ps1` must require `-KioskUser`, resolve it to a SID using `NTAccount.Translate()`, create `uploads/.staging` and `uploads/quarantine`, remove inherited permissions with `icacls <directory> /inheritance:r`, grant `SYSTEM:(OI)(CI)(F)` and `BUILTIN\\Administrators:(OI)(CI)(F)`, and explicitly remove the resolved kiosk SID grant. It must not grant `Users`, `Authenticated Users`, or the kiosk account read, write, modify, execute, or list permissions. Print the resolved SID and exit nonzero if `icacls` returns an error.

Add this package script:

```json
"upload-storage:secure": "powershell -ExecutionPolicy Bypass -File .\\scripts\\configure-upload-storage-acl.ps1"
```

- [ ] **Step 4: Implement the administrator-only Defender gate verifier**

`verify-defender-upload-gate.ps1` must use `Set-StrictMode -Version Latest`, `$ErrorActionPreference = 'Stop'`, and a `Write-Check`/nonzero-exit pattern consistent with `verify-kiosk-lockdown.ps1`. Check:

1. `PrintBit Kiosk` has `Principal.UserId` equal to `SYSTEM` and `LogonType` equal to `ServiceAccount`.
2. `Get-MpComputerStatus` reports `AMRunningMode` as `Normal`, `AntivirusEnabled` as true, and `AntivirusSignatureLastUpdated` no older than `PRINTBIT_DEFENDER_MAX_SIGNATURE_AGE_HOURS` (default 168).
3. `MpCmdRun.exe` resolves only in one of the two approved Defender locations.
4. `uploads/.staging` and `uploads/quarantine` exist, are not beneath a configured static root, and do not grant the kiosk SID write, modify, read, or list-directory access.

Do not use `Start-MpWDOScan`; it restarts the machine and is not an upload scan. Do not show Defender UI.

- [ ] **Step 5: Wire the verifier into kiosk operations**

Add this package script:

```json
"defender:verify": "powershell -ExecutionPolicy Bypass -File .\\scripts\\verify-defender-upload-gate.ps1"
```

Add a final summary line to `verify-kiosk-lockdown.ps1` directing operators to `pnpm run defender:verify`. Update the production quickstart to run `pnpm run upload-storage:secure -- -KioskUser .\\printbit` and the Defender verifier after startup/watchdog installation and before Assigned Access is enabled. State that the backend task is SYSTEM and customer Edge is the sole kiosk application.

- [ ] **Step 6: Run automated and Windows acceptance checks**

Run: `pnpm exec jest tests/scripts/defender-upload-gate.spec.ts --runInBand`

Expected: PASS.

On a non-production kiosk in Administrator PowerShell, run:

```powershell
pnpm run install-startup
pnpm run upload-storage:secure -- -KioskUser .\printbit
pnpm run defender:verify
pnpm run lockdown:verify
```

Expected: all checks pass, and the `PrintBit Kiosk` task is SYSTEM.

Sign in as the Assigned Access account and upload one clean allowed file, one header-mismatched file, and one EICAR test file. Expected outcomes: clean file succeeds; mismatched file returns 422 `UNSUPPORTED_TYPE`; EICAR returns 422 `FILE_INFECTED`; no Defender, PowerShell, or Command Prompt UI is visible to the customer.

- [ ] **Step 7: Commit kiosk verification**

```bash
git add scripts/configure-upload-storage-acl.ps1 scripts/verify-defender-upload-gate.ps1 scripts/verify-kiosk-lockdown.ps1 package.json WINDOWS_10_PRODUCTION_DEPLOYMENT_QUICKSTART.md tests/scripts/defender-upload-gate.spec.ts
git commit -m "chore: verify Defender upload gate in kiosk mode"
```

### Task 6: Evidence-based final verification and audit handoff

**Files:**

- Modify only after user resolves its existing worktree edit: `PRODUCTION_READINESS_AUDIT_2026-08-15.md`
- Verify: `docs/superpowers/specs/2026-08-29-defender-upload-gate-design.md`
- Verify: `docs/superpowers/plans/2026-08-29-defender-upload-gate.md`

**Interfaces:**

- Produces verified evidence for the Defender/staging sub-finding only.
- Does not mark `PB-FILE-001` closed while dependency, CSP, converter-isolation, and resource-limit remediation remain open.

- [ ] **Step 1: Re-read the approved specification and mark each Defender requirement as evidenced**

Create a command/result table in the task notes covering: clean scan, infected EICAR scan, stale signatures, disabled/unavailable Defender, timeout, all three route gates, disk staging quota, quarantine purge, SYSTEM startup principal, and Assigned Access no-UI acceptance.

- [ ] **Step 2: Run the complete automated verification set**

Run:

```bash
pnpm exec jest tests/services/defender-scanner.spec.ts tests/services/upload-staging.spec.ts tests/middleware/file-validation.spec.ts tests/scripts/defender-upload-gate.spec.ts --runInBand
pnpm exec tsc --noEmit --ignoreDeprecations 6.0
pnpm run build
pnpm run lint
pnpm audit --prod
```

Expected: capture each command's exit code and full failure count. Do not substitute an older result or a focused passing test for a failed full command.

- [ ] **Step 3: Record only demonstrated facts in the production audit**

After the existing user modification to `PRODUCTION_READINESS_AUDIT_2026-08-15.md` is resolved, append the new test and kiosk acceptance evidence. Keep PB-FILE-001 status **Open** and enumerate the remaining dependency, CSP/header, converter-isolation, CPU/memory/output-limit, and broader quarantine-policy gaps.

- [ ] **Step 4: Commit the evidence update separately**

```bash
git add PRODUCTION_READINESS_AUDIT_2026-08-15.md
git commit -m "docs: record Defender upload-gate verification evidence"
```
