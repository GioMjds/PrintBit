# PrintBit Student ID via ESP32 Captive Portal

Yes, this is a good trajectory for PrintBit.

The best design is to use the **ESP32 captive portal as the Student ID entry point**, while **Node.js remains responsible for validation, sessions, transactions, and student-related data**.

## Recommended Flow

```text
Student approaches PrintBit
        ↓
Scans Wi-Fi QR / connects to "PrintBit"
        ↓
ESP32 captive portal appears
        ↓
Student enters ID
XXX-XXXX
        ↓
Node.js validates Student ID
        ↓
Kiosk session created
        ↓
Tablet automatically unlocks
        ↓
Print / Copy / Scan
        ↓
Payment
        ↓
Transaction
        ↓
C# Worker handles printing/hardware
```

## Student ID Format

Expected format:

```text
XXX-XXXX
```

Example:

```text
123-4567
```

Recommended validation:

```regex
^\d{3}-\d{4}$
```

The UI can let the student type only:

```text
1234567
```

and automatically display:

```text
123-4567
```

Node.js must still perform server-side validation.

---

## Architecture Responsibilities

### ESP32

ESP32 should handle:

```text
- PrintBit Wi-Fi hotspot
- DHCP
- DNS redirection
- Captive portal detection
- Redirecting devices to PrintBit portal
- Coin pulses
- Hopper events
- Hardware heartbeat
```

ESP32 should **not** store:

```text
- Student database
- Student names
- Student records
- Incident history
- Authentication data
```

---

### Node.js + Express.js

Node.js should own the identity system:

```text
- Captive portal web page
- Student ID validation
- Student roster lookup
- StudentIdentityService
- PortalSessionService
- KioskSessionService
- TransactionService
- IncidentService
- Admin dashboard
- Audit logs
- WebSocket / SSE kiosk updates
```

Example endpoint:

```http
POST /api/portal/identify
```

```json
{
  "studentId": "123-4567"
}
```

---

### C# Worker

The Worker should remain hardware-focused:

```text
- Printing
- Printer monitoring
- Scanner integration
- Windows spooler
- Print queue
- OS-level hardware operations
```

It should receive only identifiers such as:

```json
{
  "transactionId": "TXN-001",
  "jobId": "JOB-001"
}
```

It should **not receive the Student ID**.

---

# Session Model

Student identification should create a **kiosk session**.

```text
StudentIdentity
      ↓
KioskSession
      ↓
Transaction
      ↓
PrintJob
      ↓
C# Worker
```

Example:

```text
Student: 123-4567

Session:
SES-001

Transactions:
├── TXN-001 Print
├── TXN-002 Copy
└── TXN-003 Scan
```

The transaction ID remains the technical identifier.

Student ID adds accountability.

---

# Automatic Kiosk Unlock

Before authentication:

```text
WAITING_FOR_STUDENT
```

After successful captive portal validation:

```text
WAITING_FOR_STUDENT
        ↓
SESSION_ACTIVE
        ↓
HOME
```

Node.js can broadcast:

```json
{
  "event": "kiosk.session.started",
  "sessionId": "SES-001"
}
```

through WebSocket or SSE.

The tablet automatically changes to:

```text
Print
Copy
Scan
```

without requiring another button press.

---

# Wi-Fi QR Recommendation

Place a Wi-Fi QR code on the PrintBit idle screen:

```text
Scan to Start

[ QR CODE ]

Connect → Identify → Print
```

The student flow becomes:

```text
Scan QR
   ↓
Join PrintBit Wi-Fi
   ↓
Captive portal opens
   ↓
Enter Student ID
   ↓
Continue
```

This minimizes kiosk interaction significantly.

---

# Concurrency Protection

Only one student should control the kiosk at a time.

Recommended state machine:

```text
AVAILABLE
   ↓
CLAIMING
   ↓
SESSION_ACTIVE
   ↓
SESSION_ENDING
   ↓
AVAILABLE
```

If another student connects during an active session:

```text
PrintBit is currently being used.

Please wait for the current session to finish.
```

Node.js should enforce this, not the frontend or ESP32.

---

# Suggested Database Structure

## `student_identities`

```text
id
student_id_hmac
student_id_encrypted
active
last_verified_at
```

## `portal_sessions`

```text
id
kiosk_id
status
created_at
expires_at
```

## `kiosk_sessions`

```text
id
student_identity_id
portal_session_id
kiosk_id
started_at
ended_at
status
```

## `transactions`

```text
id
kiosk_session_id
type
amount
status
created_at
```

## `incidents`

```text
id
transaction_id
kiosk_session_id
type
severity
created_at
```

Relationship:

```text
Student ID
   ↓
StudentIdentity
   ↓
KioskSession
   ↓
Transaction
   ↓
Print Job / Incident
```

---

# Student Roster

Do not copy the university's entire student database into PrintBit.

Prefer a minimal roster:

```csv
student_id,active
123-4567,true
234-5678,true
345-6789,true
```

PrintBit only needs enough information to determine:

```text
Does this Student ID exist?
Is this Student ID active?
```

Authorized administrators can use the university's existing student information system when they actually need to identify the student behind an incident.

---

# Security

Do not store Student IDs as plain hashes.

Prefer:

```text
HMAC-SHA256(secret, studentId)
```

for database lookup.

Optionally store an encrypted version separately for authorized admin retrieval.

Example:

```text
Normal admin view:
***-4567

Authorized investigation:
123-4567
```

Also audit whenever an administrator views student-linked information.

---

# Captive Portal + Upload Integration

Later, the same portal can handle document uploading.

Instead of:

```text
Student ID
↓
Close portal
↓
Scan another QR
↓
Upload
```

use:

```text
Student ID
   ↓
Validated
   ↓
Upload Document
   ↓
Document attached to session
   ↓
Tablet detects uploaded document
```

Then your model becomes:

```text
StudentIdentity
      ↓
PortalSession
      ↓
KioskSession
      ↓
Document
      ↓
Transaction
      ↓
PrintJob
```

This would make the phone a lightweight **PrintBit companion interface**.

---

# Recommended Implementation Stages

## V1

```text
ESP32 Captive Portal
+
XXX-XXXX Student ID
+
Local Student Roster
+
Node.js Kiosk Sessions
```

Best starting point.

## V2

Add stronger identity verification:

```text
Student ID QR
Barcode
NFC
University API
SSO
```

## V3

Use the same captive portal for:

```text
Student identification
Document upload
Upload progress
Session status
```

---

# Final Architecture

```text
Student Phone
     ↓
PrintBit Wi-Fi
     ↓
ESP32 Captive Portal
     ↓
Node.js
     ├── Student Validation
     ├── Portal Session
     ├── Kiosk Session
     ├── Transaction
     └── Incident Tracking
             ↓
        PrintBit Tablet
             ↓
        C# Worker
             ↓
     Printer / Scanner / ESP32
```

**Recommended responsibility split:**

```text
ESP32 = Network + hardware events

Node.js = Student identity + sessions + transactions

C# Worker = Printer + Windows + hardware operations
```

For PrintBit, this is probably the cleanest way to reduce student interaction while still linking kiosk usage to an accountable Student ID.
