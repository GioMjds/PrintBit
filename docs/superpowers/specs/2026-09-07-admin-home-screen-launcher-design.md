# PrintBit Admin Home-Screen Launcher Design

**Date:** 2026-09-07
**Status:** Approved for implementation planning

## Context

Administrators currently open the phone-based admin panel by joining the
PrintBit network, typing the Node server URL followed by `/admin`, and
then entering the administrator PIN. The authentication and local-network
restrictions are appropriate, but manually entering the address is error-prone.

PrintBit already has the pieces needed to remove that friction:

- the Node server exposes `/admin` and redirects it to `/admin/dashboard`;
- the server detects its active local IPv4 address and port;
- production ESP32 deployments use a reboot-stable kiosk address, normally
  `192.168.4.2` on the PrintBit network;
- the kiosk has a hidden five-tap administrator gesture;
- `qrcode` is already a project dependency; and
- the User Manual already separates operator guidance from IT administrator
  guidance.

The latest ESP32 firmware may change the provisioning or addressing flow. This
design therefore keeps the launcher owned by Node and treats deeper
WiFiManager integration as a follow-up after the current firmware is reviewed.

## Decision

Implement a local-only PrintBit Admin home-screen launcher, not a full offline
PWA. An administrator must connect to PrintBit Wi-Fi before opening it. The
launcher is installed from the existing Node-hosted admin site and opens
`/admin`, where the administrator authenticates with the existing PIN.

Two administrator-only entry points provide the launcher URL:

1. a static QR code and instructions in Part B of the User Manual; and
2. a dynamic QR code exposed through the kiosk's hidden five-tap admin flow.

The dynamic kiosk QR is the authoritative fallback because it is generated from
the server's currently detected PrintBit-network address and configured port.

## Goals

- Eliminate routine typing of the Node server address on administrator phones.
- Support Android and iPhone without an app store, APK, or private iOS
  distribution process.
- Preserve the existing PIN, lockout, session, and local-network protections.
- Provide a recognizable PrintBit Admin icon and app-like launch presentation.
- Keep the launcher useful even if a browser does not offer a formal install
  prompt.
- Document installation, normal use, removal, and recovery in the
  administrator-only manual section.

## Non-goals

- Remote or Internet-based admin access.
- Offline admin functionality.
- Caching admin pages or API responses with a service worker.
- Automatically joining PrintBit Wi-Fi from the launcher.
- Embedding a PIN, cookie, session token, or other credential in a QR code.
- Replacing the existing admin authentication flow.
- Changing ESP32 WiFiManager firmware before the latest firmware is reviewed.

## Architecture

### Responsibility boundaries

- **ESP32/WiFiManager:** provisions and provides the PrintBit Wi-Fi network.
- **Node server:** owns the admin URL, address discovery, QR generation,
  launcher metadata, authentication, and local-network enforcement.
- **Kiosk UI:** exposes the dynamic QR only through the existing hidden
  administrator gesture.
- **User Manual:** provides a static onboarding route and platform-specific
  installation instructions in its administrator-only section.
- **Phone browser:** creates and launches the home-screen shortcut.

The WiFiManager completion page may eventually link to the Node-hosted launcher
setup, but that integration is explicitly deferred until the latest ESP32 code
is available. The Node implementation must not depend on that future behavior.

### Access flow

#### First-time setup from the User Manual

1. The administrator connects the phone to PrintBit Wi-Fi.
2. The administrator opens Part B of the User Manual and scans the Admin Access
   QR code.
3. The browser opens `http://192.168.4.2:3000/admin` for the standard deployment.
4. The administrator enters the existing admin PIN.
5. The admin login experience shows concise platform-specific launcher
   instructions.
6. On Android, the administrator uses **Add to Home screen** or **Install** from
   the browser menu.
7. On iPhone, the administrator uses Safari's **Share > Add to Home Screen**.
8. The resulting icon is named **PrintBit Admin** and opens `/admin`.

#### First-time setup from the kiosk

1. The administrator connects the phone to PrintBit Wi-Fi.
2. The administrator performs the existing five-tap gesture on the kiosk.
3. The admin modal offers the existing on-kiosk PIN flow and a new **Use your
   phone** action.
4. The phone action requests launcher information through a loopback-only Node
   endpoint.
5. The kiosk displays the detected admin URL as both a QR code and readable
   fallback text.
6. The administrator scans the QR and follows the same browser installation
   flow as above.

#### Subsequent access

1. The administrator connects to PrintBit Wi-Fi.
2. The administrator taps the **PrintBit Admin** home-screen icon.
3. The browser or standalone web view opens `/admin`.
4. Existing session validation determines whether the PIN must be entered
   again.

## Node Components

### Launcher metadata

Add a web app manifest under the admin route with:

- `name`: `PrintBit Admin`;
- a concise `short_name`;
- `start_url`: `/admin`;
- an admin-limited `scope`;
- `display`: `standalone`;
- existing PrintBit theme and background colors; and
- 192 px, 512 px, and maskable launcher icons.

Admin HTML must link the manifest and include Apple touch icon, application
title, theme color, and standalone-capable metadata. At minimum, the dashboard
entry document must carry this metadata because `/admin` redirects there. The
metadata should also be shared across admin pages where the current static-page
architecture requires it for consistent navigation.

A manifest improves naming and icon behavior where supported, but the product
must not rely on browser PWA promotion. Standard installable PWAs require HTTPS
or a loopback origin, while this deployment is intentionally reached through a
private IPv4 HTTP address. The supported baseline is therefore a browser-created
home-screen launcher.

### Dynamic launcher endpoint

Add a small endpoint, conceptually `GET /api/kiosk/admin-launcher`, that:

- accepts only loopback requests from the kiosk UI;
- determines the preferred PrintBit-network IPv4 address;
- combines it with the configured HTTP port and `/admin` path;
- returns the URL plus a QR representation suitable for display; and
- sends `Cache-Control: no-store`.

The QR payload is exactly the admin URL. It must never contain credentials or
an authenticated deep link. Returning SVG or a data URL is acceptable; the
implementation should follow the project's existing response conventions and
use the installed `qrcode` dependency.

URL construction must be isolated in a testable helper. It should prefer the
configured ESP32 kiosk address when valid, then the detected interface on the
configured ESP32 subnet, and fail explicitly rather than selecting an unrelated
adapter address.

### Kiosk admin modal

Extend the current five-tap modal without changing its existing on-kiosk PIN
behavior. Add a distinct **Use your phone** action that opens a launcher panel
containing:

- a reminder to connect to PrintBit Wi-Fi first;
- the dynamically generated admin QR;
- the readable URL;
- a short statement that the PIN is still required; and
- Android and iPhone installation summaries.

The modal must remain keyboard-accessible and preserve its current cancel,
focus, and error behavior.

### Admin installation guidance

The admin login view should show a dismissible **Add PrintBit Admin to this
phone** guide. Platform detection may choose the initial Android or iPhone
instructions, but both instruction sets must remain reachable because user-agent
detection is not authoritative.

The dismissal flag may be stored locally on that browser. It is presentation
state only and must not affect authentication or authorization. The guide must
not claim that installation succeeded because browser installation APIs and UI
vary by platform.

## User Manual Changes

Update `docs/user-manual/PrintBit-Client-User-Manual.md` only within the IT
administrator portion. Do not expose the admin QR in Part A.

The new section must include:

1. prerequisites and the requirement to connect to PrintBit Wi-Fi;
2. the Admin Access QR code;
3. the encoded URL in readable text;
4. Android Chrome installation steps;
5. iPhone Safari installation steps;
6. later-use and reauthentication expectations;
7. instructions for removing the launcher from a retired or transferred phone;
8. a reminder that the shortcut contains no credentials;
9. the hidden kiosk QR as the dynamic recovery route; and
10. troubleshooting for the wrong Wi-Fi, unreachable server, changed address,
    missing browser menu, and captive-portal interruptions.

The committed manual QR targets the standard deployment address
`http://192.168.4.2:3000/admin`. The manual must state that a deployment using a
different kiosk IP or port requires a regenerated QR. The QR asset should be
kept alongside the User Manual assets and generated reproducibly rather than
edited by hand.

## Security and Privacy

- Continue enforcing local-network access before serving admin pages and admin
  APIs.
- Continue enforcing PIN/session authentication for privileged operations.
- Do not treat the hidden gesture, manual location, QR code, manifest, or icon
  as a security boundary.
- Do not place credentials in the manifest, QR, URL, local storage, or launcher
  metadata.
- Do not introduce a service worker that could retain admin HTML or API data.
- Mark launcher-information, admin HTML, authentication, and privileged API
  responses non-cacheable as appropriate.
- Keep the PrintBit wireless network protected by a deployment-specific
  WPA2/WPA3 password. The launcher does not add transport encryption to the
  existing HTTP connection.
- A transferred, lost, or retired administrator phone must have the shortcut
  removed; active admin sessions remain governed by the existing session
  lifetime and logout controls.

## Error Handling

- **Phone is not on PrintBit Wi-Fi:** show guidance to join the network and retry;
  do not weaken local-access checks.
- **No matching kiosk address:** do not generate a misleading QR. Show a kiosk
  configuration message and direct the administrator to the manual or network
  settings.
- **Configured IP or port changed:** the kiosk dynamic QR remains the recovery
  path; the manual instructs maintainers to regenerate its static QR.
- **Captive portal intercepts the browser:** instruct the administrator to finish
  or dismiss the captive portal, then scan the Admin Access QR again.
- **No install option is shown:** provide manual browser-menu instructions and
  fall back to a normal browser bookmark.
- **Launcher opens while disconnected:** retain the browser's normal connection
  failure and provide troubleshooting in the manual; do not cache a simulated
  admin screen.
- **QR rendering fails:** display the complete URL as selectable text.

## Testing and Verification

### Automated tests

- Unit-test address selection and admin URL construction for configured,
  detected, missing, and invalid addresses.
- Verify the launcher endpoint rejects non-loopback requests.
- Verify the endpoint returns `no-store`, a valid `/admin` URL, and a decodable
  QR payload containing no credential material.
- Verify the manifest schema, start URL, scope, display mode, and icon entries.
- Verify manifest, icon, and Apple metadata routes are served successfully.
- Verify admin HTML and sensitive responses retain the intended cache policy.
- Verify the existing five-tap gesture, kiosk PIN login, phone PIN login,
  lockout, session validation, and local-network rejection behavior continue to
  pass.
- Verify the launcher instructions can be dismissed without changing auth state.
- Verify a QR failure leaves the readable URL visible.

### Manual device checks

- Android Chrome: scan, authenticate, add to home screen, launch, navigate admin
  sections, close, and relaunch.
- iPhone Safari: scan, authenticate, use Share > Add to Home Screen, launch,
  navigate admin sections, close, and relaunch.
- On both platforms, confirm behavior when disconnected from PrintBit Wi-Fi and
  after reconnecting.
- Confirm the launcher icon, name, theme, and orientation are acceptable on both
  platforms.
- Confirm that scanning the printed QR and dynamic kiosk QR reaches the same
  admin entry point.

## Rollout and Documentation Synchronization

1. Implement and verify the Node launcher metadata and dynamic QR flow.
2. Validate the stable production address used for the printed QR.
3. Generate the manual QR asset reproducibly.
4. Update the administrator manual section and its revision history.
5. Perform Android and iPhone acceptance checks on the actual PrintBit network.
6. Review the latest ESP32 firmware when supplied and decide whether the
   WiFiManager completion page should link to the launcher setup.

## Acceptance Criteria

- An administrator can reach the phone admin login without typing the server
  URL.
- Both the admin-only manual QR and hidden kiosk QR open `/admin` on the PrintBit
  network.
- Android and iPhone can create a clearly named PrintBit Admin home-screen
  launcher using documented browser steps.
- Opening the launcher while connected reaches the existing PIN flow.
- No QR or launcher artifact contains authentication material.
- Existing admin access controls and kiosk admin access continue to work.
- Failures provide a readable URL or actionable recovery guidance.
- The implementation does not depend on unrevised ESP32 firmware behavior.
