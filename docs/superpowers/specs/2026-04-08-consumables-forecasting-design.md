# Consumables Forecasting Design (Issue #50)

## Problem

Admins can see current printer status and ink telemetry, but there is no forecast for when paper or ink will run out. This causes reactive maintenance and avoidable service interruptions.

## Scope and decisions

- First implementation slice is **admin observability only** (no new print-blocking behavior).
- Primary target is **EPSON L5290 on Wi-Fi/LAN**.
- Forecast defaults:
  - rolling window: **14 days**
  - alert threshold: **7 days remaining**
- Paper inventory reset is **manual admin input** after refill.
- Paper usage includes **print + copy** and is **duplex-aware**.
- Initial UI surface is an **admin dashboard widget**.

## Architecture

1. Keep admin HTTP surface under `/api/admin/*`.
2. Add focused forecasting logic in a dedicated service (for example `src/modules/admin/consumables.service.ts`) so forecasting logic stays out of `admin.controller.ts`.
3. Add SQLite-backed consumables persistence in `src/core/database/sqlite-storage.ts`.
4. Keep existing `db.data.inkHistory` for backward compatibility while new forecasting reads from new SQLite structures.

## Data model

### 1) `consumable_usage_events` (SQLite)

Append-only events written at successful print/copy settlement:

- `id` (text, PK)
- `timestamp` (ISO datetime)
- `transaction_id` (text)
- `mode` (`print` | `copy`)
- `copies` (integer)
- `duplex` (boolean)
- `selected_pages` (integer)
- `billable_color_pages` (integer)
- `billable_bw_pages` (integer)
- `estimated_sheets_used` (integer)
- `source` (text; e.g. `confirm-payment`, `copy-service`)

Sheet estimate formula:

- simplex: `estimated_sheets_used = copies * selected_pages`
- duplex: `estimated_sheets_used = copies * ceil(selected_pages / 2)`

### 2) `consumable_ink_snapshots` (SQLite)

Periodic snapshots written from printer telemetry refresh:

- `id` (text, PK)
- `timestamp` (ISO datetime)
- `printer_name` (text nullable)
- `ink_detection_method` (`snmp` | `vendor-wmi` | `printer-property` | `error-state` | `none`)
- `ink_telemetry_available` (boolean)
- `ink_telemetry_reason` (text nullable)
- `supplies_json` (JSON array of `{ name, level, status }`)

### 3) Runtime settings extension (`db.data.settings`)

Add `consumablesForecasting`:

- `enabled` (boolean)
- `rollingWindowDays` (number, default `14`)
- `alertDaysThreshold` (number, default `7`)
- `paperTrayCapacitySheets` (number)
- `paperCurrentSheets` (number)
- `paperRefillUpdatedAt` (ISO datetime nullable)

## Forecasting logic

### Paper

- Aggregate `consumable_usage_events` by day for print+copy.
- Compute rolling average sheets/day over `rollingWindowDays`.
- `paperDaysRemaining = paperCurrentSheets / avgDailySheetsUsed`.
- If usage data is insufficient, return `insufficient_data`.

### Ink

- Group recent snapshots by supply name (e.g., Black, Cyan, Magenta, Yellow).
- Use only telemetry-available readings with numeric levels.
- Compute average daily percent-drop per supply.
- `inkDaysRemaining = currentLevelPercent / avgDailyPercentDrop`.
- Ignore invalid/noisy intervals (missing level, non-progressing samples, or zero span).

### Confidence

Return confidence per supply (`high | medium | low`) using:

- sample count in window,
- telemetry continuity,
- detection method quality (SNMP highest, property fallback lower).

## Epson L5290 integration strategy

- For network queues, keep current telemetry strategy order:
  1. SNMP (`prtMarkerSupplies`) first
  2. Epson/driver property fallback (`Get-PrinterProperty`)
  3. existing fallback chain
- Persist `ink_detection_method` and telemetry availability in every snapshot.
- If telemetry becomes unavailable, forecasting remains non-blocking and reports explicit degraded status.

## Admin APIs

1. `GET /api/admin/consumables/forecast`
   - Returns:
     - paper forecast (`currentSheets`, `avgDailyUse`, `daysRemaining`, `projectedDepletionDate`)
     - per-supply ink forecast (`name`, `level`, `avgDailyDrop`, `daysRemaining`, `confidence`)
     - alert state (`withinThreshold`, `reasons[]`)
2. `POST /api/admin/consumables/paper-refill`
   - Sets `paperCurrentSheets` and updates `paperRefillUpdatedAt`.
3. Optional: `PUT /api/admin/consumables/settings`
   - Needed only if settings are not routed through existing `/api/admin/settings`.

## UI design (admin dashboard)

Add a consumables widget card showing:

- paper: current sheets + days remaining + projected depletion date,
- top ink supplies with percent and days remaining,
- warning badge when any item is within threshold,
- telemetry warning state when data is unavailable.

System page remains detailed diagnostics surface; dashboard remains summary and action surface.

## Error handling

- Forecast persistence failures must not fail print/copy settlement.
- On write failure, emit structured admin log/anomaly and continue core transaction flow.
- Forecast endpoint returns explicit per-consumable statuses (`ok`, `insufficient_data`, `telemetry_unavailable`) rather than silent defaults.
- Alert events should use dedupe behavior aligned with existing anomaly dedupe patterns.

## Testing and rollout

### Validation

- Unit tests for:
  - rolling averages,
  - depletion date math,
  - duplex sheet estimation,
  - confidence classification.
- Integration tests for:
  - forecast endpoint response shape,
  - paper refill endpoint behavior.
- Manual Epson L5290 checks:
  - verify telemetry source and availability via diagnostics,
  - verify forecast endpoint reflects incoming snapshots and alert transitions.

### Rollout

- Ship with `consumablesForecasting.enabled = false` by default.
- Enable per kiosk after operator enters current paper sheet count.
- Observe alert quality, then expand rollout.

## Out of scope for this issue slice

- New print rejection policies tied to forecast output.
- Hardware sensor integration beyond existing printer telemetry stack.
- Fleet-level remote aggregation across multiple kiosks.
