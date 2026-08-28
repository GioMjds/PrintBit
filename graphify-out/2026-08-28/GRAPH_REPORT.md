# Graph Report - printbit  (2026-08-28)

## Corpus Check
- 332 files · ~468,549 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4566 nodes · 8848 edges · 277 communities (212 shown, 65 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 166 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9ef9821c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- confirm/app.ts
- printer-status.ts
- transactions/app.ts
- config/app.ts
- receipt.service.ts
- scan/app.ts
- print-dispatcher.ts
- scanner.service.ts
- public/app.ts
- system/app.ts
- upload/app.ts
- src/middleware/index.ts
- file-validation.ts
- admin/report/app.ts
- copy/app.ts
- financial.service.ts
- earnings/app.ts
- print/app.ts
- hopper.ts
- recovery.ts
- serial.ts
- prepare-print-pdf.ts
- database/db.ts
- settings/app.ts
- alerts/app.ts
- app.module.ts
- server.ts
- AdminService
- admin/feedback/app.ts
- AdminService
- dashboard/app.ts
- sqlite-storage.ts
- admin.controller.ts
- AdminController
- document-analysis.ts
- HttpException
- Hardware Integration Architecture
- WirelessSessionService
- refreshPrintQuote
- public/report/app.ts
- print-queue.orchestration.ts
- LogMeta
- consumables.service.ts
- receipt/app.ts
- PrintBit Architecture
- http.config.ts
- SessionStore
- print-queue/index.ts
- watchdog-health.ts
- PrintPreview
- scripts
- getSqliteDb
- ReportService
- kiosk-i18n.ts
- loading-animation.spec.ts
- generate-confirm-lottie-assets.js
- getTrustedTimestamp
- LanguageService
- AnomalyService
- PrintBit Operations Runbook
- printer.service.ts
- scc/app.ts
- markWatchdogHeartbeat
- AnomalyService
- copy.service.ts
- ScannerService
- loading-animation.ts
- dependencies
- print-spooler.ts
- Detailed findings
- time-source.ts
- HotspotService
- Graphify Incremental Update Reference
- watchdog.ps1
- printer-monitor.ts
- FeedbackSqliteStore
- logs/app.ts
- public/feedback/app.ts
- color-detection.ts
- scanner.ts
- session.ts
- FeedbackService
- admin.schema.ts
- hopper/index.ts
- UploadPortalService
- Admin APIs
- FeedbackService
- ScannerController
- compilerOptions
- scanner.controller.ts
- consumables.model.ts
- Kiosk Main Landing and Service Launcher
- loading/app.ts
- LogMeta
- wA
- services/index.ts
- 5. Architectural patterns and conventions
- printer-guard.ts
- What You Must Do When Invoked
- pricing-analysis-queue.ts
- applyConfirmGate
- finalizePrintSuccess
- createSession
- navigateWithKioskMotion
- ReportIssueService
- admin.service.ts
- hopper-protocol.ts
- report.controller.ts
- shared.ts
- reset-db.js
- idempotency.ts
- print-job.schema.ts
- PrinterController
- idle-timeout.ts
- usb-drives.ts
- AdminLogSqliteStore
- print-job.model.ts
- wireless-session.controller.ts
- document-analysis.spec.ts
- job-store.ts
- package.json
- kiosk-helpers.psm1
- wireless-session.service.ts
- Design System: PrintBit
- **PrintBit**
- orchestratePrintJob
- handleErrorAction
- ensure-esp32-network.ps1
- .handleGetAnomalyIncidents
- ScanJobSettings
- loadPreview
- addFileToList
- devDependencies
- ReceiptService
- helpers.ts
- JobProcessor
- renderRefreshSessionButtonState
- transient-file-cleanup.ts
- PrintBit API Documentation
- PreviewService
- bench-edge-warm.js
- build-client.js
- CLAUDE.md
- Balance, pricing, and payment
- api-aware-app.ts
- scan-storage.ts
- PrintBit ESP32 Wi-Fi & Firmware Setup Guide
- High Severity Launch Priority Classification
- start-kiosk-server.ps1
- Coin Payment Panel
- Security Policy
- Operations Overview Dashboard
- worker-handoff.ts
- Graphify Query Reference
- Copy Step 1: Place Document Screen
- Copy Workflow Document Preview Screen
- Coin Payment Interface
- Print Step 1 Guide Screenshot
- Scan & Print Step 1 Screen
- Scan Document Preview Screen
- AnomalyController
- printer.schema.ts
- Scan APIs
- loadFeedbackSession
- loadReportSession
- renderGuideStep
- Graphify Exports Reference
- Kiosk UI Impeccable Critique
- Disclaimer
- apply-kiosk-lockdown.ps1
- bench-end-to-end.js
- Scanning Document Progress Modal
- Copy Live Preview and Settings Screen
- Copy Step 6 - Print Completion and E-Receipt Modal
- Send to PrintBit File Upload Screen
- Send to PrintBit Upload Screen
- Mobile Upload Success Screen
- Received Files Screen
- Live Preview and Print Configuration Screen
- Coin Balance Payment Gate
- PrintBit Installation & Dependencies Guide
- scan-delivery.ts
- Windows 10 Production Deployment Quickstart (Assigned Access Kiosk)
- te
- gs
- 4.2) Production Installation (Kiosk Mode in `printbit` account)
- Graphify Agent Instructions & Rules
- Product
- build-server.js
- launch-kiosk.js
- Document Scanning Progress
- Expiring Download Link
- Anomaly Alert Desk
- generateClientUuid
- UA
- xB
- .getForecast
- .parseTransactionLogFilters
- ConsumablesService
- Code of Conduct
- License
- Copyright Notice
- network.ts
- dotenv
- edge-js
- eslint
- eslint-config-airbnb-typescript
- @eslint/js
- eslint-plugin-import
- eslint-plugin-promise
- express
- flatpickr
- husky
- i18next-http-middleware
- PNPM Workspace Only-Built Dependencies Configuration
- jest
- lint-staged
- nodemon
- System and hotspot
- pdf-lib
- pdfjs-dist
- pdfkit
- qrcode
- @serialport/parser-readline
- sharp
- socket.io
- @swc/core
- @swc/helpers
- ts-jest
- ts-node
- ts-node-dev
- tsconfig-paths
- tsx
- @types/cookie-parser
- @types/express
- @types/jest
- @types/multer
- @types/node
- @types/pdfkit
- typescript
- typescript-eslint
- @typescript-eslint/eslint-plugin
- Earnings and Revenue Analytics
- Feedback Command Center
- Issue Reports Hub
- Configurable Policy Architecture
- an
- Be
- dA
- Kr
- Lr
- types.ts
- .getStatus
- rules/graphify.md
- workflows/graphify.md
- Contributing to PrintBit
- GEMINI.md
- Job Processor & PrintQueueWatcher Execution Trace Log

## God Nodes (most connected - your core abstractions)
1. `getSqliteDb()` - 90 edges
2. `SessionStore` - 62 edges
3. `AdminController` - 54 edges
4. `AdminService` - 46 edges
5. `apiFetch()` - 44 edges
6. `AdminService` - 41 edges
7. `ScannerService` - 35 edges
8. `AnomalyService` - 35 edges
9. `ReceiptService` - 34 edges
10. `getTrustedTimestamp()` - 34 edges

## Surprising Connections (you probably didn't know these)
- `GitHub Copilot Instructions` --semantically_similar_to--> `CLAUDE.md Native Graphify Integration`  [INFERRED] [semantically similar]
  .github/copilot-instructions.md → .codex/skills/graphify/references/hooks.md
- `Hardware & Printer Impact Checklist` --conceptually_related_to--> `Hardware Integration Architecture`  [INFERRED]
  .github/PULL_REQUEST_TEMPLATE.md → agent_docs/hardware_integration.md
- `main()` --calls--> `getSqliteDb()`  [EXTRACTED]
  scripts/reset-db.js → src/core/database/sqlite-storage.ts
- `main()` --calls--> `initSqliteStorage()`  [EXTRACTED]
  scripts/reset-db.js → src/core/database/sqlite-storage.ts
- `PrintBit Core In-Progress Initiatives` --conceptually_related_to--> `Kiosk Hardware & Binary Security Policy`  [INFERRED]
  agent_docs/in_progress.md → .github/SECURITY.md

## Import Cycles
- 3-file cycle: `src/core/database/db.ts -> src/core/database/sqlite-storage.ts -> src/core/database/models/consumables.model.ts -> src/core/database/db.ts`
- 3-file cycle: `src/core/database/db.ts -> src/services/index.ts -> src/services/db.ts -> src/core/database/db.ts`
- 4-file cycle: `src/core/database/db.ts -> src/services/index.ts -> src/services/print-quote.ts -> src/services/db.ts -> src/core/database/db.ts`
- 4-file cycle: `src/core/database/db.ts -> src/services/index.ts -> src/services/print-lifecycle-state.ts -> src/services/db.ts -> src/core/database/db.ts`
- 4-file cycle: `src/core/database/db.ts -> src/services/index.ts -> src/services/settlement.ts -> src/services/db.ts -> src/core/database/db.ts`
- 4-file cycle: `src/core/database/db.ts -> src/services/index.ts -> src/services/pending-refund.ts -> src/services/db.ts -> src/core/database/db.ts`
- 4-file cycle: `src/core/database/db.ts -> src/services/index.ts -> src/services/admin.ts -> src/services/db.ts -> src/core/database/db.ts`
- 4-file cycle: `src/core/database/db.ts -> src/services/index.ts -> src/services/anomaly.ts -> src/services/db.ts -> src/core/database/db.ts`
- 4-file cycle: `src/core/database/db.ts -> src/services/index.ts -> src/services/consumable-estimator.ts -> src/services/db.ts -> src/core/database/db.ts`
- 4-file cycle: `src/core/database/db.ts -> src/services/index.ts -> src/services/feedback.ts -> src/services/db.ts -> src/core/database/db.ts`
- 4-file cycle: `src/core/database/db.ts -> src/services/index.ts -> src/services/financial-ledger.ts -> src/services/db.ts -> src/core/database/db.ts`
- 4-file cycle: `src/core/database/db.ts -> src/services/index.ts -> src/services/hopper.ts -> src/services/db.ts -> src/core/database/db.ts`
- 4-file cycle: `src/core/database/db.ts -> src/services/index.ts -> src/services/print-spooler.ts -> src/services/db.ts -> src/core/database/db.ts`
- 4-file cycle: `src/core/database/db.ts -> src/services/index.ts -> src/services/printer-fault-lock.ts -> src/services/db.ts -> src/core/database/db.ts`
- 4-file cycle: `src/core/database/db.ts -> src/services/index.ts -> src/services/printer-status.ts -> src/services/db.ts -> src/core/database/db.ts`
- 4-file cycle: `src/core/database/db.ts -> src/services/index.ts -> src/services/recovery.ts -> src/services/db.ts -> src/core/database/db.ts`
- 4-file cycle: `src/core/database/db.ts -> src/services/index.ts -> src/services/report-issue.ts -> src/services/db.ts -> src/core/database/db.ts`
- 4-file cycle: `src/core/database/db.ts -> src/services/index.ts -> src/services/serial.ts -> src/services/db.ts -> src/core/database/db.ts`
- 4-file cycle: `src/core/database/db.ts -> src/services/index.ts -> src/services/time-source.ts -> src/services/db.ts -> src/core/database/db.ts`
- 5-file cycle: `src/core/database/db.ts -> src/services/index.ts -> src/services/print-quote.ts -> src/services/admin.ts -> src/services/db.ts -> src/core/database/db.ts`

## Hyperedges (group relationships)
- **ESP32 Hardware Coin Bridge Architecture** — agent_docs_hardware_integration_esp32_serial_telemetry, agent_docs_hardware_integration_coin_event_idempotency, agent_docs_hardware_integration_esp32_dual_mode_firmware, agent_docs_hardware_integration_esp32_dynamic_discovery_nvs [EXTRACTED 1.00]
- **Graphify Incremental Extraction and Merge Pipeline** — codex_skills_graphify_references_update_incremental_extraction, codex_skills_graphify_references_update_build_merge, codex_skills_graphify_references_update_code_only_fast_path [EXTRACTED 1.00]
- **PrintBit Multi-Format Document Dispatch Pipeline** — agent_docs_print_dispatch_dispatch_modes, agent_docs_print_dispatch_external_print_binaries, agent_docs_print_dispatch_spooler_monitoring [EXTRACTED 1.00]
- **Kiosk Payment and Job Confirmation Flow** — src_assets_copy_steps_copy_5_confirm_and_pay_screen, src_assets_copy_steps_copy_5_coin_payment_slot_interface, src_assets_copy_steps_copy_5_copy_job_summary, src_assets_copy_steps_copy_5_confirm_copy_action [EXTRACTED 1.00]
- **Mobile Document Upload Flow** — src_assets_print_steps_step_3_send_to_printbit_screen, src_assets_print_steps_step_3_session_kiosk_connection, src_assets_print_steps_step_3_file_upload_queue, src_assets_print_steps_step_3_send_to_kiosk_action [EXTRACTED 1.00]
- **Received File Selection and Progression Flow** — src_assets_print_steps_step_5_received_files_screen, src_assets_print_steps_step_5_received_files_management, src_assets_print_steps_step_5_qr_upload_panel, src_assets_print_steps_step_5_step_progression [EXTRACTED 1.00]
- **Print Configuration and Live Preview Flow** — src_assets_print_steps_step_6_live_preview_screen, src_assets_print_steps_step_6_print_options_customization, src_assets_print_steps_step_6_real_time_pricing_summary, src_assets_print_steps_step_6_document_preview_navigation [EXTRACTED 1.00]
- **Kiosk Multi-Service Hardware Workflows** — src_public_copy_index_document_copy_workflow, src_public_scan_index_scan_to_softcopy_workflow, src_public_scc_index_smart_coin_console [INFERRED 0.85]
- **Copy Workflow Document Verification Flow** — src_assets_copy_steps_copy_3_document_preview_screen, src_assets_copy_steps_copy_3_scanned_document_preview, src_assets_copy_steps_copy_3_step_check_document_stage, src_assets_copy_steps_copy_3_copy_to_config_transition [INFERRED 0.95]
- **Kiosk Administration & Diagnostics Suite** — src_public_admin_dashboard_index_operations_dashboard, src_public_admin_system_index_system_control_center, src_public_admin_settings_index_policy_and_settings, src_public_admin_transactions_index_transaction_ledger, src_public_admin_alerts_index_anomaly_alert_desk [INFERRED 0.95]
- **Kiosk End-to-End User Print Workflow** — src_public_index_kiosk_landing, src_public_print_index_wireless_queue_manager, src_public_upload_index_mobile_upload_portal, src_public_config_index_print_configuration, src_public_confirm_index_payment_orchestrator, src_public_receipt_index_electronic_receipt [INFERRED 0.95]

## Communities (277 total, 65 thin omitted)

### Community 0 - "confirm/app.ts"
Cohesion: 0.01
Nodes (132): RFC-4122, actionCol, actionPriceValue, backLink, balanceValue, BLOCKED_PRINTER_STATUSES, changeRow, changeValue (+124 more)

### Community 1 - "printer-status.ts"
Cohesion: 0.08
Nodes (58): RFC-3805, applyConnectionSignals(), cached, COLOR_HINT_MAP, colorHintFromName(), detectConnectionType(), detectInkLevels(), ensureCriticalNotAboveLow() (+50 more)

### Community 2 - "transactions/app.ts"
Cohesion: 0.03
Nodes (83): allLogs, applyFilters(), applyFiltersBtn, applyFilterStateFromInputs(), applyLogs(), buildFilterParams(), clearAllTransactionLogs(), clearFiltersBtn (+75 more)

### Community 3 - "config/app.ts"
Cohesion: 0.03
Nodes (63): backLink, ColorMode, colorModeGroup, continueBtn, copiesDec, copiesGroup, copiesInc, copiesInput (+55 more)

### Community 4 - "receipt.service.ts"
Cohesion: 0.11
Nodes (24): ReceiptChangeSnapshot, ReceiptChangeState, ReceiptMode, ReceiptController, appendCleanupLog(), CleanupTrigger, ReceiptModuleDeps, registerReceiptModule() (+16 more)

### Community 5 - "scan/app.ts"
Cohesion: 0.05
Nodes (58): backBtn, classifyScanFailure(), errorSubtext, errorText, formatPeso(), goToPage(), hideScanTroubleshooting(), initializeScanPage() (+50 more)

### Community 7 - "print-dispatcher.ts"
Cohesion: 0.08
Nodes (33): LIBREOFFICE_PATH, PDFTOPRINTER_PATH, PRINT_DISPATCH_LIBREOFFICE_TIMEOUT_MS, PRINT_DISPATCH_MODE, PRINT_DISPATCH_TIMEOUT_MS, PrintDispatchMode, buildSumatraSettings(), coerceStdout() (+25 more)

### Community 8 - "scanner.service.ts"
Cohesion: 0.07
Nodes (26): ColorAnalysisResult, FORMAT_CONTENT_TYPES, InteractiveScanInput, InteractiveScanResult, ScanFileReleaseResult, ScanJobInput, ScannerPageColor, ScannerPageSource (+18 more)

### Community 9 - "public/app.ts"
Cohesion: 0.04
Nodes (53): adminCancelBtn, adminOverlay, adminPinError, adminPinInput, adminSubmitBtn, brandArea, buildWifiQrPayload(), clockDateEl (+45 more)

### Community 10 - "system/app.ts"
Cohesion: 0.05
Nodes (47): applyPrinterExt(), applyPrinterSelectionBtn, applySystem(), BLOCKED_PRINTER_STATUSES, connectSocket(), hostStatus, isPrinterReadyForJobs(), mergePrinterSnapshot() (+39 more)

### Community 11 - "upload/app.ts"
Cohesion: 0.07
Nodes (52): addFilesToQueue(), applySessionCountdown(), attachSocket(), clearQueueForRetry(), clearStatus(), collectUnsupportedFiles(), createQueueItem(), dropZone (+44 more)

### Community 12 - "src/middleware/index.ts"
Cohesion: 0.06
Nodes (33): CAPTIVE_PORTAL_ENABLED, isLocalRequestIp(), isPrivateIpv4(), normalizeIp(), requireAdminLocalAccess(), requireAdminPin(), APPLE_HOSTS, CAPTIVE_HOSTS (+25 more)

### Community 13 - "file-validation.ts"
Cohesion: 0.08
Nodes (43): appendSecurityLog(), classifyDetectedMime(), DANGEROUS_SCRIPT_OR_EXECUTABLE_EXTENSIONS, detectDisguisedExecutableName(), DOCUMENT_UPLOAD_POLICY, extractRequestContext(), fileFilter(), findEndOfCentralDirectoryOffset() (+35 more)

### Community 14 - "admin/report/app.ts"
Cohesion: 0.07
Nodes (45): allItems, applyFilter(), AttachmentMeta, closeDetail, closeDetailModal(), detailAckBtn, detailBody, detailOverlay (+37 more)

### Community 15 - "copy/app.ts"
Cohesion: 0.07
Nodes (44): backBtn, checkDocBtn, checkForDocument(), classifyCopyFailure(), clearPreviewImageUrl(), continueBtn, COPY_FAILURE_GUIDES, CopyFailureCause (+36 more)

### Community 16 - "financial.service.ts"
Cohesion: 0.05
Nodes (34): Schema, consumablesStore, ReceiptRecordStatus, migrateSchemaSnapshotToRuntimeState(), readRuntimeState(), writeRuntimeState(), evaluateConsumablesForecastAlerts(), FinancialController (+26 more)

### Community 17 - "earnings/app.ts"
Cohesion: 0.08
Nodes (39): EarningsAnalyticsPair, loadEarningsAnalyticsPair(), LoadOneEarningsAnalytics, getEarningsAnalyticsRequestKey(), isCurrentEarningsAnalyticsRequest(), anchorDate, anchorDateInput, applyEarnings() (+31 more)

### Community 18 - "print/app.ts"
Cohesion: 0.05
Nodes (39): buildWifiQrPayload(), continueBtn, DeleteDocumentResponse, deletingDocumentIds, deriveInternetUploadUrl(), dialogCancelBtn, dialogConfirmBtn, dialogOverlay (+31 more)

### Community 19 - "hopper.ts"
Cohesion: 0.15
Nodes (15): ESP32_AP_BASE_URL, ESP32_COIN_BRIDGE_API_KEY, NETWORK_PROVIDER, Esp32DispenseAttemptResult, Esp32HopperStatus, HopperService, buildDispenseCommand(), buildSelfTestCommand() (+7 more)

### Community 20 - "recovery.ts"
Cohesion: 0.12
Nodes (38): RecoveryLifecycleState, SpoolerLifecycleState, persistAndEmitPrintLifecycleState(), PrintLifecycleStatePayload, baseRecoveryEntry(), baseSpoolerLifecycleRecord(), checkpointRecoverySession(), coerceFiniteInteger() (+30 more)

### Community 21 - "serial.ts"
Cohesion: 0.11
Nodes (25): ESP32_ALWAYS_ACCEPT_COINS, mapHopperErrorSeverity(), parseLegacyHopperResponse(), ACCEPTED_COINS, armPendingHopperTimeout(), attemptSerialConnection(), clearSerialReconnectTimer(), completePendingHopperCommand() (+17 more)

### Community 22 - "prepare-print-pdf.ts"
Cohesion: 0.15
Nodes (19): GHOSTSCRIPT_PATH, SUMATRA_PATH, applyGrayscalePdf(), applyTransforms(), ensurePdfSource(), execFileAsync, expandPageRange(), getPaperSizePoints() (+11 more)

### Community 23 - "database/db.ts"
Cohesion: 0.06
Nodes (59): buildLowDbImportSnapshot(), cloneDefaultData(), CoinStats, DEFAULT_DATA, HopperSettings, HopperStats, initDB(), JobStats (+51 more)

### Community 24 - "settings/app.ts"
Cohesion: 0.05
Nodes (39): alertDashboardEnabled, alertEmailEnabled, alertEmailFrom, alertEmailTo, alertEmailUsername, alertSeverityThreshold, alertSmtpHost, alertSmtpPort (+31 more)

### Community 25 - "alerts/app.ts"
Cohesion: 0.07
Nodes (35): AdminAlertsSocket, AnomalyIncident, AnomalyListResponse, cleanupLiveUpdates(), closeDetail, connectSocket(), detailAckBtn, detailBody (+27 more)

### Community 26 - "app.module.ts"
Cohesion: 0.14
Nodes (19): AppModuleDeps, registerAppModules(), PORTAL_ASSETS, PORTAL_DIR, PUBLIC_PAGE_ROUTES, UPLOAD_DIR, AdminControllerDeps, AdminModuleDeps (+11 more)

### Community 27 - "server.ts"
Cohesion: 0.07
Nodes (34): PUBLIC_DIR, SESSION_EXPIRY_ENABLED, WORKER_RETURN_MAX_BYTES, WORKER_RETURN_PIPE_NAME, app, gracefulShutdown(), io, markStartupFailed() (+26 more)

### Community 29 - "admin/feedback/app.ts"
Cohesion: 0.09
Nodes (34): showEarningsError(), allItems, clearAllBtn, displayItems, escapeHtml(), exportCsvBtn, FeedbackEntry, feedbackList (+26 more)

### Community 30 - "AdminService"
Cohesion: 0.12
Nodes (14): ColorMode, PrintMode, AdminLogEntry, PrintQuality, AdminService, buildPrintQuote(), getTotalPages(), normalizeRangeString() (+6 more)

### Community 31 - "dashboard/app.ts"
Cohesion: 0.07
Nodes (33): applyConsumablesForecast(), applyInkEstimation(), applySummary(), barCopy, barPrint, barScan, clearStorageBtn, earningsToday (+25 more)

### Community 32 - "sqlite-storage.ts"
Cohesion: 0.09
Nodes (28): feedbackStore, PricingAnalysisCacheEntry, PricingAnalysisCacheSqliteStore, pricingAnalysisCacheStore, ListReceiptOptions, ReceiptAccessTokenEntry, receiptStore, ReceiptTokenLookupResult (+20 more)

### Community 33 - "admin.controller.ts"
Cohesion: 0.10
Nodes (24): db, adminAuthRateLimit, adminStorageClearRateLimit, adminTestPrintRateLimit, adminTimeSyncRateLimit, isWholePeso(), normalizeTargetPrinterName(), assertPrintDispatcherReady (+16 more)

### Community 35 - "document-analysis.ts"
Cohesion: 0.10
Nodes (27): COLOR_PAGE_COVERAGE_THRESHOLD, COLOR_SATURATION_THRESHOLD, FULL_COLOR_PAGE_COVERAGE_THRESHOLD, MAX_PIXELS_TO_SAMPLE, MIN_CONTENT_COVERAGE_THRESHOLD, PDF_RENDER_SCALE, AnalysisConfidence, AnalyzedFileType (+19 more)

### Community 36 - "HttpException"
Cohesion: 0.14
Nodes (10): BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException, ServiceUnavailableException, UnauthorizedException, UnprocessableEntityException (+2 more)

### Community 37 - "Hardware Integration Architecture"
Cohesion: 0.09
Nodes (30): Documentation Sync Rules, Mandatory Code-to-Doc Sync Mapping Matrix, Hardware Integration Architecture, Dual-Layer Coin Insertion Idempotency Guarantee, ESP32 Dual AP/STA Mode Firmware Architecture, ESP32 NVS Persistence & mDNS Gateway, ESP32 Serial Telemetry Protocol, ESP32 Hopper Dispense Protocol (+22 more)

### Community 38 - "WirelessSessionService"
Cohesion: 0.11
Nodes (8): isWhitespaceCharacter(), WirelessSessionService, getPricingAnalysisJobStatus(), PricingAnalysisJobData, setPricingAnalysisJobProcessor(), startPricingAnalysisWorker(), DocumentAnalysis, UploadedDocument

### Community 39 - "refreshPrintQuote"
Cohesion: 0.11
Nodes (29): clampSinglePage(), currentPreviewConfig(), getCopies(), getPageRange(), getPageRangeMaxPages(), getRadio(), getSelectedQuality(), hasMultiplePages() (+21 more)

### Community 40 - "public/report/app.ts"
Cohesion: 0.07
Nodes (26): ALLOWED_TYPES, AppState, attachedFiles, attachmentIds, attachmentList, AttachmentResponse, CATEGORIES, categoryChips (+18 more)

### Community 41 - "print-queue.orchestration.ts"
Cohesion: 0.07
Nodes (29): WORKER_PIPE_NAME, WORKER_PRECHECKS_ENABLED, WORKER_QUEUE_DIR, PrintWorkerOrchestrationResult, TODO: Call getPrinterTelemetry() to verify printer online, TODO: Call evaluateInkPreflight() to verify ink levels, TODO: Validate document file exists and is accessible, TODO: Verify required amount vs balance (+21 more)

### Community 42 - "LogMeta"
Cohesion: 0.11
Nodes (22): LogMeta, ReportIssueCategory, ReportIssueEntry, ReportIssueStatus, CreateAdminReportIssueInput, CreateSessionResult, ListReportIssueOptions, ListReportIssueResult (+14 more)

### Community 43 - "consumables.service.ts"
Cohesion: 0.19
Nodes (13): ConsumableInkSnapshotEntry, ConsumableForecastStatus, ConsumablesForecastResponse, estimateInkConfidence(), ForecastConfidence, InkConsumableForecast, isForecastIncidentFingerprint(), normalizePrinterName() (+5 more)

### Community 44 - "receipt/app.ts"
Cohesion: 0.12
Nodes (28): downloadBtn, downloadReceiptAsPdf(), fetchReceiptPayload(), fields, fmtChangeState(), fmtDate(), fmtMode(), fmtPeso() (+20 more)

### Community 45 - "PrintBit Architecture"
Cohesion: 0.11
Nodes (19): 1) HTTP + realtime layer, 2) Route layer (`src/routes`), 3) Database layer (`src/core/database`), 4) Frontend layer (`src/public`), 4) Service layer (`src/services`), A) Print flow (wireless upload), B) Document analysis (per-page pricing classification), C) Copy flow (+11 more)

### Community 46 - "http.config.ts"
Cohesion: 0.08
Nodes (29): alwaysAcceptCoinTokens, ESP32_CAPTIVE_PORTAL_PATH, ESP32_COIN_BRIDGE_RELAXED_MODE, ESP32_COIN_BRIDGE_SOURCE, ESP32_KIOSK_IP, ESP32_KIOSK_SUBNET_PREFIX, ESP32_REGISTER_TOKEN, HOTSPOT_AUTH_TYPE (+21 more)

### Community 47 - "SessionStore"
Cohesion: 0.13
Nodes (5): WirelessSessionDocumentStorageEntry, FinancialServiceDeps, buildPublicUploadUrl(), buildUploadUrl(), SessionStore

### Community 48 - "print-queue/index.ts"
Cohesion: 0.13
Nodes (24): AdminOperatorAction, AdminQueueAttemptRecord, AdminQueueDashboardData, AdminQueueJobFilters, AdminQueueJobQueryResult, AdminQueueJobRecord, AdminTransactionSupervisionRecord, buildConsumptionFingerprint() (+16 more)

### Community 49 - "watchdog-health.ts"
Cohesion: 0.08
Nodes (30): WATCHDOG_ALERT_THRESHOLD, WatchdogController, WatchdogControllerDeps, registerWatchdogModule(), WatchdogModuleDeps, WatchdogService, APP_HEARTBEAT_INTERVAL_MS, cloneContext() (+22 more)

### Community 50 - "PrintPreview"
Cohesion: 0.23
Nodes (3): previewLog(), PrintPreview, syncPreviewPageWithRange()

### Community 51 - "scripts"
Cohesion: 0.07
Nodes (27): scripts, build, db:reset, dev, driver:verify, ensure-network, install-kiosk, install-startup (+19 more)

### Community 52 - "getSqliteDb"
Cohesion: 0.08
Nodes (12): jsonOrNull(), ReceiptSqliteStore, dateMs(), jsonOrNull(), ListReportIssueOptions, normalizeLogMeta(), parseJsonValue(), ReportIssueSqliteStore (+4 more)

### Community 53 - "ReportService"
Cohesion: 0.11
Nodes (5): validateReportIssueAttachmentMagicBytes(), ReportController, registerReportModule(), ReportModuleDeps, ReportService

### Community 54 - "kiosk-i18n.ts"
Cohesion: 0.14
Nodes (26): bootKioskLocalization(), applyAttributeTranslation(), applyHighContrast(), applyTextNodeTranslation(), currentTranslations, ensureAriaLabels(), ensureControlBar(), flushQueuedLocalization() (+18 more)

### Community 55 - "loading-animation.spec.ts"
Cohesion: 0.08
Nodes (7): FakeClassList, FakeDocument, FakeElement, FakeMotionQuery, FakePlayer, LoadingAnimationModule, PlayerEvent

### Community 56 - "generate-confirm-lottie-assets.js"
Cohesion: 0.22
Nodes (25): animatedValue(), baseAnimation(), COLOR, crc32(), CRC_TABLE, createCopyingAnimation(), createPixelLayer(), createPrintingAnimation() (+17 more)

### Community 57 - "getTrustedTimestamp"
Cohesion: 0.16
Nodes (25): withBalanceLock(), FinancialEventType, FinancialLedgerEntry, PendingRefundEntry, AppendLedgerInput, computeHash(), FinancialLedgerService, serializeForHash() (+17 more)

### Community 58 - "LanguageService"
Cohesion: 0.16
Nodes (10): SupportedLanguage, KioskPreferences, LanguageController, LanguageModuleDeps, registerLanguageModule(), LANGUAGE_LABELS, LanguageData, LanguageService (+2 more)

### Community 60 - "PrintBit Operations Runbook"
Cohesion: 0.05
Nodes (40): 1) Queue identity and USB port mapping verification, 2) Windows spooler health and queue observation, 3) Physical printer checks (on-device), 4) USB cable and driver stability across reconnect/restart, 5) Transaction/reference ID correlation to physical output, Baseline setup, Coins not updating, Common checks (+32 more)

### Community 61 - "printer.service.ts"
Cohesion: 0.08
Nodes (34): execFileAsync, findSpoolerJobIdByCorrelationKey(), parseIsoMs(), PrintError, PrinterService, PrinterStatusResponse, rewriteSidecarPageRange(), computeResubmitPlan() (+26 more)

### Community 62 - "scc/app.ts"
Cohesion: 0.14
Nodes (23): authViewEl, bindCoinButtons(), bindResetButton(), bootstrap(), COIN_VALUE_TO_DENOM, coinButtons, connectSocket(), Counters (+15 more)

### Community 63 - "markWatchdogHeartbeat"
Cohesion: 0.48
Nodes (3): ensureFirewallRules(), HotspotService, markWatchdogHeartbeat()

### Community 64 - "AnomalyService"
Cohesion: 0.16
Nodes (4): AlertSettings, AnomalyIncidentEntry, AnomalyService, ListAnomalyResult

### Community 65 - "copy.service.ts"
Cohesion: 0.10
Nodes (15): CopyController, CopyModuleDeps, registerCopyModule(), ClaimIdempotencyResult, CopyService, CopyServiceDeps, CreateCopyJobInput, CreateCopyJobResult (+7 more)

### Community 67 - "loading-animation.ts"
Cohesion: 0.10
Nodes (11): LOADING_ANIMATION_ASSETS, LoadingAnimationController, LoadingAnimationDependencies, LoadingAnimationMode, LoadingAnimationPlayer, LoadingAnimationRoot, MotionQuery, mountLoadingAnimation() (+3 more)

### Community 68 - "dependencies"
Cohesion: 0.09
Nodes (23): argon2, canvas, cookie-parser, file-type, i18next, i18next-fs-backend, @lottiefiles/dotlottie-web, multer (+15 more)

### Community 69 - "print-spooler.ts"
Cohesion: 0.11
Nodes (23): PRINT_SPOOLER_LOOKBACK_MINUTES, PRINT_SPOOLER_MONITOR_WINDOW_MS, PRINT_SPOOLER_POLL_INTERVAL_MS, PRINT_SPOOLER_QUERY_TIMEOUT_MS, classifyQueryErrorCode(), classifySpoolerJobError(), matchesStatusSet(), monitorSpoolerJob() (+15 more)

### Community 70 - "Detailed findings"
Cohesion: 0.05
Nodes (36): Detailed findings, Executive summary, Existing controls worth preserving, Page coverage matrix, PB-AUTH-001 — Mutable kiosk and hardware APIs are unauthenticated, PB-AUTH-002 — Active sessions and Socket.IO rooms can be claimed or disrupted, PB-DEVICE-001 — Printer and serial auto-selection can report the wrong hardware, PB-DOC-001 — Operational documentation contradicts the repository (+28 more)

### Community 71 - "time-source.ts"
Cohesion: 0.16
Nodes (21): TrustedTimestampMeta, buildStatusFromOffset(), isUnsyncedSource(), normalizeW32ComputerName(), parseStatusValue(), parseStripchartOffsetMs(), readConfiguredOffsetMs(), readEnforceFlag() (+13 more)

### Community 72 - "HotspotService"
Cohesion: 0.17
Nodes (9): HotspotController, HotspotModuleDeps, registerHotspotModule(), HotspotService, getHotspotConfig(), HotspotConfigPayload, isHotspotRunning(), startHotspot() (+1 more)

### Community 73 - "Graphify Incremental Update Reference"
Cohesion: 0.10
Nodes (22): Graphify Add Watch Reference, File Watch Debounce Mechanism, Graphify File Watch Loop, Graphify Extraction Specification, Discrete Edge Confidence Scoring Rule, Deterministic Node ID Specification, Semantic Extraction Subagent Prompt, Graphify GitHub and Merge Reference (+14 more)

### Community 74 - "watchdog.ps1"
Cohesion: 0.13
Nodes (10): Ensure-EdgeRunning(), Ensure-ServerRunning(), Get-Esp32KioskIp(), Get-KioskLocalIp(), Get-NetworkProvider(), Get-NodeServerProcess(), Get-WatchdogHealth(), Read-WebExceptionJsonBody() (+2 more)

### Community 75 - "printer-monitor.ts"
Cohesion: 0.15
Nodes (21): buildAnomalyFingerprint(), clearPrinterFaultLock(), getPrinterFaultLock(), normalizeContext(), PrinterFaultLockState, setPrinterFaultLock(), snapshot(), state (+13 more)

### Community 76 - "FeedbackSqliteStore"
Cohesion: 0.14
Nodes (6): FeedbackSqliteStore, jsonOrNull(), ListFeedbackOptions, normalizeLogMeta(), parseJsonValue(), toIsoDate()

### Community 77 - "logs/app.ts"
Cohesion: 0.13
Nodes (21): allLogs, applyLogs(), clearAllLogs(), clearLogsBtn, escapeHtml(), exportLogsBtn, loadData(), loadSummary() (+13 more)

### Community 78 - "public/feedback/app.ts"
Cohesion: 0.10
Nodes (20): applyStars(), AppState, buildStarRating(), CATEGORIES, categoryChips, commentCounter, commentInput, feedbackForm (+12 more)

### Community 79 - "color-detection.ts"
Cohesion: 0.13
Nodes (16): clampByte(), ColorDetectionResult, detectPdfColorContent(), getImageColorStats(), ImageColorStats, isPdfImageObject(), isPendingPdfObjectLookupError(), parseImageName() (+8 more)

### Community 80 - "scanner.ts"
Cohesion: 0.15
Nodes (11): buildNaps2Args(), detectScanner(), listNaps2Devices(), Naps2ScannerAdapter, parseDeviceLines(), runtimeStatus, ScannerDriver, ScannerJobResult (+3 more)

### Community 81 - "session.ts"
Cohesion: 0.14
Nodes (17): PUBLIC_URL, ALLOWED_TYPES, deriveEsp32SubnetPrefix(), detectEsp32KioskAddress(), detectHotspotAddress(), detectPreferredLocalKioskAddress(), DOCUMENT_ANALYSIS_FILE_TYPES, DocumentPageAnalysis (+9 more)

### Community 82 - "FeedbackService"
Cohesion: 0.13
Nodes (9): FeedbackCategory, FeedbackEntry, FeedbackSessionEntry, FeedbackStatus, CreateSessionResult, FeedbackService, ListFeedbackOptions, ListFeedbackResult (+1 more)

### Community 83 - "admin.schema.ts"
Cohesion: 0.11
Nodes (16): ColorMode, PrintMode, AdminLockout, AdminSettings, AlertDashboardSettings, AlertDedupeSettings, AlertEmailSettings, ConsumableEstimationCoefficients (+8 more)

### Community 84 - "hopper/index.ts"
Cohesion: 0.19
Nodes (10): HopperController, TODO: Define routes, getHopperService(), HopperModuleDeps, registerHopperModule(), HopperSettings, HopperStats, OwedChangeEntry (+2 more)

### Community 85 - "UploadPortalService"
Cohesion: 0.19
Nodes (7): uploadPortalAssetRateLimit, UploadPortalController, uploadPortalPageRateLimit, registerUploadPortalModule(), UploadPortalModuleDeps, UploadPortalService, UploadPortalServiceDeps

### Community 86 - "Admin APIs"
Cohesion: 0.06
Nodes (33): Admin APIs, `DELETE /api/admin/logs/system`, `DELETE /api/admin/logs/transactions`, `GET /api/admin/consumables/forecast`, `GET /api/admin/logs/system`, `GET /api/admin/logs/system/export.csv`, `GET /api/admin/logs/transactions`, `GET /api/admin/logs/transactions/export.csv` (+25 more)

### Community 87 - "FeedbackService"
Cohesion: 0.08
Nodes (18): FEEDBACK_PORTAL_ASSETS, FEEDBACK_PORTAL_DIR, FEEDBACK_PORTAL_TEMPLATE, FeedbackController, FeedbackControllerDeps, feedbackPortalAssetRateLimit, renderFeedbackPortal(), FeedbackModuleDeps (+10 more)

### Community 89 - "compilerOptions"
Cohesion: 0.11
Nodes (17): config, jest, jest.config.ts, node, src, tests, compilerOptions, esModuleInterop (+9 more)

### Community 90 - "scanner.controller.ts"
Cohesion: 0.12
Nodes (17): USB_EXPORT_ENABLED, buckets, createRateLimit(), DEFAULT_MESSAGE, getClientKey(), purgeExpiredBuckets(), RateLimitBucket, RateLimitMessage (+9 more)

### Community 91 - "consumables.model.ts"
Cohesion: 0.16
Nodes (7): CONSUMABLE_TELEMETRY_CLEANUP_INTERVAL_MS, CONSUMABLE_TELEMETRY_RETENTION_DAYS, ConsumableInkSnapshotSupply, ConsumablesSqliteStore, InkHistoryEntry, InkRefillBaseline, parseJsonValue()

### Community 92 - "Kiosk Main Landing and Service Launcher"
Cohesion: 0.11
Nodes (19): Transaction Ledger Viewer, Interactive Document Preview Rationale, Print Configuration and Document Preview, Payment Safety and Hardware Guard Rationale, Payment Settlement and Job Orchestrator, Scanner Troubleshooting and Recovery Rationale, Document Copy Workflow, Idle Kiosk Interface Hierarchy (+11 more)

### Community 93 - "loading/app.ts"
Cohesion: 0.18
Nodes (17): connectionText, fetchReadiness(), formatRetry(), metaText, phaseChipText, phaseText, poll(), retryText (+9 more)

### Community 94 - "LogMeta"
Cohesion: 0.25
Nodes (15): LogMeta, AlertChannel, AnomalyCategory, AnomalySeverity, AnomalyStatus, AnomalyModuleDeps, registerAnomalyModule(), AnomalyIncidentEntry (+7 more)

### Community 95 - "wA"
Cohesion: 0.20
Nodes (17): A(), B(), n(), r(), B(), cn(), E(), H() (+9 more)

### Community 96 - "services/index.ts"
Cohesion: 0.11
Nodes (24): NormalizedCopyJobInput, IMAGE_EXTENSIONS, normalizeFileExtension(), OFFICE_EXTENSIONS, preparePrintRotationArtifact(), prepareScanRotationArtifact(), ROTATED_PRINT_DIR, rotateFileToPath() (+16 more)

### Community 97 - "5. Architectural patterns and conventions"
Cohesion: 0.07
Nodes (29): 10. Companion workspace: `printbit-worker/`, 11. Quick orientation for new sessions, 1. Project overview, 2. Repository layout, 3. Domain model, 4. API surface, 5. Architectural patterns and conventions, 6. Build, run, and test commands (+21 more)

### Community 98 - "printer-guard.ts"
Cohesion: 0.23
Nodes (13): applyState(), checkStatusOnLoad(), destroyPrinterGuard(), getIdleScreen(), getOverlay(), initPrinterGuard(), isPrinterBlocked(), MalfunctionPayload (+5 more)

### Community 99 - "What You Must Do When Invoked"
Cohesion: 0.08
Nodes (24): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+16 more)

### Community 100 - "pricing-analysis-queue.ts"
Cohesion: 0.21
Nodes (11): buildForceJobId(), buildStableJobId(), enqueuePricingAnalysisJob(), jobStore, LocalJob, PricingAnalysisJobEnqueueResult, PricingAnalysisJobProcessor, PricingAnalysisJobStatusResult (+3 more)

### Community 101 - "applyConfirmGate"
Cohesion: 0.17
Nodes (16): applyConfirmGate(), applyLockState(), boot(), clearPrinterError(), fetchInitialBalance(), formatColorMode(), formatPaperSizeForPricing(), getColorModeSummaryLabel() (+8 more)

### Community 102 - "finalizePrintSuccess"
Cohesion: 0.15
Nodes (16): captureReceiptCta(), captureScanDownloadCta(), checkRemainingFilesAndPrompt(), clearConfirmSessionStorage(), clearPendingPaymentSessionState(), enterWorkerPendingState(), extractReceiptUrl(), finalizePrintSuccess() (+8 more)

### Community 103 - "createSession"
Cohesion: 0.25
Nodes (16): attachSocket(), checkUploadStatus(), clearSelectedFileState(), createSession(), formatCountdown(), getCurrentSessionRemainingSeconds(), renderSessionCountdown(), resetSessionCountdown() (+8 more)

### Community 104 - "navigateWithKioskMotion"
Cohesion: 0.18
Nodes (11): navigateTo(), handlePageNavigation(), initKioskNavigation(), KioskNavigationMode, navigateWithKioskMotion(), resolveSameOriginNavigation(), CUSTOMER_PAGE_HTML, FakeElement (+3 more)

### Community 105 - "ReportIssueService"
Cohesion: 0.21
Nodes (3): ReportIssueAttachmentEntry, ReportIssueSessionEntry, ReportIssueService

### Community 106 - "admin.service.ts"
Cohesion: 0.15
Nodes (14): adminLogStore, DispatchLatencyByEngine, DispatchLatencyByMime, DispatchLatencyMetricsResult, DispatchLatencyPercentiles, DispatchLatencySpeculation, EarningsAnalyticsBucket, EarningsAnalyticsResult (+6 more)

### Community 107 - "hopper-protocol.ts"
Cohesion: 0.12
Nodes (16): ChangeComputation, HOPPER_PREFIX, HopperAckResponse, HopperCommand, HopperCommandVerb, HopperDoneResponse, HopperErrorCode, HopperErrorResponse (+8 more)

### Community 108 - "report.controller.ts"
Cohesion: 0.15
Nodes (11): reportIssueAttachmentUploadMiddleware, adminReportAttachmentRateLimit, parseLogMeta(), ReportBody, ReportControllerDeps, reportPortalAssetRateLimit, ReportIssueAttachmentEntry, ReportIssueCategory (+3 more)

### Community 109 - "shared.ts"
Cohesion: 0.19
Nodes (12): clearAdminToken(), ensureAuth(), getAdminToken(), initAuth(), showDashboard(), unlock(), InitAuthArg, InitAuthOptions (+4 more)

### Community 111 - "reset-db.js"
Cohesion: 0.21
Nodes (11): ALLOWED_TABLES, args, buildResetState(), clearSqliteOperationalTables(), countRows(), dryRun, {
  getSqliteDb,
  initSqliteStorage,
}, { initDB, db } (+3 more)

### Community 112 - "idempotency.ts"
Cohesion: 0.25
Nodes (10): balanceLockPromise, acquireIdempotencyKey(), IdempotencyEntry, idempotencyInFlight, idempotencyStore, InFlightEntry, makeDeferred(), namespacedKey() (+2 more)

### Community 113 - "print-job.schema.ts"
Cohesion: 0.17
Nodes (11): PRINT_JOB_PAYLOAD_VERSION, PrintJob, PrintJobAttempt, PrintJobContext, PrintJobCorrelation, PrintJobDispatchContext, PrintJobEnqueuePayload, PrintJobFinancialContext (+3 more)

### Community 114 - "PrinterController"
Cohesion: 0.25
Nodes (4): isValidCorrelationKey(), PrinterController, PrinterModuleDeps, registerPrinterModule()

### Community 115 - "idle-timeout.ts"
Cohesion: 0.26
Nodes (13): cachePageIdleDOMElements(), handleKeepActiveClick(), handleOverlayClick(), handlePageIdleTimeout(), hidePageIdleWarning(), idleConfig, IdleTimeoutConfig, initializePageIdleTimeout() (+5 more)

### Community 116 - "usb-drives.ts"
Cohesion: 0.24
Nodes (8): ensureSafeDrive(), exportScanToUsbDrive(), listRemovableDrives(), normalizeDrives(), parseDriveValue(), RemovableDrive, uniqueDestinationPath(), UsbDriveService

### Community 117 - "AdminLogSqliteStore"
Cohesion: 0.23
Nodes (5): AdminLogSqliteStore, changesFromRun(), normalizeLogMeta(), normalizeTrustedTimestampMeta(), parseJsonValue()

### Community 118 - "print-job.model.ts"
Cohesion: 0.21
Nodes (5): PrintJobEntry, PrintJobSqliteStore, PrintJobState, printJobStore, toPrintJobState()

### Community 119 - "wireless-session.controller.ts"
Cohesion: 0.29
Nodes (4): handleMulterError(), uploadMiddleware, wirelessPreviewRateLimit, wirelessUploadRateLimit

### Community 120 - "document-analysis.spec.ts"
Cohesion: 0.20
Nodes (10): ANALYSIS_ALGORITHM_VERSION, MockCanvasContext, mockCanvasContexts, mockedSharp, MockPageSpec, mockPdfDocument(), PageClassification, paintFrameFromSpec() (+2 more)

### Community 121 - "job-store.ts"
Cohesion: 0.20
Nodes (11): BaseJob, CopyJob, CopyJobSettings, Job, JobFailure, JobProgress, JobState, JobType (+3 more)

### Community 122 - "package.json"
Cohesion: 0.18
Nodes (10): author, description, engines, node, keywords, license, main, name (+2 more)

### Community 123 - "kiosk-helpers.psm1"
Cohesion: 0.25
Nodes (7): Save-OriginalDwordValue(), Test-RegistryValueExists(), Ensure-RegistryKey(), Get-DwordValueOrNull(), Get-StateKeySuffix(), Set-DwordValue(), Restore-DwordValue()

### Community 124 - "wireless-session.service.ts"
Cohesion: 0.24
Nodes (8): PORT, PREVIEW_CACHE_DIR, IMAGE_TYPES, PDF_CONVERT_EXTENSIONS, POWERPOINT_EXTENSIONS, WirelessSessionServiceDeps, generateHtmlPreview, supportsHtmlPreview

### Community 125 - "Design System: PrintBit"
Cohesion: 0.09
Nodes (21): Action Cards (Print, Copy, Scan), Colors, Components, **Creative North Star: "The Midnight Interface"**, Design System: PrintBit, Do, Do's and Don'ts, Don't (+13 more)

### Community 126 - "**PrintBit**"
Cohesion: 0.09
Nodes (22): 1) Install dependencies, 2) Run in development, 3) Build browser bundle, 4) Type-check, 5) One-time legacy import (optional), Additional documentation, Copy, Core capabilities (+14 more)

### Community 127 - "orchestratePrintJob"
Cohesion: 0.25
Nodes (8): buildPrintJobContext(), orchestratePrintJob(), recordJobAttempt(), WorkerOrchestrationError, buildWorkerErrorPayload(), sendWorkerError(), serializeWorkerError(), WorkerErrorPayload

### Community 128 - "handleErrorAction"
Cohesion: 0.18
Nodes (11): clearErrorActionInlineError(), fetchWithTimeout(), handleErrorAction(), hasActiveJob(), isAbortError(), releaseTransientFilesForCurrentMode(), releaseTransientScanFile(), renderPrinterError() (+3 more)

### Community 129 - "ensure-esp32-network.ps1"
Cohesion: 0.29
Nodes (6): Get-ConnectedWifiInterfaceName(), Get-EnvString(), Get-WlanInterfaces(), Resolve-Esp32GatewayIp(), Test-Ipv4Address(), Write-NetworkLog()

### Community 130 - ".handleGetAnomalyIncidents"
Cohesion: 0.20
Nodes (5): isAnomalyCategory(), isAnomalySeverity(), isAnomalyStatus(), parseAlertSettingsPayload(), toSafeAlertSettings()

### Community 131 - "ScanJobSettings"
Cohesion: 0.22
Nodes (3): ScanJobSettings, ScannerAdapter, StubScannerAdapter

### Community 132 - "loadPreview"
Cohesion: 0.29
Nodes (10): applyColorAnalysis(), applyImageOrientationDetection(), clearOrientationNotice(), fetchWithTimeout(), loadPreview(), lockColorMode(), orientationDetectionKey(), resetColorLock() (+2 more)

### Community 133 - "addFileToList"
Cohesion: 0.24
Nodes (10): addFileToList(), deleteSessionFile(), escapeHtml(), fileKey(), filesSignature(), formatBytes(), iconIdForFile(), renderFiles() (+2 more)

### Community 134 - "devDependencies"
Cohesion: 0.22
Nodes (9): esbuild, devDependencies, esbuild, @types/qrcode, @types/ws, @typescript-eslint/parser, @types/qrcode, @types/ws (+1 more)

### Community 135 - "ReceiptService"
Cohesion: 0.20
Nodes (5): ReceiptRecordEntry, isExpired(), normalizeIsoTimestamp(), parseTimestampMs(), ReceiptService

### Community 138 - "renderRefreshSessionButtonState"
Cohesion: 0.42
Nodes (9): ensureNewSessionCooldownTicker(), getNewSessionCooldownRemainingMs(), hydrateNewSessionCooldownState(), renderRefreshSessionButtonState(), requestNewSession(), showNewSessionCooldownHint(), startNewSessionCooldown(), stopNewSessionCooldownTicker() (+1 more)

### Community 139 - "transient-file-cleanup.ts"
Cohesion: 0.33
Nodes (8): CleanupStats, cleanupTransientFilesOnStartup(), deleteIfStale(), isTransientPrintUpload(), listDirectoryEntries(), parsedRetention, sweepDirectory(), TRANSIENT_PRINT_EXTENSIONS

### Community 140 - "PrintBit API Documentation"
Cohesion: 0.12
Nodes (17): Authentication and access rules, Copy APIs, `GET /api/copy/jobs/:id`, `GET /api/wireless/sessions`, `GET /api/wireless/sessions/by-token/:token`, `GET /api/wireless/sessions/:sessionId`, `GET /api/wireless/sessions/:sessionId/preview`, `GET /upload/:token` (+9 more)

### Community 142 - "bench-edge-warm.js"
Cohesion: 0.33
Nodes (5): createRunspace(), { execFile }, runPs(), { spawn }, timeScript()

### Community 143 - "build-client.js"
Cohesion: 0.29
Nodes (4): builds, { execSync }, fs, path

### Community 144 - "CLAUDE.md"
Cohesion: 0.12
Nodes (14): Architecture, Build, verify, and run, Critical invariants, Documentation by topic, graphify, Hardware integration rules, IPC with the Windows C# worker, Kiosk lifecycle scripts (Windows PowerShell) (+6 more)

### Community 145 - "Balance, pricing, and payment"
Cohesion: 0.13
Nodes (15): Balance, pricing, and payment, `GET /api/admin/transactions/:transactionId/receipt`, `GET /api/admin/transactions/:transactionId/receipt/pdf`, `GET /api/balance`, `GET /api/pricing`, `GET /api/pricing-config`, `GET /api/receipts/by-token/:token`, `GET /api/receipts/by-token/:token/pdf` (+7 more)

### Community 146 - "api-aware-app.ts"
Cohesion: 0.38
Nodes (6): createApiAwareApp(), remapApiPath(), ROUTABLE_METHODS, RoutableMethod, RouterMethod, shouldUseApiRouter()

### Community 147 - "scan-storage.ts"
Cohesion: 0.38
Nodes (4): parsedRetention, SCAN_DIR, ScanStorageService, startScanStorageCleanup()

### Community 148 - "PrintBit ESP32 Wi-Fi & Firmware Setup Guide"
Cohesion: 0.13
Nodes (14): 1. Network Architecture Overview, 2. Flashing the Firmware, 3. Initial Boot & Factory Defaults, 4. Setting Up the Kiosk PC / Windows Tablet, 5. Accessing the Admin Dashboard from Phone / Tablet, 6. Configuring External Router Wi-Fi (Over-the-Air Setup Portal), 7. Serial Management & Diagnostics Reference, 8. Troubleshooting Checklist (+6 more)

### Community 149 - "High Severity Launch Priority Classification"
Cohesion: 0.33
Nodes (6): Critical Gap Issue Template, Critical Pre-Launch Blocker Severity, High Gap Issue Template, High Severity Launch Priority Classification, Medium Gap Issue Template, Medium Severity Post-Launch Deferral Classification

### Community 150 - "start-kiosk-server.ps1"
Cohesion: 0.47
Nodes (3): Ensure-ServerBundle(), Get-BuildCommandCandidates(), Write-StartupLog()

### Community 151 - "Coin Payment Panel"
Cohesion: 0.47
Nodes (6): Change Dispense Status, Coin Balance Display, Coin Payment Panel, Confirm and Pay Screen, Confirm and Print Action, Job Summary Panel

### Community 152 - "Security Policy"
Cohesion: 0.13
Nodes (14): Admin Access & Authentication, Changelog, Coin & Payment Security, Data Privacy & File Lifecycle, Dependency Auditing, File Upload & Malware Scanning, Known Limitations, Network & Hardware (ESP32 / WiFiManager) (+6 more)

### Community 153 - "Operations Overview Dashboard"
Cohesion: 0.33
Nodes (6): Ink Tank Level Monitoring Panel, Operations KPI and Job Breakdown, Operations Overview Dashboard, Admin Panel Entry Router, Hardware Recovery Controls Rationale, System Control Center

### Community 154 - "worker-handoff.ts"
Cohesion: 0.47
Nodes (3): handoffToWorker(), WorkerHandoffError, WorkerHandoffErrorCode

### Community 155 - "Graphify Query Reference"
Cohesion: 0.60
Nodes (5): Graphify Query Reference, Constrained Query Expansion Step, Architectural Concept Neighborhood Explanation, Knowledge Graph Path Finding, Token Budget Aware Graph Traversal

### Community 156 - "Copy Step 1: Place Document Screen"
Cohesion: 0.50
Nodes (5): Back Button, Check Document Button, Copy Step 1: Place Document Screen, Copy Steps Stepper Sidebar, Document Preview Panel

### Community 157 - "Copy Workflow Document Preview Screen"
Cohesion: 0.70
Nodes (5): Copy to Configuration Transition CTA, Copy Workflow Document Preview Screen, Scan Verification and Glass Alignment Feedback, Scanned Document Preview Verification, Check Document Workflow Step

### Community 158 - "Coin Payment Interface"
Cohesion: 0.70
Nodes (5): Coin Insertion Guidance and Validation, Coin Payment Interface, Confirm & Pay Screen, Confirm and Copy Action, Copy Job Summary

### Community 159 - "Print Step 1 Guide Screenshot"
Cohesion: 0.50
Nodes (5): Print Step 1 Guide Screenshot, New Session Action Button, Received Files Waiting State Panel, Scan Upload QR Code Component, Active Session ID Indicator

### Community 160 - "Scan & Print Step 1 Screen"
Cohesion: 0.50
Nodes (5): Document Feeder Preview Area, How to Scan Instructions Panel, Scan Document Action Button, Soft Copy 5-Peso Fee Notice, Scan & Print Step 1 Screen

### Community 161 - "Scan Document Preview Screen"
Cohesion: 0.50
Nodes (5): Document Preview, Scan Document Preview Screen, Proceed to Pay Action, Rescan Action, Soft Copy Pricing Rationale

### Community 163 - "printer.schema.ts"
Cohesion: 0.40
Nodes (4): InkHistoryEntry, Orientation, PaperSize, PrintJobOptions

### Community 164 - "Scan APIs"
Cohesion: 0.14
Nodes (14): `GET /api/scan/jobs/:id`, `GET /api/scan/jobs/:id/result`, `GET /api/scan/preview/:filename`, `GET /api/scanner/status`, `GET /api/scanner/wired/drives`, `GET /scan/download/:token`, `POST /api/scan/jobs`, `POST /api/scan/jobs/:id/cancel` (+6 more)

### Community 165 - "loadFeedbackSession"
Cohesion: 0.50
Nodes (5): closeFeedbackModal(), loadFeedbackSession(), openFeedbackModal(), setFeedbackStatus(), startExpiryCountdown()

### Community 166 - "loadReportSession"
Cohesion: 0.50
Nodes (5): closeReportModal(), loadReportSession(), openReportModal(), setReportStatus(), startReportExpiry()

### Community 167 - "renderGuideStep"
Cohesion: 0.40
Nodes (5): getGuideElements(), openGuide(), renderGuideStep(), setGuideStep(), translation()

### Community 168 - "Graphify Exports Reference"
Cohesion: 0.83
Nodes (4): Graphify Exports Reference, Graph HTML Interactive Visualization, Graph JSON Output Format, Graph Report Markdown Summary

### Community 169 - "Kiosk UI Impeccable Critique"
Cohesion: 0.83
Nodes (4): Kiosk UI Impeccable Critique, Midnight Interface Design Review, P0 Nested Interactive Button Elements Flaw, P1 Viewport Zoom & Help Icon Accessibility Flaw

### Community 170 - "Disclaimer"
Cohesion: 0.18
Nodes (10): 1. Academic Project, 2. No Warranty, 3. Limitation of Liability, 4. Hardware & Electrical Safety, 5. Financial Transactions, 6. Data & Privacy, 7. Third-Party Software, 8. Modifications & Forks (+2 more)

### Community 171 - "apply-kiosk-lockdown.ps1"
Cohesion: 0.83
Nodes (3): Ensure-RegistryKey(), Set-BinaryValue(), Set-DwordValue()

### Community 172 - "bench-end-to-end.js"
Cohesion: 0.67
Nodes (3): { execFile }, runPs(), timeScript()

### Community 174 - "Scanning Document Progress Modal"
Cohesion: 0.67
Nodes (4): Copy Flow Scanning Feedback, Document Scanning Active State, Glass Bed Placement Instruction, Scanning Document Progress Modal

### Community 175 - "Copy Live Preview and Settings Screen"
Cohesion: 0.67
Nodes (4): Copy Print Configuration Settings, Live Document Preview Viewer, Copy Live Preview and Settings Screen, Pre-Print Document Adjustment Flow

### Community 176 - "Copy Step 6 - Print Completion and E-Receipt Modal"
Cohesion: 0.50
Nodes (4): Done Action Button, E-Receipt QR Code, Copy Step 6 - Print Completion and E-Receipt Modal, Print Success Status Notification

### Community 177 - "Send to PrintBit File Upload Screen"
Cohesion: 0.67
Nodes (4): File Picker Dropzone and Supported Formats, Send to PrintBit File Upload Screen, Kiosk Document Dispatch Flow, Kiosk Session Connection Status

### Community 178 - "Send to PrintBit Upload Screen"
Cohesion: 0.67
Nodes (4): File Upload Queue, Send to Kiosk Action, Send to PrintBit Upload Screen, Kiosk Session Connection Status

### Community 179 - "Mobile Upload Success Screen"
Cohesion: 0.67
Nodes (4): File Sent Status, Kiosk Ready Confirmation, Kiosk Session Synchronization, Mobile Upload Success Screen

### Community 180 - "Received Files Screen"
Cohesion: 0.67
Nodes (4): Persistent QR Upload Panel, Received Files Management, Received Files Screen, Print Step Progression to Settings

### Community 181 - "Live Preview and Print Configuration Screen"
Cohesion: 0.67
Nodes (4): Document Preview and Zoom Navigation, Live Preview and Print Configuration Screen, Print Options Customization, Real-Time Print Pricing and Summary

### Community 182 - "Coin Balance Payment Gate"
Cohesion: 0.83
Nodes (4): Coin Balance Payment Gate, Confirm and Download Action, Scan Confirm and Pay Screen, Scan Job Summary

### Community 183 - "PrintBit Installation & Dependencies Guide"
Cohesion: 0.18
Nodes (11): 1) Platform requirements, 2) Required software, 3) Node package dependencies used by this project, 5) Windows tablet update checklist, 6) Preflight checklist (recommended), 7) Common installation issues, 8) Related docs, App dependencies (runtime) (+3 more)

### Community 184 - "scan-delivery.ts"
Cohesion: 0.25
Nodes (5): createScanDownloadLink(), parsedTtl, resolveScanDownload(), ScanDeliveryService, ScanDownloadSession

### Community 185 - "Windows 10 Production Deployment Quickstart (Assigned Access Kiosk)"
Cohesion: 0.18
Nodes (10): 1. Build the Applications, 2. Configure Machine-Wide Environment Variables, 3. Create Dedicated User Accounts, 4.1 Setup the C# Worker Service, 4.2 Register Node.js Startup and Watchdog, 4. Register Services & Startup Tasks, 5. Configure Windows 10 Assigned Access (Kiosk Mode), 6. Apply Windows Update & Lockdown Policies (Recommended) (+2 more)

### Community 186 - "te"
Cohesion: 0.50
Nodes (4): ee(), He(), te(), ye()

### Community 187 - "gs"
Cohesion: 0.50
Nodes (4): gs(), ns(), rs(), ts()

### Community 188 - "4.2) Production Installation (Kiosk Mode in `printbit` account)"
Cohesion: 0.20
Nodes (10): 4.1) Development Local Setup, 4.2) Production Installation (Kiosk Mode in `printbit` account), 4) Installation steps, Step 1: Create local user accounts, Step 2: Compile & Publish the C# Worker Service, Step 3: Install SumatraPDF & Directories, Step 4: Register C# Worker Windows Service, Step 5: Build & Install Node.js Application (+2 more)

### Community 190 - "Product"
Cohesion: 0.20
Nodes (9): Capabilities and Constraints, Evidence on Hand, Operating Context, Platform, Positioning, Product, Product Principles, Product Purpose (+1 more)

### Community 195 - "Document Scanning Progress"
Cohesion: 1.00
Nodes (3): Document Scanning Progress, Scan Finalisation Feedback, Document Scanning Progress Screen

### Community 196 - "Expiring Download Link"
Cohesion: 1.00
Nodes (3): Expiring Download Link, Scanned File Ready Dialog, QR Code Document Download

### Community 197 - "Anomaly Alert Desk"
Cohesion: 0.67
Nodes (3): Anomaly Alert Desk, Incident Triage and Resolution Workflow, System Event Logs Viewer

### Community 198 - "generateClientUuid"
Cohesion: 0.67
Nodes (3): createPaymentIdempotencyKey(), createSpoolerCorrelationKey(), generateClientUuid()

### Community 199 - "UA"
Cohesion: 0.67
Nodes (3): FA(), lA(), UA()

### Community 200 - "xB"
Cohesion: 0.67
Nodes (3): fe(), oe(), xB()

### Community 201 - ".getForecast"
Cohesion: 0.25
Nodes (5): ConsumableUsageEventEntry, isFiniteNumber(), estimatePaperConfidence(), roundTo(), toDayKey()

### Community 202 - ".parseTransactionLogFilters"
Cohesion: 0.22
Nodes (4): isTransactionLogMode(), isTransactionLogStatus(), parseIsoTimestampQuery(), TransactionLogFilters

### Community 204 - "Code of Conduct"
Cohesion: 0.17
Nodes (11): Academic Integrity, Attribution, Code of Conduct, Enforcement, ✅ Expected Behavior, Our Pledge, Our Standards, PrintBit — Coin-Operated Self-Service Printing Kiosk (+3 more)

### Community 205 - "License"
Cohesion: 0.29
Nodes (6): About This Project, Contributors, **Copyright © 2026 PrintBit Contributors**, License, MIT License, Third-Party Licenses

### Community 206 - "Copyright Notice"
Cohesion: 0.25
Nodes (7): Academic Context, Contact, Contributors, Copyright Notice, Ownership, PrintBit — Coin-Operated Self-Service Printing Kiosk, Third-Party Components

### Community 207 - "network.ts"
Cohesion: 0.57
Nodes (5): findMatchingIpv4ForSubnet(), getAllLocalIPv4s(), getLocalIPv4(), normalizeRemoteIp(), normalizeSubnetPrefix()

### Community 223 - "System and hotspot"
Cohesion: 0.33
Nodes (6): `GET /api/config/hotspot`, `GET /api/session/active`, `GET /portal`, `POST /api/hotspot/start`, `POST /api/hotspot/stop`, System and hotspot

### Community 264 - "types.ts"
Cohesion: 0.40
Nodes (4): ColorMode, Orientation, PaperSize, PrintMode

### Community 268 - "Contributing to PrintBit"
Cohesion: 0.22
Nodes (8): API and validation expectations, Codebase conventions, Contributing to PrintBit, Development setup, Hardware and runtime safety, Installation and dependency references, Testing expectations, Workflow

## Knowledge Gaps
- **1535 isolated node(s):** `config`, `name`, `version`, `description`, `main` (+1530 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **65 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AdminService` connect `AdminService` to `receipt.service.ts`, `print-dispatcher.ts`, `scanner.service.ts`, `transient-file-cleanup.ts`, `file-validation.ts`, `financial.service.ts`, `hopper.ts`, `recovery.ts`, `serial.ts`, `database/db.ts`, `server.ts`, `LogMeta`, `watchdog-health.ts`, `getTrustedTimestamp`, `copy.service.ts`, `print-spooler.ts`, `printer-monitor.ts`, `FeedbackService`, `UploadPortalService`, `FeedbackService`, `scanner.controller.ts`, `services/index.ts`, `wireless-session.service.ts`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `getSqliteDb()` connect `getSqliteDb` to `sqlite-storage.ts`, `admin.controller.ts`, `AdminController`, `FeedbackSqliteStore`, `reset-db.js`, `financial.service.ts`, `AdminLogSqliteStore`, `print-job.model.ts`, `database/db.ts`, `consumables.model.ts`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `ReportIssueEntry` connect `LogMeta` to `sqlite-storage.ts`, `ReportIssueService`, `report.controller.ts`, `getSqliteDb`, `ReportService`, `database/db.ts`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **What connects `config`, `name`, `version` to the rest of the system?**
  _1535 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `confirm/app.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.014184397163120567 - nodes in this community are weakly interconnected._
- **Should `printer-status.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08416130917592052 - nodes in this community are weakly interconnected._
- **Should `transactions/app.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.03361344537815126 - nodes in this community are weakly interconnected._