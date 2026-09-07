# PrintBit Kiosk Operations and Administration Manual

> **Document status: Draft 0.1 — not yet approved for live kiosk use**
>
> This draft is based on the current PrintBit application and hardware-worker repositories. Items marked **Client approval required**, **Release validation required**, or **Screenshot required** must be resolved before publication.

## Document Control

| Field                        | Value                           |
| ---------------------------- | ------------------------------- |
| Product                      | PrintBit Kiosk                  |
| Client/institution           | **Client approval required**    |
| Site/deployment              | **Client approval required**    |
| PrintBit application version | **Release validation required** |
| PrintBit worker version      | **Release validation required** |
| Manual version               | Draft 0.1                       |
| Publication date             | 2026-09-07                      |
| Manual owner                 | **Client approval required**    |
| Technical owner              | **Client approval required**    |
| Approved by                  | **Client approval required**    |

## How to Use This Manual

This manual has two parts:

- **Part A — Professor/Operator Guide** explains daily kiosk operation in plain language. It does not require administrator tools or technical commands.
- **Part B — IT Administrator Guide** explains installation, configuration, monitoring, recovery, updates, and technical support.

Every procedure identifies the role permitted to perform it.

### Action levels

| Level        | Meaning                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| **Continue** | The kiosk is ready or the condition has been resolved.                     |
| **Check**    | Complete the listed checks before allowing another transaction.            |
| **Stop**     | Place the kiosk out of service and contact the responsible support person. |

## Important Safety and Privacy Rules

- Never open, read, photograph, copy, or retain a student's document unless the student has explicitly asked for help and the approved privacy policy permits it.
- Never ask a student for a password, authentication code, or private account information.
- Do not include document contents, credentials, tokens, or secrets in incident reports.
- Do not reach inside a moving or powered printer.
- Follow the current Epson L5290 safety and maintenance documentation for physical printer work.
- Professors must not use PowerShell, Windows Services, Event Viewer, Registry Editor, or PrintBit configuration tools unless the client has explicitly assigned them an IT role.
- Never delete spool files, reset USB devices, kill printer processes, or manually alter PrintBit queue files as a recovery shortcut.

---

# Part A — Professor/Operator Guide

## 1. PrintBit at a Glance

**Role:** Professor/Operator

PrintBit is a self-service kiosk for printing, copying, and scanning. Students use the touchscreen and, for wireless printing or file delivery, a phone. The kiosk may accept coins according to the deployed payment configuration.

The professor/operator is responsible for:

- Checking that the kiosk and printer are ready before service begins.
- Helping students understand the on-screen steps without unnecessarily viewing their files.
- Replenishing paper or performing other physical actions only when authorized.
- Stopping new transactions when the kiosk cannot operate safely or reliably.
- Recording incidents and escalating them to the correct support contact.

The professor/operator is not responsible for:

- Changing prices, system configuration, accounts, or security settings.
- Installing software or printer drivers.
- Repairing Windows services, the PrintBit hardware worker, or network configuration.
- Approving refunds or reprints unless the client policy explicitly grants that authority.

### Normal customer flow

```text
Choose Print, Copy, or Scan
          ↓
Provide or scan the document
          ↓
Review settings and price
          ↓
Pay when required
          ↓
Print or receive the scanned file
          ↓
Collect output and receipt
```

## 2. Opening the Kiosk

### 2.1 Perform the opening check

**Role:** Professor/Operator  
**Purpose:** Confirm that PrintBit is safe and ready before students use it.  
**When to use:** At the beginning of each service period.

**Before you begin:** Make sure no student transaction is in progress.

1. Inspect the kiosk, power cables, printer, scanner, and surrounding area for visible damage, moisture, or obstruction.
2. Confirm that the kiosk display is on and shows the PrintBit home screen.
3. Confirm that the home screen offers **Print**, **Copy**, and **Scan** according to the site's enabled services.
4. Check that the printer is powered on and does not show a paper, cover, ink, jam, or service error.
5. Confirm that approved paper is loaded correctly.
6. Confirm that the scanner is powered and connected if Copy or Scan is offered.
7. Check the kiosk for an out-of-service notice or unresolved incident from the previous service period.
8. Run a test print only if the approved client policy requires or permits it.

**Expected result:** The PrintBit home screen is available, enabled devices show no fault, and the kiosk is ready within one minute.

**If it does not work:** Follow the matching condition in Section 5.

**Stop and contact:** Client IT if the home screen does not load, a device is unavailable, or a previous incident remains unresolved.

**Do not:** Accept a new paid transaction while printer readiness is uncertain.

> **Screenshot required:** Approved PrintBit home screen showing Print, Copy, and Scan.

## 3. Normal Operation

### 3.1 Help a student print a document

**Role:** Professor/Operator  
**Purpose:** Guide a student through wireless document printing.  
**When to use:** The student selects **Print**.

1. Ask the student to select **Print** on the kiosk.
2. Ask the student to scan the upload QR code with their phone.
3. If the phone cannot open the page, direct the student to **QR code not opening? Check Wi-Fi** and follow the displayed connection instructions.
4. On the phone, the student chooses a supported file and selects **Send to Kiosk**.
5. Wait until the file appears under **Received files** on the kiosk.
6. Ask the student to select the correct file, then continue to **Configure**.
7. Ask the student to review the preview and choose the required settings, including pages, color, copies, orientation, paper size, and quality where available.
8. Continue to **Confirm & Pay**.
9. Ask the student to verify the **Job Summary** and total price before inserting coins or confirming payment.
10. When the kiosk displays **Ready to Print?**, confirm only after the paper tray and job details are correct.
11. Wait while **Printing in Progress** is displayed.
12. Ask the student to collect every page and use the receipt QR code if one is shown.

**Expected result:** The kiosk displays **Thank You!**, the expected pages are produced, and any receipt is available.

**If it does not work:** Keep the transaction ID visible, note the pages produced, and follow Section 5 or Section 7.

**Stop and contact:** Client IT if the upload session repeatedly fails, the file cannot be prepared, payment is recorded without correct output, or a printer fault appears.

**Do not:** Ask the student to send the document to a professor's personal account or device.

> **Screenshot required:** Print QR/session screen, Received files, Configure, Job Summary, and successful completion.

### 3.2 Help when an upload session expires

**Role:** Professor/Operator

1. Confirm that no payment or print is active.
2. Ask the student to select **New session** on the kiosk.
3. Ask the student to scan the new QR code.
4. Upload and select the file again.

**Expected result:** The new file appears under **Received files**.

**Stop:** Escalate to IT if a new session cannot be created or more than one phone repeatedly claims the session.

### 3.3 Help a student copy a document

**Role:** Professor/Operator

1. Ask the student to select **Copy**.
2. Place the source page on the scanner glass in the position shown by the kiosk or scanner markings.
3. Select **Check Document**.
4. Review the preview without reading private content unnecessarily.
5. If the preview is missing, cropped, or unclear, reposition the page and select **Retry** or **Check Document** again.
6. Select **Continue** when the preview is correct.
7. Review copy settings and continue to **Confirm & Pay**.
8. Verify the job summary, complete payment, and confirm printing.
9. Collect the original and all copied pages.

**Expected result:** The original is returned to the student and the correct number of copies is produced.

**Stop:** Escalate if the scanner is unavailable, repeated previews are incorrect, or payment completes without correct output.

### 3.4 Help a student scan a document

**Role:** Professor/Operator

1. Ask the student to select **Scan**.
2. Choose the scan source, color mode, and resolution shown on the screen.
3. Place the document as instructed.
4. Select **Scan Document**.
5. Review the preview. Select **Rescan** if the result is incomplete or unclear.
6. Select **Get Soft Copy** when the preview is correct.
7. For wireless delivery, ask the student to scan the download QR code.
8. Confirm that the student has downloaded the file before leaving the session.

**Expected result:** The student receives the scanned file through the approved wireless method.

**Stop:** Escalate if the scanner is unavailable, scanning repeatedly fails, or the delivery link cannot be refreshed.

**Note:** USB mass-storage delivery is disabled in kiosk lockdown mode.

## 4. Assisting a Student Safely

**Role:** Professor/Operator

- Point to the next control and explain the step; allow the student to handle their own phone and file whenever possible.
- Ask the student to verify the filename, page range, settings, price, and output.
- Stand where the student can maintain privacy while entering information.
- If a screenshot is needed for support, crop it to the error and transaction reference. Exclude the document preview whenever possible.
- If a student leaves a document on the scanner or output tray, follow the institution's lost-property and privacy policy.
- If the student disputes a charge or output, record facts without promising a refund or reprint beyond the approved policy.

## 5. Common Conditions and Safe Responses

| What you see                                                         | Level              | Professor/operator action                                                                                      |
| -------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------- |
| Paper is low but the printer is ready                                | Check              | Refill only if authorized; otherwise notify the responsible person.                                            |
| **Paper Out or Incorrect Loading**                                   | Stop               | Do not start another transaction. Load approved paper only if authorized, then confirm the error clears.       |
| **Paper Jam Detected**                                               | Stop               | Follow the approved Epson jam procedure only if authorized. Do not pull forcefully or disassemble the printer. |
| **Printer Cover Open**                                               | Stop               | Close the accessible cover only if safe and authorized. Confirm the status clears.                             |
| **Ink Attention Required**                                           | Stop               | Contact the person responsible for ink maintenance. Do not continue if output may be defective.                |
| Printer offline or unavailable                                       | Stop               | Check power and visible cables without disconnecting equipment. Contact IT.                                    |
| Upload session expired                                               | Check              | Create a new session and upload again.                                                                         |
| File remains in **Preparing your file**                              | Check              | Wait for the displayed timeout or cancel safely. Start a new session once; escalate if repeated.               |
| Scanner unavailable                                                  | Stop for Copy/Scan | Confirm the scanner is powered. Retry once, then contact IT.                                                   |
| **Printing needs staff assistance**                                  | Stop               | Preserve the transaction ID and receipt; record pages produced and escalate.                                   |
| Payment accepted but output is missing or incomplete                 | Stop               | Preserve evidence and follow the approved refund/reprint policy.                                               |
| Kiosk screen freezes or home screen does not return                  | Stop               | Contact IT. Restart only if client policy explicitly authorizes it.                                            |
| Privacy, electrical, smoke, heat, liquid, or physical safety concern | Stop immediately   | Isolate the area if safe and contact the designated emergency/IT contact.                                      |

### 5.1 After correcting paper, cover, or ink conditions

1. Confirm that no person has hands or tools inside the printer.
2. Close all approved access areas.
3. Confirm that the printer's visible error has cleared.
4. Return to the kiosk and verify its printer status.
5. If the kiosk remains unavailable, place it out of service and contact IT.
6. Reopen the kiosk only under the approved client policy.

## 6. Taking the Kiosk Out of Service

**Role:** Professor/Operator  
**When to use:** Printing is unavailable or unsafe; payment/output integrity is uncertain; privacy may be compromised; or IT instructs you to stop service.

1. Do not allow another student to begin a transaction.
2. Allow an active print to finish unless the screen or safety condition instructs otherwise.
3. Display the approved out-of-service notice.
4. Record the time, visible status, active transaction ID, payment state, and pages produced.
5. Contact the primary support person listed in Section 7.
6. Leave the kiosk out of service until the authorized role verifies readiness.

**Do not:** Unplug the kiosk, clear internal queues, or repeatedly restart devices unless an approved emergency or IT procedure requires it.

> **Client approval required:** Insert the approved out-of-service notice and identify who may reopen the kiosk.

## 7. Recording and Escalating an Incident

**Role:** Professor/Operator

Record:

- Date and local time
- Kiosk/site identifier
- Transaction ID or receipt reference
- Selected service: Print, Copy, or Scan
- Payment state and amount shown
- Expected pages and pages actually produced
- Exact visible message
- Printer/scanner indicator or error
- Actions attempted
- Whether the kiosk was placed out of service

Do not record student document content, passwords, access codes, payment secrets, system credentials, or unredacted logs.

### Escalation contacts

| Priority          | Contact                      | Hours                        | Method                       |
| ----------------- | ---------------------------- | ---------------------------- | ---------------------------- |
| Primary client IT | **Client approval required** | **Client approval required** | **Client approval required** |
| Backup client IT  | **Client approval required** | **Client approval required** | **Client approval required** |
| PrintBit Support  | **Client approval required** | **Client approval required** | **Client approval required** |
| Emergency/safety  | **Client approval required** | **Client approval required** | **Client approval required** |

## 8. Closing the Kiosk

**Role:** Professor/Operator

1. Confirm that no student transaction, upload, scan, conversion, payment, or print is active.
2. Remove abandoned output according to the institution's privacy policy.
3. Check the printer for paper, ink, jam, cover, or service warnings.
4. Check the scanner glass and output tray for documents.
5. Record unresolved incidents and place the kiosk out of service if needed.
6. Follow the approved shutdown procedure, or leave the kiosk running if it is managed continuously by IT.

> **Client approval required:** Specify whether professors shut down the kiosk, and provide the approved steps.

---

# Part B — IT Administrator Guide

## 9. System Overview

**Role:** IT Administrator

The production system contains these main components:

| Component                       | Purpose                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| PrintBit Node.js application    | Serves kiosk and admin screens, manages sessions, uploads, pricing, payments, records, and job orchestration.                        |
| PrintBitHardware                | Windows service that handles the hardware print queue, printer monitoring, document conversion/scanning integration, and worker IPC. |
| Microsoft Edge kiosk session    | Displays PrintBit in full-screen Assigned Access or kiosk mode.                                                                      |
| Windows Print Spooler           | Owns Windows printer queues and printer-job state.                                                                                   |
| Epson L5290                     | Supported printer for the documented deployment; confirm exact model and driver.                                                     |
| SumatraPDF and qpdf             | Worker print dispatch and robust PDF page counting.                                                                                  |
| LibreOffice                     | Headless conversion for supported office documents.                                                                                  |
| NAPS2 and scanner driver        | Scan and copy acquisition.                                                                                                           |
| SQLite storage                  | Persists kiosk configuration, transactions, financial records, receipts, and operational state.                                      |
| ESP32/network and coin hardware | Deployment-dependent wireless and payment integration; validate the active release configuration.                                    |

### Key operating boundaries

- `PrintBitHardware` runs as `LocalSystem` in the supported worker installation.
- The Node application and worker exchange events and commands through named pipes and a configured queue directory.
- Print and recovery operations are serialized to protect active jobs.
- Physical printer faults require staff action; Windows-side spooler faults may use bounded automated recovery.
- Recovery must not delete or modify active spooler jobs.

## 10. Requirements and Access

### Supported environment

- Windows 10 or Windows 11 kiosk device
- Node.js 22.5.0 or later
- pnpm 10.13.1 for the current repository release
- .NET 10 SDK for publishing the worker, or a validated self-contained worker package
- Microsoft Edge kiosk/Assigned Access support
- Installed Epson printer and scanner drivers
- SumatraPDF, qpdf, LibreOffice, and NAPS2 at validated configured paths
- Administrator PowerShell for installation and service management

### Security requirements

- Use separate limited kiosk and administrator accounts.
- Do not publish example passwords or API keys from repository documentation.
- Generate deployment-specific secrets and store them using the approved client method.
- Restrict admin access, uploaded-file storage, logs, databases, and configuration backups to authorized roles.
- Confirm that `LocalSystem` can access the worker executable, queue, failed-job directory, and dependencies.

## 11. Clean Installation

> **Release validation required:** Run this procedure on a clean representative kiosk and replace repository paths with approved deployment paths before publication.

### 11.1 Record the installation baseline

Before installation, record:

- Windows edition, build, and architecture
- Kiosk hardware model
- Printer model, driver name, and driver version
- Scanner model and driver
- Node.js, pnpm, and .NET versions
- PrintBit application and worker commit/release identifiers
- Installation paths and service account choices

### 11.2 Install the Node.js kiosk

**Role:** IT Administrator  
**Before you begin:** Open PowerShell with **Run as administrator** and use the approved release checkout.

```powershell
pnpm install
pnpm run install-kiosk
```

The `install-kiosk` workflow builds the browser bundles, installs startup and watchdog tasks, and applies the repository's kiosk-lockdown workflow.

Verify:

```powershell
pnpm run watchdog:verify
pnpm run lockdown:verify
```

**Expected result:** The commands complete without an error, scheduled tasks exist, and the kiosk application can reach its local health endpoint.

### 11.3 Publish and install the hardware worker

From the approved `printbit-worker` repository:

```powershell
dotnet publish .\src\PrintBit.HardwareService\PrintBit.HardwareService.csproj `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  -o .\publish

$workerExe = (Resolve-Path '.\publish\PrintBit.HardwareService.exe').Path
$workerBinPath = '"' + $workerExe + '"'
sc.exe create PrintBitHardware `
  binPath= $workerBinPath `
  start= auto `
  depend= Spooler `
  obj= LocalSystem `
  DisplayName= "PrintBit Hardware Service"

sc.exe start PrintBitHardware
sc.exe queryex PrintBitHardware
```

**Expected result:** Service creation reports success and the final query reaches `STATE: 4 RUNNING`.

Do not publish the entire solution into one shared output directory. Publish the worker project file directly.

### 11.4 Configure and validate dependencies

1. Set the exact Windows printer name in the worker configuration.
2. Confirm that the configured queue and failed-job directories exist and are accessible to `LocalSystem`.
3. Confirm the configured SumatraPDF, qpdf, LibreOffice, and NAPS2 paths.
4. Configure the Node application to use the same worker queue and IPC contract.
5. Configure the production admin PIN, prices, payment hardware, network provider, and deployment-specific secrets.
6. Confirm that the upload directory and SQLite database location have approved permissions and backup handling.

## 12. Configuration Reference

Document the approved value for each deployment. Do not place secret values in this manual.

| Area           | Examples                                                              | Validation                                                     |
| -------------- | --------------------------------------------------------------------- | -------------------------------------------------------------- |
| Printer        | Exact Windows printer name, dispatch mode, executable paths, timeouts | Printer is online and a test job completes.                    |
| Worker IPC     | Queue directory, event pipe, error pipe, command pipe                 | Node and worker exchange health and lifecycle events.          |
| Conversion     | LibreOffice path, output directory, conversion timeout                | A supported office file converts and previews.                 |
| Scanning       | NAPS2 path, profile/device, timeout                                   | Copy and Scan both acquire a page.                             |
| Pricing        | Black-and-white/color prices, tiers, paper rules                      | On-screen quote matches the approved price table.              |
| Payment        | Coin source, accepted values, change/refund policy                    | Test payment reaches the exact target balance and is recorded. |
| Network/upload | Provider, SSID, kiosk address, session policy                         | Supported Android and iOS phones can upload.                   |
| Kiosk/security | Assigned Access, startup, watchdog, admin PIN, upload ACL             | Limited users cannot reach admin or protected storage.         |
| Trusted time   | Enforcement and time source                                           | Financial operations follow the approved availability policy.  |

## 13. Admin Panel

**Role:** IT Administrator or authorized client administrator

Access the admin panel through the approved **Admin Access** method and authenticate with the deployment's admin PIN. Lock or sign out when finished.

| Section              | Use                                                                         |
| -------------------- | --------------------------------------------------------------------------- |
| **Overview**         | Review current kiosk, balance, printer, storage, and operational summaries. |
| **Earnings**         | Review earnings by period and service.                                      |
| **System**           | Inspect system, printer, worker, and device state.                          |
| **Settings**         | Manage approved policy and device settings.                                 |
| **Logs**             | Review and export application logs.                                         |
| **Transaction Logs** | Review transaction history and open available e-receipts.                   |
| **Feedback**         | Review user feedback.                                                       |
| **Issue Reports**    | Review submitted operational incidents.                                     |
| **Anomaly Alerts**   | Review conditions flagged for administrator attention.                      |

Destructive controls such as clearing logs, storage, or balances require the client's authorization and backup/retention policy. Record who performed the action and why.

> **Screenshot required:** Admin authentication, Overview, System, Settings, Logs, and Transaction Logs.

## 14. Release Validation

Complete this checklist after a clean installation or update:

- [ ] The PrintBit home screen loads in the intended kiosk account.
- [ ] Admin access requires the approved PIN and is unavailable to unauthorized users.
- [ ] `PrintBitHardware` is running as `LocalSystem`.
- [ ] The Windows Print Spooler and configured printer are running/online.
- [ ] Node-to-worker and worker-to-Node communication are healthy.
- [ ] A phone can connect and upload each supported release format.
- [ ] Session expiry and new-session behavior work as displayed.
- [ ] PDF and office-document conversion complete correctly.
- [ ] Print preview, page range, copies, color, quality, orientation, and paper-size selections match output.
- [ ] Copy acquires a page, previews it, charges correctly, and prints it.
- [ ] Scan acquires a page and wireless delivery works.
- [ ] Coin/payment input, pricing, and ledger records match approved policy.
- [ ] Successful Print and Copy transactions produce the expected receipt behavior.
- [ ] Paper-out, jam, cover-open, offline, and recovery messages match the manual.
- [ ] An incomplete or failed print preserves sufficient incident and refund evidence.
- [ ] Startup, watchdog, kiosk lockdown, and recovery after reboot are verified.
- [ ] Logs and support exports contain no unapproved document content or secrets.

Record evidence, environment, result, tester, and date in the release validation record.

## 15. Routine Administration

### 15.1 Daily or service-period checks

1. Review **Overview**, **System**, and **Anomaly Alerts**.
2. Confirm printer, scanner, worker, network, storage, and payment status.
3. Review unresolved **Issue Reports** and payment/output exceptions.
4. Confirm consumables are sufficient for the next service period.

### 15.2 Service and watchdog checks

```powershell
Get-Service -Name PrintBitHardware
pnpm run watchdog:verify
pnpm run lockdown:verify
```

**Expected result:** The worker is running and the verification scripts complete successfully.

### 15.3 Logs and incident evidence

- Use the admin **Logs**, **Transaction Logs**, **Issue Reports**, and **Anomaly Alerts** screens first.
- Export only the period and records needed for the incident.
- Redact student data, uploaded filenames where necessary, credentials, tokens, environment secrets, and unrelated records.
- Preserve transaction ID, request ID, spooler correlation information, timestamps, visible outcome, and software versions.

### 15.4 Backup

Back up, using the approved client procedure:

- SQLite database and required sidecars while the application is safely stopped or through a validated consistent-backup method
- Deployment configuration with secrets protected separately
- Manual and release validation records
- Required operational logs under the approved retention period

Do not treat transient uploads, conversion outputs, or active queue files as ordinary backup content without a privacy review.

## 16. Updating and Rolling Back

### 16.1 Before an update

1. Freeze new transactions and confirm no job is active.
2. Record current application and worker versions.
3. Back up approved persistent data and configuration.
4. Confirm that the previous approved release remains available for rollback.

### 16.2 Update the Node.js application

From the approved release checkout:

```powershell
pnpm install
pnpm run build
pnpm exec tsc --noEmit --ignoreDeprecations 6.0
```

Reinstall or refresh startup, watchdog, or lockdown tasks only when the release instructions require it. Then run the complete validation in Section 14.

### 16.3 Update the worker

```powershell
sc.exe stop PrintBitHardware
sc.exe query PrintBitHardware

dotnet publish .\src\PrintBit.HardwareService\PrintBit.HardwareService.csproj `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  -o .\publish

sc.exe start PrintBitHardware
sc.exe queryex PrintBitHardware
```

Wait for `STATE: 1 STOPPED` before replacing an installed worker binary. After restart, expect `STATE: 4 RUNNING`.

### 16.4 Rollback

1. Stop new transactions and preserve incident evidence.
2. Restore the previous approved application and worker versions using the deployment's rollback package.
3. Restore configuration only when it is compatible with the previous version.
4. Start the worker and kiosk application.
5. Complete Section 14 before reopening.
6. Record the reason, versions, operator, time, result, and follow-up owner.

## 17. Printer Recovery

Use the PrintBit admin recovery controls or approved support procedure. A recovery response can have these outcomes:

| Outcome                        | Meaning                                                                                   | IT action                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `healthy`                      | Printer and spooler are ready; no repair was needed.                                      | Validate with an approved test, then reopen.                      |
| `recovered`                    | A Windows-side fault was corrected and the printer rechecked healthy.                     | Validate, record the recovery, then reopen.                       |
| `manual_intervention_required` | Paper, jam, cover, ink, service, or another physical condition needs staff action.        | Follow Epson/client physical-maintenance procedure, then recheck. |
| `worker_busy`                  | A print or another recovery operation holds the protected operation lease.                | Wait for the active operation to finish; do not force recovery.   |
| `restart_failed`               | Restarting the Windows Print Spooler did not restore health within the recovery deadline. | Keep the kiosk out of service and escalate with logs.             |
| `invalid_request`              | The recovery request was malformed, unsupported, or missing required data.                | Check the calling application/version and escalation evidence.    |

### Recovery safety contract

The approved recovery path:

- Does not cancel, delete, or modify spooler jobs.
- Does not purge `.spl` or `.shd` files.
- Does not reset Plug and Play USB devices.
- Does not launch vendor utilities automatically.
- Does not use `taskkill` against printer or spooler processes.
- Protects active printing by returning `worker_busy` when necessary.

If a physical error remains, correct it through the manufacturer/client procedure and request a new read-only status check. Do not repeat recovery indefinitely.

## 18. Symptom-Driven Troubleshooting

| Symptom                           | Check                                                                  | Safe action                                                 | Escalate with                                           |
| --------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| Kiosk page does not load          | Startup task, Node process, local health endpoint, port, recent update | Run approved watchdog/startup verification                  | Version, task status, startup/watchdog logs             |
| Edge leaves kiosk mode            | Assigned Access, kiosk account, lockdown verification                  | Reapply only the approved lockdown release procedure        | Windows build, account, verification output             |
| Phone cannot upload               | Network provider, QR address, session state, supported phone/browser   | Create one new session; verify kiosk/phone network          | Session time, phone OS/browser, visible message         |
| File conversion fails             | File format, LibreOffice path, timeout, disk space                     | Test with approved non-sensitive sample                     | Format, size, conversion log, version                   |
| Scanner unavailable               | Power, Windows device state, driver, NAPS2 path/profile                | Reconnect only under hardware procedure; test NAPS2         | Device/driver, error, NAPS2 output                      |
| Worker service stopped            | Service state, Application/System event logs, executable/config access | Start once after resolving known cause                      | Service query, event, worker log, config paths          |
| Printer offline or physical fault | Power, display, Windows printer status, Epson indicators               | Correct authorized physical condition, then recheck         | Printer/driver version, indicators, diagnostic          |
| `worker_busy`                     | Active print/recovery                                                  | Wait; do not stop the worker or spooler                     | Request ID, active transaction, timestamps              |
| `restart_failed`                  | Spooler service and final printer health                               | Keep out of service; investigate service/driver             | Recovery response, service events, diagnostics          |
| Paid job incomplete               | Transaction, worker lifecycle, pages produced, receipt/refund state    | Preserve evidence; apply approved refund/reprint policy     | Transaction ID, amounts, page counts, timestamps        |
| Receipt unavailable               | Transaction status, receipt record/token state, time                   | Use admin transaction context; do not expose tokens broadly | Transaction ID, receipt status, time                    |
| Database/storage warning          | Disk space, permissions, database state, backup                        | Stop risky operations; protect persistent data              | Disk/ACL state, logs, backup status                     |
| Trusted-time warning              | Windows time, configured time source, network                          | Restore approved time sync                                  | Time status, policy setting, financial-operation result |

## 19. Support Escalation Package

Provide the smallest useful package:

- Institution/site and kiosk identifier
- Incident date/time and timezone
- Application and worker versions
- Windows version; printer/scanner model and driver version
- Transaction ID, request ID, or spooler correlation reference
- Exact visible message and recovery outcome
- Expected and actual output, including pages produced
- Relevant redacted logs and screenshots
- Service, watchdog, printer, scanner, disk, and network status
- Actions already attempted and their results
- Whether the kiosk remains out of service

Do not include student files, document previews, PINs, passwords, tokens, API keys, or unrelated records.

---

# Appendices

## Appendix A — Operator Quick Reference

### Open

- [ ] Area and equipment are safe.
- [ ] PrintBit home screen is visible.
- [ ] Printer is powered, ready, and has approved paper/ink.
- [ ] Scanner is ready when Copy/Scan is offered.
- [ ] No unresolved out-of-service notice exists.

### Continue

- Home screen and required devices are ready.
- Student can review settings and price before payment.
- Output and receipt match the completed transaction.

### Check

- Create a new upload session once if the previous session expires.
- Reposition and rescan once if a preview is incorrect.
- Correct only visible paper, cover, or ink conditions that client policy authorizes.

### Stop

- Payment/output is uncertain.
- Printer, scanner, worker, or kiosk is unavailable.
- A jam, physical fault, privacy risk, or safety concern exists.
- Repeated retry does not resolve the problem.

Record the transaction ID, time, payment state, pages produced, exact message, and actions attempted. Contact **Client approval required**.

## Appendix B — Incident Record

| Field                             | Entry    |
| --------------------------------- | -------- |
| Date and local time               |          |
| Kiosk/site                        |          |
| Reporter and role                 |          |
| Service: Print / Copy / Scan      |          |
| Transaction/receipt reference     |          |
| Payment state/amount shown        |          |
| Expected pages                    |          |
| Pages produced                    |          |
| Exact visible message             |          |
| Printer/scanner indicators        |          |
| Actions attempted and results     |          |
| Kiosk out of service?             | Yes / No |
| Escalated to and time             |          |
| Resolution and reopening approval |          |

Privacy check:

- [ ] No document content is attached.
- [ ] No credentials, PINs, tokens, or secrets are attached.
- [ ] Screenshots and logs are cropped/redacted.

## Appendix C — Directory and Service Map

> **Release validation required:** Replace examples with approved deployment paths.

| Item                     | Example/identifier               | Purpose                                               |
| ------------------------ | -------------------------------- | ----------------------------------------------------- |
| Node application         | Approved PrintBit checkout       | Kiosk and admin application                           |
| Node persistent database | `printbit.sqlite`                | Persistent kiosk data                                 |
| Node uploads/logs        | `uploads/`                       | Runtime uploads and operational logs                  |
| Worker service           | `PrintBitHardware`               | Hardware queue, monitoring, conversion, scanning, IPC |
| Worker publish output    | `printbit-worker\publish\`       | Generated deployment executable                       |
| Worker queue             | Configured `PrintQueueDirectory` | Print-job handoff                                     |
| Worker failed jobs       | Configured failed directory      | Terminal failed-job evidence                          |
| SumatraPDF               | Configured `SumatraPath`         | Worker PDF print dispatch                             |
| qpdf                     | Configured `QpdfPath`            | PDF page-count fallback                               |
| LibreOffice              | Configured `SofficePath`         | Office-document conversion                            |
| NAPS2                    | Configured `Naps2Path`           | Scanner acquisition                                   |

## Appendix D — Maintenance Schedule

| Frequency             | Activity                                                          | Owner                        | Record location           |
| --------------------- | ----------------------------------------------------------------- | ---------------------------- | ------------------------- |
| Each opening          | Operator readiness check                                          | **Client approval required** |                           |
| Daily                 | Review unresolved incidents and consumables                       | **Client approval required** |                           |
| Weekly                | Review system/worker/printer/scanner health and disk space        | **Client approval required** |                           |
| Monthly               | Validate backup, logs, updates, and sample end-to-end transaction | **Client approval required** |                           |
| Per release           | Complete Section 14 and update screenshots/manual                 | Product + client IT          | Release validation record |
| Manufacturer interval | Epson physical maintenance                                        | **Client approval required** |                           |

## Appendix E — Revision History

| Manual version | Date       | Product version             | Summary                                               | Author        | Approver |
| -------------- | ---------- | --------------------------- | ----------------------------------------------------- | ------------- | -------- |
| Draft 0.1      | 2026-09-07 | Release validation required | Initial professor/operator and IT administrator draft | PrintBit team | Pending  |

## Appendix F — Publication Checklist

- [ ] Client identity, branding, language, contacts, and support hours are complete.
- [ ] Professor permissions and stop conditions are approved.
- [ ] Refund, reprint, partial-output, privacy, and retention policies are approved.
- [ ] Product and worker versions are frozen.
- [ ] Every procedure has been performed on the representative release kiosk.
- [ ] Professor usability testing is complete and findings are closed.
- [ ] Independent IT installation/update and recovery validation are complete.
- [ ] Screenshots match the same approved release and contain no sensitive data.
- [ ] Commands, paths, expected results, links, and cross-references are verified.
- [ ] The quick reference and incident record agree with Part A.
- [ ] Editable source and searchable PDF are archived with revision history.
- [ ] Client operations, IT, privacy, safety, and PrintBit representatives approve publication.
