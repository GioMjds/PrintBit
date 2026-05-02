# Security Policy

## Supported Versions

PrintBit is under active development.
Only the latest version in the main branch is considered supported.

---

## Reporting a Vulnerability

If you discover a security issue, do NOT open a public issue.

Instead, report it privately:

- Create a private report via GitHub Security Advisories (if enabled)
- Or contact the maintainers directly

Include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if available)

---

## Scope

Security concerns include:

- Unauthorized access to system endpoints
- File handling vulnerabilities (uploads, storage)
- Execution of external binaries (PDF/printing pipeline)
- Kiosk escape or privilege escalation
- Exposure of sensitive data

---

## Expectations

- Reports should be clear and reproducible
- Avoid destructive testing on production kiosks
- Allow time for fixes before public disclosure

---

## Notes for Contributors

When contributing:

- Validate all inputs
- Avoid unsafe file operations
- Do not expose internal paths or system details in APIs
- Be cautious with external process execution

Security is critical due to the kiosk and hardware-integrated nature of PrintBit.
