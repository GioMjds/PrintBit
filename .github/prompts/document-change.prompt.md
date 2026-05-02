# Sync PrintBit documentation after a behavior change

## When to use

Run this after implementing any change that affects routes, environment variables, architecture,
hardware integration, or operational procedures. Documentation sync is **mandatory** per `AGENTS.md §5`.

## Instructions

You are updating PrintBit's documentation to reflect a recent code change.

**Required inputs:**

- What changed (brief description of the code change)
- Which files were modified

**Documentation checklist — update every doc that applies:**

### `README.md`

- [ ] New or changed environment variables → update the env var table and `.env` example blocks
- [ ] New runtime prerequisites → update "Runtime prerequisites" section
- [ ] New user-facing flows → update end-user step-by-step guides
- [ ] Changed network/mobile behavior → update "Mobile and network matrix"

### `API_DOCUMENTATION.md`

- [ ] New route → add method, path, auth requirements, request schema, response schema
- [ ] Changed route → update existing entry (method, params, response shape)
- [ ] Removed route → mark as removed with version/date

### `ARCHITECTURE.md`

- [ ] New service or repository → add to the service/layer diagram description
- [ ] Changed data flow (print/copy/scan/payment/session/hotspot/hopper) → update relevant flow section
- [ ] New external dependency → document integration point

### `OPERATIONS.md`

- [ ] Changed startup/shutdown procedure → update runbook steps
- [ ] New diagnostic command or log path → add to diagnostics section
- [ ] Changed watchdog/scheduled task behavior → update

### `INSTALLATION_AND_DEPENDENCIES.md`

- [ ] New binary dependency (e.g., new executable in `bin/`) → add install steps
- [ ] New pnpm package with setup requirements → document
- [ ] Changed Windows configuration steps → update

### `WINDOWS_KIOSK_LOCKDOWN_SETUP.md`

- [ ] Changed PowerShell lockdown scripts → update steps and script references

### `WINDOWS_TABLET_ESP32_KIOSK_SETUP.md`

- [ ] Changed ESP32 firmware behavior or wiring → update setup steps and config values

## Output format

Produce the **diff of changes** needed for each applicable doc, or the full updated section if the change is large.
Do not regenerate unchanged sections.
