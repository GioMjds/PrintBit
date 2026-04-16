# Print Option Fidelity Design (Phased Dispatch)

## Problem
Print and copy jobs can ignore user-selected settings (grayscale, landscape, copies) even though the UI/config flow captures them correctly. This happens in phased dispatch mode when the selected engine cannot enforce job-level options and silently falls back to printer defaults.

## Goals
1. Ensure selected non-default options are enforced for both **print** and **copy** flows.
2. Prevent silent fallback to printer defaults when option fidelity is required.
3. Keep spooler, async orchestration, payment, and coin-change behavior unchanged.

## Non-Goals
1. Redesigning pricing, settlement, or spooler monitoring.
2. Adding new printer backends.
3. UI redesign of config/confirm pages.

## Current-State Findings
1. Frontend config and confirm flows serialize and send `colorMode`, `orientation`, and `copies` correctly.
2. Both print and copy pipelines eventually share `printDispatcher.dispatchFile(...)`.
3. In phased mode, early engines (`pdftoprinter`, `libreoffice --pt`) do not reliably enforce requested per-job options.
4. Current behavior allows option-ignoring engines to run, producing output that reflects printer defaults rather than selected settings.

## Approaches Considered

### 1. Option-aware routing (**recommended**)
Treat specific option combinations as strict capability requirements. Skip engines that cannot guarantee those requirements and route to capable engines only.

**Pros**
- Preserves phased architecture.
- Fixes root cause at shared dispatch layer for print + copy.
- Avoids silent mismatch.

**Cons**
- Requires explicit engine capability modeling.
- May fail fast when no capable engine exists (intentional behavior).

### 2. Force Sumatra for eligible jobs
Route all eligible jobs through Sumatra to maximize print-setting fidelity.

**Pros**
- Simple implementation path.
- Predictable behavior.

**Cons**
- Reduces phased/new-stack coverage.
- Loses value of multi-engine routing strategy.

### 3. Minimal patch for grayscale/copies only
Patch only the most visible options and defer orientation.

**Pros**
- Smallest change footprint.

**Cons**
- Leaves known mismatch unresolved.
- Contradicts requirement for landscape fidelity.

## Recommended Design

### A. Define strict-option triggers
Treat these as fidelity-critical:
- `colorMode === "grayscale"`
- `orientation === "landscape"`
- `copies > 1`
- `duplex === true`
- explicit page range

When any trigger is present, dispatch must use only engines that can enforce the required set.

### B. Add explicit engine capability model
Inside dispatcher, represent per-engine enforceable capabilities and evaluate each attempt against required capabilities before execution.

Examples:
- `pdftoprinter`: lightweight handoff only; no strict-option guarantees
- `libreoffice --pt`: no strict-option guarantees for this use case
- `ghostscript`: supports copies/grayscale/duplex/page range; not orientation-enforcing
- `sumatra`: supports orientation and broad print-settings fidelity

### C. Routing policy in phased mode
1. Build required capabilities from job options.
2. Evaluate candidate engines in chain order.
3. Skip engines lacking required capabilities with explicit skip reason.
4. Execute first capable engine.
5. If none are capable, fail with explicit option-fidelity error (no silent default print).

### D. Error and UX behavior
- Return actionable API error when strict options cannot be honored.
- Preserve existing success paths and payment/spooler behavior.
- Do not degrade to default printer settings when strict options were requested.

### E. Observability
Extend dispatch logs with:
- requested options
- required capabilities
- per-engine capability skip reason
- selected engine

This enables operators to verify why a job used a specific engine and whether option fidelity was enforced.

## Affected Components
- `src/services/print-dispatcher.ts` (primary)
- `src/modules/financial/financial.service.ts` (error propagation context)
- `src/modules/copy/copy.service.ts` (error propagation context)

## Testing Strategy
1. Verify print mode in phased dispatch:
   - grayscale + portrait + 1 copy
   - colored + landscape + 1 copy
   - grayscale + landscape + multiple copies
2. Verify copy mode with same matrix.
3. Confirm logs include required capability metadata and skip reasons.
4. Confirm no silent default-state output when strict options are requested.

## Risks and Mitigations
- **Risk:** stricter routing can reject jobs where no engine is capable.
  - **Mitigation:** explicit error messaging + logs to guide operator configuration.
- **Risk:** regression in default jobs.
  - **Mitigation:** strict gating only when non-default/fidelity-critical options are requested.

## Rollout Notes
Target phased mode first (current deployment mode). Keep behavior unchanged for spooler monitor, settlement, and coin hopper/change flows.
