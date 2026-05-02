# Documentation sync rules

Read this when a change affects routes, environment variables, architecture, hardware integration,
or operational procedures. Updating docs in the same task as the code change is mandatory.

## Which doc to update

| What changed                                     | Doc to update                                      |
| ------------------------------------------------ | -------------------------------------------------- |
| New/changed HTTP route or request/response shape | `API_DOCUMENTATION.md`                             |
| New/changed env var                              | `README.md` (env var table + `.env` example block) |
| New user-facing flow or changed UX step          | `README.md` (end-user guides)                      |
| Service/layer/data-flow change                   | `ARCHITECTURE.md`                                  |
| Startup, shutdown, or diagnostic runbook change  | `OPERATIONS.md`                                    |
| New binary dependency or install step            | `INSTALLATION_AND_DEPENDENCIES.md`                 |
| Lockdown script or watchdog change               | `WINDOWS_KIOSK_LOCKDOWN_SETUP.md`                  |
| ESP32 firmware or hardware wiring change         | `WINDOWS_TABLET_ESP32_KIOSK_SETUP.md`              |

## Scope of updates

Update only the affected sections — do not regenerate unchanged parts of a doc.
