# Admin Archive and Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix incomplete transaction-log clearing and pricing input failures, while treating resolved feedback, reports, and alerts as archived records that disappear from active work queues but remain auditable.

**Architecture:** Keep `resolved` as the persisted archive state—no new archive table and no physical deletion. Add an explicit `view=active|archived|all` query contract to the three admin work queues, and have the UIs request `active` by default. Keep transaction deletion limited to `admin_logs`; financial, receipt, recovery, and refund records must never be deleted from an audit-screen action.

**Tech Stack:** TypeScript, Express 5, SQLite stores, Jest, browser TypeScript bundled with esbuild.

**Spec:** `docs/superpowers/plans/2026-09-03-admin-archive-and-audit-fixes.md`

## Global Constraints

- Do not delete resolved feedback, report issues, anomaly incidents, or report attachments; `resolved` is the archive state.
- Preserve the existing API response shape. New `view` filtering is additive; omitted `view` must retain the current `all records` behavior for compatibility.
- The transaction clear button deletes only rows in SQLite `admin_logs`. It must not mutate ledgers, receipts, recovery sessions, pending refunds, or printer lifecycle data.
- Retain the current whole-peso server policy for all settings inputs. The form must no longer imply centavo support.
- Never replace a settings form while it has unsaved edits. Surface refresh failures to the admin instead of leaving rejected promises unhandled.
- Add focused regression tests before implementation and run `pnpm run build` after every client-facing slice.

---

## Decision record: archive semantics

`resolved` already has timestamps and a reopen workflow in feedback, reports, and anomalies. Reusing it as the archive state avoids data loss and prevents orphaning report-attachment files. “Resolve” therefore means:

1. Persist `status = resolved` and `resolvedAt`.
2. Remove the item from the active queue immediately.
3. Make it available under an **Archived** filter, where it can be inspected or reopened.
4. Keep all audit logs and attachments intact.

The default API behavior remains `all` to avoid breaking callers. Each admin UI must explicitly request `view=active`.

## File map

| Area                     | Files to modify                                                                                                                                                                                                    | Responsibility                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Transaction log clearing | `src/modules/admin/admin.service.ts`                                                                                                                                                                               | Delete IDs from ungrouped transaction log rows.                                    |
| Transaction tests        | `src/modules/admin/admin.service.spec.ts` (new)                                                                                                                                                                    | Prove every raw row is removed, including multiple rows for one transaction.       |
| Pricing                  | `src/public/admin/settings/index.html`, `src/public/admin/settings/app.ts`, `src/modules/admin/admin.controller.ts`                                                                                                | Make UI and server agree on whole-peso values; prevent refresh from erasing edits. |
| Pricing tests            | `src/modules/admin/admin.controller.spec.ts` (new or existing matching spec)                                                                                                                                       | Cover integer acceptance and decimal rejection for every editable price.           |
| Feedback archive         | `src/modules/feedback/feedback.controller.ts`, `src/modules/feedback/feedback.service.ts`, `src/core/database/models/feedback.model.ts`, `src/public/admin/feedback/{index.html,app.ts}`                           | Add active/archive views and default the UI to active.                             |
| Report archive           | `src/modules/report/report.controller.ts`, `src/modules/report/report.service.ts`, `src/services/report-issue.ts`, `src/core/database/models/report-issue.model.ts`, `src/public/admin/report/{index.html,app.ts}` | Add active/archive views without touching attachment cleanup.                      |
| Alert archive            | `src/modules/admin/admin.controller.ts`, `src/modules/anomaly/anomaly.service.ts`, `src/public/admin/alerts/{index.html,app.ts}`                                                                                   | Add active/archive views and retain event history.                                 |
| Archive tests            | `src/modules/feedback/feedback.controller.spec.ts`, `src/modules/report/report.controller.spec.ts`, `src/modules/anomaly/anomaly.service.spec.ts` (new)                                                            | Verify view filters, default compatibility, archive, and reopen behavior.          |
| Refresh reliability      | `src/public/admin/{dashboard,logs,system,settings,transactions,alerts}/app.ts`                                                                                                                                     | Catch periodic-refresh failures and stop settings clobbering in-progress edits.    |

## Task 1: Correct transaction-log clearing

**Files:**

- Modify: `src/modules/admin/admin.service.ts:335-405`
- Create: `src/modules/admin/admin.service.spec.ts`
- Optional UI copy check: `src/public/admin/transactions/app.ts:425-442`

**Interfaces:**

- Consumes: `adminLogStore.listAll()`, `adminLogStore.deleteByIds(ids)`.
- Produces: `clearTransactionLogs(): number` that returns the number of raw SQLite rows deleted.

- [ ] **Step 1: Write the failing regression test.**

Mock `adminLogStore.listAll` with three transaction rows—two with `meta.transactionId = 'tx-a'`, one with `meta.transactionId = 'tx-b'`—and one non-transaction system row. Assert that `clearTransactionLogs()` calls `deleteByIds` with all three transaction row IDs, never the system-row ID, and returns the store’s deletion count.

```ts
expect(adminLogStore.deleteByIds).toHaveBeenCalledWith(
  expect.arrayContaining(['tx-a-created', 'tx-a-completed', 'tx-b-created']),
);
expect(adminLogStore.deleteByIds).not.toHaveBeenCalledWith(
  expect.arrayContaining(['system-log']),
);
```

- [ ] **Step 2: Run the focused test and confirm it fails.**

Run: `pnpm test -- src/modules/admin/admin.service.spec.ts --runInBand`

Expected failure: only the grouped/latest IDs are supplied to `deleteByIds`.

- [ ] **Step 3: Delete from the raw set, not the display set.**

Keep `listAllTransactionLogs()` and `groupLogsByTransaction()` unchanged because they are presentation behavior. Change only `clearTransactionLogs()` to filter raw `listAllLogs()` entries with `isTransactionLog(entry)` and pass their IDs to `adminLogStore.deleteByIds`.

```ts
clearTransactionLogs(): number {
  return adminLogStore.deleteByIds(
    this.listAllLogs()
      .filter((entry) => this.isTransactionLog(entry))
      .map((entry) => entry.id),
  );
}
```

- [ ] **Step 4: Verify UI semantics manually.**

Create a transaction with multiple lifecycle logs, open `/admin/transactions`, click **Delete all transaction log entries**, then refresh after 10 seconds. The transaction list must stay empty. Verify that the transaction context endpoint can still show non-log financial/recovery data; that data is deliberately outside this delete action.

- [ ] **Step 5: Run the focused test and commit.**

Run: `pnpm test -- src/modules/admin/admin.service.spec.ts --runInBand`

Commit: `fix: clear every transaction log row`

## Task 2: Make pricing input policy consistent and protect unsaved edits

**Files:**

- Modify: `src/public/admin/settings/index.html:376-510`
- Modify: `src/public/admin/settings/app.ts:129-530`
- Modify: `src/modules/admin/admin.controller.ts:1190-1855`
- Test: `src/modules/admin/admin.controller.spec.ts`

**Interfaces:**

- Consumes: `PUT /api/admin/settings` with `pricing` and `pricingEngine`.
- Produces: a whole-peso-only settings form and a `409`/`400` error message that names the invalid price field.

- [ ] **Step 1: Write failing API tests for pricing invariants.**

Exercise `PUT /api/admin/settings` with decimals in every editable profile price and the scan/high-quality fields. Assert a `400` response. Exercise all whole-peso values and assert success. Also assert color price cannot be lower than the corresponding B&W price, because that would create a negative derived `colorSurcharge`.

- [ ] **Step 2: Make server validation explicit.**

Use the existing `isWholePeso` helper for `pricingEngine.paperProfiles.*.baseBwPrice` and `.baseColorPrice`, not merely `>= 0`. After each paper profile is assembled, reject `baseColorPrice < baseBwPrice` with a field-specific `400` error. Keep the same validation in the API even after client validation exists.

- [ ] **Step 3: Align browser controls and client validation.**

For every pricing input, replace `step="0.01"` with `step="1"`, and update helper text/placeholders to say **whole pesos**. In `settings/app.ts`, validate all eight values with `Number.isInteger(value) && value >= 0` before constructing the payload. Check each Color value is at least its paired B&W value. On a non-OK settings response, parse `{ error }` and show that message instead of the generic failure text.

- [ ] **Step 4: Prevent periodic refresh from overwriting edits.**

Add `let settingsDirty = false`. Mark it true for `input` and `change` events inside `settingsForm`. Split loading into a function that accepts `applyToForm: boolean`; the ten-second timer must skip `applySettings` while `settingsDirty` is true. After a successful save or an explicit **Refresh** action, set `settingsDirty = false` and apply the returned settings. Keep alert-badge refresh independent and catch its errors.

```ts
settingsForm.addEventListener('input', () => {
  settingsDirty = true;
});

refreshTimer = window.setInterval(() => {
  void loadData({ applyToForm: !settingsDirty }).catch(showRefreshError);
  void loadAlertStats().catch(showRefreshError);
}, 10_000);
```

- [ ] **Step 5: Manually verify pricing behavior.**

Confirm `3.50` is blocked by the browser with a clear whole-peso message, `3` saves, and an entered but unsaved value remains untouched across a 10-second timer tick. Confirm a Color price lower than B&W is rejected before any network request.

- [ ] **Step 6: Run tests, build, and commit.**

Run: `pnpm test -- src/modules/admin/admin.controller.spec.ts --runInBand`

Run: `pnpm run build`

Commit: `fix: align admin pricing validation`

## Task 3: Add archive views for feedback, reports, and alerts

**Files:**

- Modify: `src/modules/feedback/feedback.controller.ts`, `src/modules/feedback/feedback.service.ts`, `src/core/database/models/feedback.model.ts`
- Modify: `src/modules/report/report.controller.ts`, `src/modules/report/report.service.ts`, `src/services/report-issue.ts`, `src/core/database/models/report-issue.model.ts`
- Modify: `src/modules/admin/admin.controller.ts`, `src/modules/anomaly/anomaly.service.ts`
- Modify: `src/public/admin/feedback/{index.html,app.ts}`, `src/public/admin/report/{index.html,app.ts}`, `src/public/admin/alerts/{index.html,app.ts}`
- Test: `src/modules/feedback/feedback.controller.spec.ts`, `src/modules/report/report.controller.spec.ts`, `src/modules/anomaly/anomaly.service.spec.ts`

**Interfaces:**

- Consumes: `GET /api/admin/feedback`, `GET /api/admin/report-issues`, and `GET /api/admin/anomaly-incidents`.
- Produces: optional query `view=active|archived|all`; omitted `view` means `all` for compatibility.

- [ ] **Step 1: Add a narrow shared view type at each owning layer.**

Use `type AdminQueueView = 'active' | 'archived' | 'all'` in each module’s own schema/service area; do not place feature-specific filtering in `src/public/admin/shared.ts`. Parse only these three strings in controllers. Unknown values return `400` with `view must be active, archived, or all.`

- [ ] **Step 2: Filter at the persistence/service boundary.**

For feedback, `active` means `status = 'open'`; `archived` means `status = 'resolved'`. For reports and anomaly incidents, `active` means `status != 'resolved'`; `archived` means `status = 'resolved'`. Apply this filter before counting, sorting, limiting, and offsetting so pagination remains correct.

For the SQLite stores, build the `WHERE` clause with constant SQL fragments and parameterized values; do not interpolate the query parameter. For anomalies, apply the same predicate in `AnomalyService.listIncidents` before its sort/slice.

- [ ] **Step 3: Keep archive data intact.**

Do not add `DELETE` routes for reports or alerts. Do not call `removeAttachmentFile`, `fs.unlink`, or SQLite attachment deletion when resolving reports. The resolved timestamps, attachments, and admin status-change log are the archived audit record.

- [ ] **Step 4: Change each UI’s default and filters.**

Set each screen’s initial filter to `active` and request `?view=active`. Rename the resolved filter button to **Archived** and request `?view=archived`; optionally retain **All** for supervisors. On a successful Resolve action, reload the current view before closing the detail modal. That removes the item instantly from Active but leaves it visible in Archived. Reopen must return it to Active.

- [ ] **Step 5: Write controller/service tests.**

For each queue, seed one open, one acknowledged where supported, and one resolved item. Assert:

1. no `view` returns all items (backward compatibility);
2. `view=active` excludes only resolved items;
3. `view=archived` returns only resolved items;
4. resolving changes the result from Active to Archived;
5. reopening reverses that move;
6. a report’s attachments are still returned after archiving.

- [ ] **Step 6: Browser verification and commit.**

For feedback, reports, and alerts: resolve an item, observe it disappear from Active, switch to Archived, inspect it, reopen it, and confirm it returns to Active. For reports, open every attachment after resolving.

Run: `pnpm test -- src/modules/feedback/feedback.controller.spec.ts src/modules/report/report.controller.spec.ts src/modules/anomaly/anomaly.service.spec.ts --runInBand`

Commit: `feat: archive resolved admin work items`

## Task 4: Make all periodic admin refreshes safe

**Files:**

- Modify: `src/public/admin/dashboard/app.ts:309`
- Modify: `src/public/admin/logs/app.ts:173`
- Modify: `src/public/admin/system/app.ts:613`
- Modify: `src/public/admin/settings/app.ts:528-531`
- Modify: `src/public/admin/transactions/app.ts:813`
- Modify: `src/public/admin/alerts/app.ts:313,363`

**Interfaces:**

- Consumes: existing `loadData()` methods.
- Produces: no unhandled rejected promise from timer or socket-triggered loads; a visible message for the active screen.

- [ ] **Step 1: Add a local refresh-error handler per page.**

Use a small helper that preserves meaningful `Error.message` text and uses `setMessage`. Do not log full response bodies or credentials.

```ts
function showRefreshError(error: unknown): void {
  setMessage(
    error instanceof Error ? error.message : 'Automatic refresh failed.',
  );
}
```

- [ ] **Step 2: Attach `.catch(showRefreshError)` to every fire-and-forget refresh.**

This includes interval callbacks, socket event callbacks, page/filter actions that call a throwing `loadData`, and the two settings timer calls. Do not alter functions that already catch internally unless they currently hide a failed response without informing the user.

- [ ] **Step 3: Verify expiry and network-failure handling.**

In a browser, invalidate the admin session or block the API request, wait for an automatic refresh, and confirm the page displays an error without an unhandled-promise console error. Restore the connection and use Refresh to confirm recovery.

- [ ] **Step 4: Build and commit.**

Run: `pnpm run build`

Commit: `fix: handle admin refresh failures`

## Final verification

- [ ] Run each focused regression test from Tasks 1–3.
- [ ] Run `pnpm run build`; it must complete with exit code 0.
- [ ] Run `pnpm test --runInBand`. At the time this plan was written, unrelated conversion, wireless-session, and printer-service tests were already failing; record whether their failure set changes rather than masking them.
- [ ] Manually verify the full flow: edit pricing across a timer tick, save valid pricing, clear multi-row transaction logs, archive/reopen feedback, archive/reopen a report with an attachment, and archive/reopen an alert.
- [ ] Run `graphify update .` after source edits so `graphify-out` reflects the new API and view relationships.

## Scope intentionally excluded

- Physical deletion or retention expiry for archived work items.
- Deletion of financial transaction evidence from the transaction-log screen.
- A new generic archival framework or shared admin-domain abstraction.
- Changes to the currently failing non-admin test suites unless a fix in this plan demonstrably changes one of their failures.
