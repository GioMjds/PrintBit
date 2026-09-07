#include <WiFi.h>
#include <NetworkClient.h>
#include <WiFiAP.h>
#include <HTTPClient.h>
#include <WiFiManager.h>
#include <ESPmDNS.h>
#include <Preferences.h>

#define coinAcceptorPin 4
#define hopperSensorPin 19
#define relayPin 27
#define bootPin 0

// Wi-Fi is now managed by WiFiManager. The ESP32 normally operates as a
// STA (client) on the PrintBit router. If saved credentials are unavailable
// or a connection cannot be established, WiFiManager temporarily starts a
// configuration AP so the router credentials can be entered.
// First-boot defaults. These are replaced by values saved in ESP32 NVS.
const char* defaultWifiManagerApName = "PrintBit-ESP32-Setup";
const char* defaultWifiManagerApPassword = "printbit123";
const char* defaultAdminUsername = "admin";
const char* defaultAdminPassword = "admin123";

Preferences configPreferences;
String wifiManagerApName = defaultWifiManagerApName;
String wifiManagerApPassword = defaultWifiManagerApPassword;
String adminUsername = defaultAdminUsername;
String adminPassword = defaultAdminPassword;
const unsigned long wifiConfigPortalTimeoutSec = 180;
const unsigned long wifiReconnectIntervalMs = 10000;

const uint16_t defaultKioskPort = 3000;
const char* fallbackKioskPortalPath = "/portal";
const char* kioskRegisterToken = "printbit-register-token";
const char* coinBridgeSource = "esp32";
const char* coinBridgeApiKey = "printbit-coin-bridge-key";
const char* hopperControlToken = "printbit-coin-bridge-key";

NetworkServer server(80);

String kioskIp = "";
uint16_t kioskPort = defaultKioskPort;
String kioskPortalPath = fallbackKioskPortalPath;
String kioskPortalUrl = "";
String tabletServer = "";
bool hasKioskRegistration = false;

// DEVICE IDENTITY / NETWORK STATE
const char* printBitDeviceId = "PB-ESP32-001";
const char* firmwareVersion = "1.0.0";
const unsigned long tabletHeartbeatIntervalMs = 10000;
const unsigned long tabletOfflineTimeoutMs = 30000;
const char* mdnsHostname = "printbit-esp32";
unsigned long lastTabletHeartbeatAt = 0;
unsigned long lastTabletContactAt = 0;
unsigned long lastWifiReconnectAttemptAt = 0;
String lastKnownStaIp = "";
bool wifiWasConnected = false;
bool tabletOnline = false;

// ADMIN MAINTENANCE / RECOVERY
// These are requested by the authenticated admin page and executed from loop().
bool configurationModeRequested = false;
bool factoryResetRequested = false;
bool restartRequested = false;
bool maintenanceBusy = false;

// COIN ACCEPTOR
volatile uint16_t pulseCount = 0;
volatile unsigned long lastPulseMicros = 0;
volatile unsigned long lastPulseMillis = 0;
volatile uint16_t glitchPulseCount = 0;

const unsigned long debounceMicros = 100000;
const unsigned long coinTimeout = 700;
const int maxCoinSendAttempts = 3;
const int maxDispenseCoins = 50;
const uint16_t pulseCountCap = 200;
const uint16_t pulseSaturationWarnAt = 8;
  
// HOPPER
volatile int coinDispensed = 0;
volatile int targetCoins = 0;

volatile unsigned long lastCoinTime = 0;
const unsigned long hopperDebounce = 150000;

bool dispensing = false;
bool dispenseDone = false;
bool dispenseTimedOut = false;
volatile bool dispenseProgressDirty = false;
int lastProgressReported = -1;

// SAFETY
unsigned long hopperStartTime = 0;
const unsigned long hopperMaxRunTime = 30000;

unsigned long coinEventCounter = 0;
String activeDispenseRequestId = "";
String lastDispenseRequestId = "";
String lastDispenseOutcome = "idle";
String lastDispenseError = "";
unsigned long lastDispenseFinishedAt = 0;
String serialLineBuffer = "";

// ADMIN CONFIGURATION
// Settings are stored in ESP32 NVS so they survive reboot and power loss.
String getFormValue(const String& body, const String& key);
void replyPlain(NetworkClient& client, int statusCode, const String& statusText, const String& body);
void loadAdminConfig();
void saveAdminConfig(const String& apName, const String& apPassword,
                    const String& username, const String& password);
bool isAdminAuthenticated(const String& authHeader);
void handleAdminRequest(NetworkClient& client, const String& method,
                        const String& path, const String& authHeader,
                        const String& body);
String base64Encode(const String& input);
String htmlEscape(const String& input);
void recoverAdminCredentialsFromBoot();

// NETWORK / INTERRUPT FORWARD DECLARATIONS
// These functions are defined later in the sketch but are used by the
// admin page and maintenance code above their definitions.
String getEsp32Ip();
void IRAM_ATTR countPulse();
void IRAM_ATTR coinDetected();

// HEAP MONITORING
const unsigned long heapCheckIntervalMs = 10000;
const uint32_t lowHeapWarnThreshold = 20000;
unsigned long lastHeapCheckAt = 0;
uint32_t minFreeHeapSeen = UINT32_MAX;

bool startDispense(
  int coins,
  const String& requestId,
  const String& sourceLabel
);

// ADMIN CONFIGURATION
String base64Encode(const String& input) {
  const char* table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  String out = "";
  int val = 0;
  int valb = -6;
  for (size_t i = 0; i < input.length(); i++) {
    val = (val << 8) + (uint8_t)input.charAt(i);
    valb += 8;
    while (valb >= 0) {
      out += table[(val >> valb) & 0x3F];
      valb -= 6;
    }
  }
  if (valb > -6) out += table[((val << 8) >> (valb + 8)) & 0x3F];
  while (out.length() % 4) out += '=';
  return out;
}

String htmlEscape(const String& input) {
  String out = input;
  out.replace("&", "&amp;");
  out.replace("<", "&lt;");
  out.replace(">", "&gt;");
  out.replace("\"", "&quot;");
  return out;
}

// ADMIN PASSWORD RECOVERY
// GPIO0 is the physical BOOT button on a standard ESP32 development board.
// Do not require the button to be held while powering on: GPIO0 is also the
// ROM bootloader strap and holding it during reset can prevent this sketch
// from starting. Instead, the user starts the ESP32 normally and then makes
// one short BOOT press during the first 15 seconds of application startup.
void recoverAdminCredentialsFromBoot() {
  pinMode(bootPin, INPUT_PULLUP);

  const unsigned long recoveryWindowMs = 15000;
  const unsigned long debounceMs = 60;
  unsigned long windowStart = millis();
  unsigned long pressedAt = 0;
  bool wasPressed = false;

  Serial.println("admin_recovery:ready");
  Serial.println("admin_recovery:press_boot_once_within_15s");

  while (millis() - windowStart < recoveryWindowMs) {
    bool pressed = digitalRead(bootPin) == LOW;

    if (pressed && !wasPressed) {
      pressedAt = millis();
      wasPressed = true;
    }

    if (!pressed && wasPressed) {
      if (millis() - pressedAt >= debounceMs) {
        Serial.println("admin_recovery:boot_pressed");

        configPreferences.begin("printbit", false);
        configPreferences.remove("admin_user");
        configPreferences.remove("admin_pass");
        configPreferences.end();

        adminUsername = defaultAdminUsername;
        adminPassword = defaultAdminPassword;

        Serial.println("admin_recovery:credentials_reset");
        Serial.println("admin_recovery:complete");
        return;
      }
      wasPressed = false;
    }

    delay(10);
  }

  Serial.println("admin_recovery:not_triggered");
}

void loadAdminConfig() {
  configPreferences.begin("printbit", false);
  wifiManagerApName = configPreferences.getString("ap_name", defaultWifiManagerApName);
  wifiManagerApPassword = configPreferences.getString("ap_pass", defaultWifiManagerApPassword);
  adminUsername = configPreferences.getString("admin_user", defaultAdminUsername);
  adminPassword = configPreferences.getString("admin_pass", defaultAdminPassword);

  if (wifiManagerApName.length() == 0) wifiManagerApName = defaultWifiManagerApName;
  if (wifiManagerApPassword.length() < 8) wifiManagerApPassword = defaultWifiManagerApPassword;
  if (adminUsername.length() == 0) adminUsername = defaultAdminUsername;
  if (adminPassword.length() < 6) adminPassword = defaultAdminPassword;
}

void saveAdminConfig(const String& apName, const String& apPassword,
                     const String& username, const String& password) {
  configPreferences.putString("ap_name", apName);
  configPreferences.putString("ap_pass", apPassword);
  configPreferences.putString("admin_user", username);
  configPreferences.putString("admin_pass", password);
  wifiManagerApName = apName;
  wifiManagerApPassword = apPassword;
  adminUsername = username;
  adminPassword = password;
}

bool isAdminAuthenticated(const String& authHeader) {
  if (!authHeader.startsWith("Basic ")) return false;
  String expected = "Basic " + base64Encode(adminUsername + ":" + adminPassword);
  return authHeader == expected;
}

void sendAdminUnauthorized(NetworkClient& client) {
  client.println("HTTP/1.1 401 Unauthorized");
  client.println("WWW-Authenticate: Basic realm=\"PrintBit ESP32 Admin\"");
  client.println("Content-Length: 0");
  client.println("Connection: close");
  client.println();
}

void sendAdminPage(NetworkClient& client) {
  bool wifiConnected = WiFi.status() == WL_CONNECTED;
  String wifiBadge = wifiConnected
    ? "<span class='badge ok'><span class='dot'></span>Connected</span>"
    : "<span class='badge off'><span class='dot'></span>Disconnected</span>";
  String tabletBadge = tabletOnline
    ? "<span class='badge ok'><span class='dot'></span>Online</span>"
    : "<span class='badge off'><span class='dot'></span>Offline</span>";
  String tabletTarget = kioskIp.length() > 0
    ? htmlEscape(kioskIp) + ":" + String(kioskPort)
    : "Not registered";

  String page = "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>";
  page += "<title>PrintBit ESP32</title>";

  // ---- Styles: modern, simple, still easy to scan on a phone ----
  page += "<style>"
          ":root{--bg:#f4f5f7;--card:#fff;--border:#e4e6ea;--text:#1a1d23;--muted:#6b7280;"
          "--primary:#3b6df0;--primary-dark:#2c56c9;--danger:#e0334c;--warn:#e7a325;"
          "--ok:#1fa971;--ok-bg:#e7f8f1;--off:#9aa1ac;--off-bg:#eef0f2;"
          "--radius:14px;--shadow:0 1px 3px rgba(16,24,40,.06),0 1px 2px rgba(16,24,40,.04);}"
          "*{box-sizing:border-box}"
          "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"
          "background:var(--bg);color:var(--text);margin:0;padding:20px 14px 60px}"
          ".wrap{max-width:520px;margin:0 auto}"
          ".top{margin-bottom:18px}"
          ".top h1{font-size:19px;margin:0 0 2px}"
          ".top p{margin:0;color:var(--muted);font-size:13px}"
          ".card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);"
          "box-shadow:var(--shadow);padding:18px;margin-bottom:16px}"
          ".card h2{font-size:15px;margin:0 0 12px}"
          ".gridbox{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;font-size:13px}"
          ".gridbox .label{color:var(--muted)}"
          ".gridbox .value{font-weight:600;word-break:break-word}"
          ".badge{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:99px;font-size:12px;font-weight:600}"
          ".badge.ok{background:var(--ok-bg);color:var(--ok)}"
          ".badge.off{background:var(--off-bg);color:var(--off)}"
          ".badge .dot{width:6px;height:6px;border-radius:50%;background:currentColor}"
          "label{display:block;font-size:12px;font-weight:600;color:var(--muted);margin-bottom:5px}"
          "input{width:100%;padding:10px 12px;margin-bottom:14px;border:1px solid var(--border);"
          "border-radius:9px;font-size:14px;background:#fafbfc}"
          "input:focus{outline:2px solid var(--primary);outline-offset:1px;background:#fff}"
          "button{width:100%;padding:12px 16px;border:0;border-radius:10px;font-size:14.5px;font-weight:600;"
          "cursor:pointer;color:#fff;transition:transform .08s ease,opacity .15s ease;"
          "-webkit-tap-highlight-color:transparent;user-select:none;touch-action:manipulation}"
          "button:active{transform:scale(.98)}"
          "button:disabled{opacity:.6;cursor:default;transform:none}"
          ".primary{background:var(--primary)}"
          ".danger{background:var(--danger)}"
          ".warn{background:var(--warn);color:#3a2a00}"
          ".hint{color:var(--muted);font-size:12.5px;margin:8px 0 0;line-height:1.5}"
          ".divider{height:1px;background:var(--border);margin:16px 0}"
          ".hold{position:relative;overflow:hidden;"
          "background-image:linear-gradient(to right,rgba(255,255,255,.4) var(--progress,0%),rgba(255,255,255,0) var(--progress,0%))}"
          ".hold.success{opacity:.85}"
          ".hold.error{background:var(--off)}"
          "</style>";

  // ---- Body ----
  page += "</head><body><div class='wrap'>";
  page += "<div class='top'><h1>PrintBit ESP32</h1><p>Device configuration &amp; maintenance</p></div>";

  page += "<div class='card'><h2>Status</h2><div class='gridbox'>";
  page += "<div class='label'>Device</div><div class='value'>" + String(printBitDeviceId) + "</div>";
  page += "<div class='label'>Firmware</div><div class='value'>" + String(firmwareVersion) + "</div>";
  page += "<div class='label'>Wi-Fi</div><div class='value'>" + wifiBadge + "</div>";
  page += "<div class='label'>SSID</div><div class='value'>" + htmlEscape(WiFi.SSID()) + "</div>";
  page += "<div class='label'>IP address</div><div class='value'>" + getEsp32Ip() + "</div>";
  page += "<div class='label'>Signal</div><div class='value'>" + String(wifiConnected ? WiFi.RSSI() : 0) + " dBm</div>";
  page += "<div class='label'>Tablet</div><div class='value'>" + tabletBadge + "</div>";
  page += "<div class='label'>Tablet target</div><div class='value'>" + tabletTarget + "</div>";
  page += "<div class='label'>Free memory</div><div class='value'>" + String(ESP.getFreeHeap()) + " bytes</div>";
  page += "</div></div>";

  page += "<div class='card'><h2>Wi-Fi setup network</h2><form method='POST' action='/admin/save'>";
  page += "<label>Setup network name</label><input name='apName' value='" + htmlEscape(wifiManagerApName) + "'>";
  page += "<label>Setup network password (8+ characters)</label><input type='password' name='apPassword' value='" + htmlEscape(wifiManagerApPassword) + "'>";
  page += "<label>Admin username</label><input name='adminUsername' value='" + htmlEscape(adminUsername) + "'>";
  page += "<label>Admin password (6+ characters)</label><input type='password' name='adminPassword' value='" + htmlEscape(adminPassword) + "'>";
  page += "<button type='submit' class='primary'>Save settings</button></form>";
  page += "<p class='hint'>These apply the next time the Wi-Fi setup network opens.</p></div>";

  page += "<div class='card'><h2>Maintenance</h2>";
  page += "<button id='restartBtn' class='primary'>Restart ESP32</button>";
  page += "<div class='divider'></div>";
  page += "<p class='hint'>Change the router Wi-Fi this device connects to.</p>";
  page += "<button class='warn hold' data-url='/admin/configuration-mode' data-seconds='5' "
          "data-label='Hold 5 seconds' data-sending='Opening setup...' "
          "data-success-hint='Setup network is opening. Connect to it in your Wi-Fi settings to finish.'>"
          "Hold 5 seconds</button>";
  page += "<p class='hint'>Press and hold until the countdown finishes. Release early to cancel.</p>";
  page += "<div class='divider'></div>";
  page += "<p class='hint'>Erases the saved router Wi-Fi, setup network, and admin login.</p>";
  page += "<button class='danger hold' data-url='/admin/factory-reset' data-seconds='10' "
          "data-label='Hold 10 seconds to factory reset' data-sending='Resetting...' "
          "data-success-hint='Resetting. The device will restart and return to factory defaults.'>"
          "Hold 10 seconds to factory reset</button>";
  page += "<p class='hint'>Press and hold for the full 10 seconds. Release early to cancel.</p>";
  page += "</div>";
  page += "</div>";

  // ---- Script ----
  // Fix vs. the previous version: the old code attached the "release to
  // cancel" handler with button.onpointerup, but never captured the
  // pointer. If a finger (or mouse) drifted even slightly off the button
  // while holding -- normal on a touchscreen -- the pointerup event landed
  // on whatever element was now underneath instead of the button, so
  // releasing early never cancelled the hold. setPointerCapture() below
  // pins all further pointer events (up/cancel) to the button regardless
  // of where the pointer physically ends up.
  page += "<script>"
          "(function(){"
          "var activeButton=null;"
          "function resetButton(b){"
          "clearInterval(b._timer);clearTimeout(b._timeout);"
          "b.classList.remove('holding','success','error');"
          "b.disabled=false;b.textContent=b.dataset.label;"
          "b.style.setProperty('--progress','0%');"
          "}"
          "function cancelHold(b){"
          "if(!b||!b._holding)return;"
          "b._holding=false;"
          "if(activeButton===b)activeButton=null;"
          "resetButton(b);"
          "}"
          "var DONE_DISPLAY_MS=2200;"
          "function completeHold(b,url,label,sendingText,successHint){"
          "b._holding=false;"
          "clearInterval(b._timer);clearTimeout(b._timeout);"
          "activeButton=null;"
          "b.classList.remove('holding');"
          "b.disabled=true;b.textContent=sendingText;"
          "var hint=b.nextElementSibling;"
          "fetch(url,{method:'POST'}).then(function(res){"
          "if(!res.ok)throw new Error('http '+res.status);"
          // The ESP32 replies before it actually acts (switches Wi-Fi mode,
          // wipes settings, reboots), so a successful fetch here really
          // does mean the action started -- a flat 'Done' for a fixed
          // stretch is more honest than an open-ended action phrase that
          // never resolves on its own.
          "b.classList.add('success');b.textContent='Done';"
          "if(hint&&successHint){hint.textContent=successHint;}"
          "setTimeout(function(){resetButton(b);},DONE_DISPLAY_MS);"
          "}).catch(function(){"
          "b.classList.add('error');"
          "b.textContent='Failed - tap to retry';b.disabled=false;"
          "if(hint){hint.textContent='That request failed. Tap the button to try again.';}"
          "});"
          "}"
          "function beginHold(b,url,seconds,label,sendingText,successHint){"
          "if(b._holding||b.disabled)return;"
          "if(activeButton&&activeButton!==b)cancelHold(activeButton);"
          "b._holding=true;b.dataset.label=label;activeButton=b;"
          "b.classList.remove('error');b.classList.add('holding');"
          "var start=Date.now();var totalMs=seconds*1000;"
          "b._timer=setInterval(function(){"
          "var elapsed=Date.now()-start;"
          "var remaining=Math.max(0,seconds-Math.floor(elapsed/1000));"
          "var pct=Math.min(100,(elapsed/totalMs)*100);"
          "b.style.setProperty('--progress',pct+'%');"
          "b.textContent='Hold... '+remaining+'s';"
          "},100);"
          "b._timeout=setTimeout(function(){completeHold(b,url,label,sendingText,successHint);},totalMs);"
          "}"
          "function attachHoldButton(b){"
          "var url=b.dataset.url;"
          "var seconds=parseFloat(b.dataset.seconds);"
          "var label=b.dataset.label;"
          "var sendingText=b.dataset.sending;"
          "var successHint=b.dataset.successHint;"
          "b.addEventListener('pointerdown',function(ev){"
          "ev.preventDefault();"
          "try{b.setPointerCapture(ev.pointerId);}catch(e){}"
          "beginHold(b,url,seconds,label,sendingText,successHint);"
          "});"
          "var release=function(){cancelHold(b);};"
          "b.addEventListener('pointerup',release);"
          "b.addEventListener('pointercancel',release);"
          "b.addEventListener('lostpointercapture',release);"
          "b.addEventListener('contextmenu',function(ev){ev.preventDefault();});"
          "}"
          "var holdButtons=document.querySelectorAll('.hold');"
          "for(var i=0;i<holdButtons.length;i++){attachHoldButton(holdButtons[i]);}"
          // Safety net in case an event ever slips past pointer capture
          // (older browsers, odd input devices, etc.).
          "document.addEventListener('pointerup',function(){if(activeButton)cancelHold(activeButton);});"
          "document.addEventListener('pointercancel',function(){if(activeButton)cancelHold(activeButton);});"
          "var restartBtn=document.getElementById('restartBtn');"
          "if(restartBtn){restartBtn.dataset.label=restartBtn.textContent;"
          "restartBtn.addEventListener('click',function(){"
          "if(restartBtn.disabled)return;"
          "restartBtn.disabled=true;restartBtn.textContent='Restarting...';"
          "fetch('/admin/restart',{method:'POST'}).then(function(res){"
          "if(!res.ok)throw new Error('http '+res.status);"
          "restartBtn.textContent='Done';"
          "setTimeout(function(){resetButton(restartBtn);},DONE_DISPLAY_MS);"
          "}).catch(function(){"
          "restartBtn.textContent='Failed - tap to retry';restartBtn.disabled=false;"
          "});"
          "});}"
          "})();"
          "</script>";

  page += "</body></html>";
  client.print("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ");
  client.print(page.length());
  client.print("\r\nConnection: close\r\n\r\n");
  client.print(page);
}

void handleAdminRequest(NetworkClient& client, const String& method,
                        const String& path, const String& authHeader,
                        const String& body) {
  if (!isAdminAuthenticated(authHeader)) {
    sendAdminUnauthorized(client);
    return;
  }

  if (method == "GET" && path == "/admin") {
    sendAdminPage(client);
    return;
  }

  if (method == "POST" && path == "/admin/configuration-mode") {
    if (maintenanceBusy) {
      replyPlain(client, 409, "Conflict", "Maintenance already in progress");
      return;
    }
    configurationModeRequested = true;
    replyPlain(client, 202, "Accepted", "configuration_mode_requested");
    return;
  }

  if (method == "POST" && path == "/admin/restart") {
    if (maintenanceBusy) {
      replyPlain(client, 409, "Conflict", "Maintenance already in progress");
      return;
    }
    restartRequested = true;
    replyPlain(client, 202, "Accepted", "restart_requested");
    return;
  }

  if (method == "POST" && path == "/admin/factory-reset") {
    if (maintenanceBusy) {
      replyPlain(client, 409, "Conflict", "Maintenance already in progress");
      return;
    }
    factoryResetRequested = true;
    replyPlain(client, 202, "Accepted", "factory_reset_requested");
    return;
  }

  if (method == "POST" && path == "/admin/save") {
    String apName = getFormValue(body, "apName");
    String apPassword = getFormValue(body, "apPassword");
    String username = getFormValue(body, "adminUsername");
    String password = getFormValue(body, "adminPassword");
    apName.trim(); apPassword.trim(); username.trim(); password.trim();

    if (apName.length() < 1 || apName.length() > 32 ||
        apPassword.length() < 8 || apPassword.length() > 63 ||
        username.length() < 1 || username.length() > 32 ||
        password.length() < 6 || password.length() > 63) {
      replyPlain(client, 400, "Bad Request", "Invalid configuration values");
      return;
    }

    saveAdminConfig(apName, apPassword, username, password);
    client.println("HTTP/1.1 200 OK");
    String savedPage = "<html><body><h2>Saved</h2><p>Settings saved. The new AP credentials apply the next time the configuration portal opens.</p><a href='/admin'>Back</a></body></html>";
    client.println("Content-Type: text/html; charset=utf-8");
    client.print("Content-Length: ");
    client.println(savedPage.length());
    client.println("Connection: close");
    client.println();
    client.print(savedPage);
    return;
  }

  replyPlain(client, 404, "Not Found", "Not found");
}

// NETWORK MANAGEMENT
void setupWiFi();
void handleWiFiState();
void handleWiFiConnected();
void setupMdns();
void markTabletContact();

String getEsp32Ip() {
  if (WiFi.status() != WL_CONNECTED) return "0.0.0.0";
  return WiFi.localIP().toString();
}

void markTabletContact() {
  lastTabletContactAt = millis();
  tabletOnline = true;
}

void handleWiFiConnected() {
  String currentIp = getEsp32Ip();
  bool ipChanged = currentIp != lastKnownStaIp;
  lastKnownStaIp = currentIp;

  Serial.print("wifi_sta_connected:ssid=");
  Serial.print(WiFi.SSID());
  Serial.print(":ip=");
  Serial.print(currentIp);
  Serial.print(":gateway=");
  Serial.println(WiFi.gatewayIP());

  if (ipChanged) {
    Serial.print("wifi_ip_changed:");
    Serial.println(currentIp);
  }

  // A new STA connection may give the ESP32 a different DHCP address.
  // Clear the old tablet registration and wait for the tablet to register
  // this ESP32 again through /kiosk/register.
  hasKioskRegistration = false;
  tabletOnline = false;
}

void setupMdns() {
  if (WiFi.status() != WL_CONNECTED) return;

  if (MDNS.begin(mdnsHostname)) {
    MDNS.addService("http", "tcp", 80);
    Serial.print("mdns_started:");
    Serial.println(String(mdnsHostname) + ".local");
  } else {
    Serial.println("mdns_error:start_failed");
  }
}

void enterConfigurationMode() {
  maintenanceBusy = true;
  configurationModeRequested = false;

  // Never allow the hopper relay to remain active while entering maintenance.
  digitalWrite(relayPin, LOW);
  dispensing = false;
  dispenseDone = false;
  dispenseTimedOut = false;
  activeDispenseRequestId = "";

  detachInterrupt(coinAcceptorPin);
  detachInterrupt(hopperSensorPin);

  Serial.println("admin_action:configuration_mode");
  Serial.print("wifi_config_ap:");
  Serial.println(wifiManagerApName);

  // WiFiManager also uses HTTP port 80 for its configuration portal.
  // Release our normal HTTP server and mDNS first so the temporary portal
  // can bind cleanly to port 80.
  server.end();
  MDNS.end();
  Serial.println("wifi_config:normal_server_stopped");

  WiFiManager wifiManager;
  wifiManager.setDebugOutput(true);
  wifiManager.setConnectTimeout(20);
  wifiManager.setConfigPortalTimeout(wifiConfigPortalTimeoutSec);
  wifiManager.setWiFiAutoReconnect(true);
  wifiManager.setHostname(printBitDeviceId);

  // startConfigPortal intentionally starts the temporary setup AP.
  wifiManager.startConfigPortal(wifiManagerApName.c_str(), wifiManagerApPassword.c_str());

  if (WiFi.status() == WL_CONNECTED) {
    setupMdns();
    handleWiFiConnected();
    Serial.print("wifi_config_complete:ip=");
    Serial.println(getEsp32Ip());
  } else {
    Serial.println("wifi_config_complete:not_connected");
  }

  // Restore the normal PrintBit HTTP service after WiFiManager exits.
  server.begin();
  Serial.println("wifi_config:normal_server_started");

  attachInterrupt(coinAcceptorPin, countPulse, FALLING);
  attachInterrupt(hopperSensorPin, coinDetected, FALLING);
  wifiWasConnected = WiFi.status() == WL_CONNECTED;
  maintenanceBusy = false;
}

void performRestart() {
  maintenanceBusy = true;
  restartRequested = false;

  // Safety first: never leave the hopper relay active during a maintenance restart.
  digitalWrite(relayPin, LOW);
  dispensing = false;
  dispenseDone = false;
  dispenseTimedOut = false;
  activeDispenseRequestId = "";

  detachInterrupt(coinAcceptorPin);
  detachInterrupt(hopperSensorPin);

  Serial.println("admin_action:restart");
  delay(250);
  ESP.restart();
}

void performFactoryReset() {
  maintenanceBusy = true;
  factoryResetRequested = false;

  // Safety first: the hopper relay must be OFF before any reset operation.
  digitalWrite(relayPin, LOW);
  dispensing = false;
  dispenseDone = false;
  dispenseTimedOut = false;
  activeDispenseRequestId = "";

  detachInterrupt(coinAcceptorPin);
  detachInterrupt(hopperSensorPin);

  Serial.println("admin_action:factory_reset");

  // Erase PrintBit admin/AP settings from NVS.
  configPreferences.clear();
  configPreferences.end();

  // Erase WiFiManager's saved router credentials.
  WiFiManager wifiManager;
  wifiManager.resetSettings();

  Serial.println("factory_reset:settings_cleared");
  Serial.println("factory_reset:restoring_defaults");
  delay(500);
  ESP.restart();
}

void handleMaintenanceRequests() {
  if (maintenanceBusy) return;
  if (factoryResetRequested) {
    performFactoryReset();
    return;
  }
  if (restartRequested) {
    performRestart();
    return;
  }
  if (configurationModeRequested) {
    enterConfigurationMode();
  }
}

void setupWiFi() {
  loadAdminConfig();
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);

  WiFiManager wifiManager;
  wifiManager.setDebugOutput(true);
  wifiManager.setConnectTimeout(20);
  wifiManager.setConfigPortalTimeout(wifiConfigPortalTimeoutSec);
  wifiManager.setWiFiAutoReconnect(true);
  wifiManager.setHostname(printBitDeviceId);

  Serial.println("wifi_start:station_mode");
  Serial.println("wifi_start:attempting_saved_credentials");

  if (!wifiManager.autoConnect(wifiManagerApName.c_str(), wifiManagerApPassword.c_str())) {
    // WiFiManager exits here after the configuration portal times out.
    // Do not start the old ESP32 SoftAP as the normal kiosk network.
    Serial.println("wifi_start:config_portal_timeout_no_connection");
    return;
  }

  if (WiFi.status() == WL_CONNECTED) {
    setupMdns();
    handleWiFiConnected();
  } else {
    Serial.println("wifi_start:connected_call_returned_without_sta");
  }
}

void handleWiFiState() {
  bool connected = WiFi.status() == WL_CONNECTED;

  if (connected && !wifiWasConnected) {
    wifiWasConnected = true;
    setupMdns();
    handleWiFiConnected();
  } else if (!connected && wifiWasConnected) {
    wifiWasConnected = false;
    hasKioskRegistration = false;
    tabletOnline = false;
    Serial.println("wifi_sta_event:disconnected");
  }

  if (!connected) {
    if (millis() - lastWifiReconnectAttemptAt >= wifiReconnectIntervalMs) {
      lastWifiReconnectAttemptAt = millis();
      Serial.println("wifi_sta_reconnect:attempt");
      WiFi.reconnect();
    }
    return;
  }

  if (tabletOnline && millis() - lastTabletContactAt > tabletOfflineTimeoutMs) {
    tabletOnline = false;
    Serial.println("tablet_status:offline_timeout");
  }
}

String decodeUrlComponent(const String& value) {
  String decoded = "";
  for (size_t i = 0; i < value.length(); i++) {
    char c = value.charAt(i);
    if (c == '+') {
      decoded += ' ';
      continue;
    }
    if (c == '%' && i + 2 < value.length()) {
      auto hexToInt = [](char h) -> int {
        if (h >= '0' && h <= '9') return h - '0';
        if (h >= 'A' && h <= 'F') return h - 'A' + 10;
        if (h >= 'a' && h <= 'f') return h - 'a' + 10;
        return -1;
      };
      int hi = hexToInt(value.charAt(i + 1));
      int lo = hexToInt(value.charAt(i + 2));
      if (hi >= 0 && lo >= 0) {
        decoded += char((hi << 4) | lo);
        i += 2;
        continue;
      }
    }
    decoded += c;
  }
  return decoded;
}

String getFormValue(const String& body, const String& key) {
  String needle = key + "=";
  int start = body.indexOf(needle);
  if (start < 0) return "";
  start += needle.length();
  int end = body.indexOf('&', start);
  if (end < 0) end = body.length();
  return decodeUrlComponent(body.substring(start, end));
}

String getQueryValue(const String& query, const String& key) {
  String needle = key + "=";
  int start = query.indexOf(needle);
  if (start < 0) return "";
  start += needle.length();
  int end = query.indexOf('&', start);
  if (end < 0) end = query.length();
  return decodeUrlComponent(query.substring(start, end));
}

bool isNumericString(const String& value) {
  if (value.length() == 0) return false;
  for (size_t i = 0; i < value.length(); i++) {
    if (!isDigit(value.charAt(i))) return false;
  }
  return true;
}

String buildHopperRequestId() {
  return String((uint32_t)esp_random(), HEX) + "-" + String(millis());
}

String normalizedPath(const String& pathCandidate) {
  if (pathCandidate.length() == 0) return "/portal";
  if (pathCandidate.charAt(0) == '/') return pathCandidate;
  return "/" + pathCandidate;
}

bool isValidIpv4Address(const String& ip) {
  int start = 0;
  for (int i = 0; i < 4; i++) {
    int dot = i < 3 ? ip.indexOf('.', start) : ip.length();
    if (dot <= start) return false;
    String part = ip.substring(start, dot);
    if (part.length() > 3) return false;
    for (size_t j = 0; j < part.length(); j++) {
      if (!isDigit(part.charAt(j))) return false;
    }
    int value = part.toInt();
    if (value < 0 || value > 255) return false;
    start = dot + 1;
  }
  return start == ip.length() + 1;
}

void refreshTargets() {
  kioskPortalPath = normalizedPath(kioskPortalPath);
  if (kioskIp.length() == 0) {
    kioskPortalUrl = "";
    tabletServer = "";
    return;
  }
  kioskPortalUrl =
    "http://" + kioskIp + ":" + String(kioskPort) + kioskPortalPath;
  tabletServer = "http://" + kioskIp + ":" + String(kioskPort) + "/coin";
}

void replyRedirect(NetworkClient& client, const String& location) {
  client.println("HTTP/1.1 302 Found");
  client.print("Location: ");
  client.println(location);
  client.println("Content-Length: 0");
  client.println("Connection: close");
  client.println();
}

void replyPlain(
  NetworkClient& client,
  int statusCode,
  const String& statusText,
  const String& body) {
  client.print("HTTP/1.1 ");
  client.print(statusCode);
  client.print(" ");
  client.println(statusText);
  client.println("Content-Type: text/plain; charset=utf-8");
  client.print("Content-Length: ");
  client.println(body.length());
  client.println("Connection: close");
  client.println();
  client.print(body);
}

bool parseRequestLine(const String& requestLine, String& method, String& path) {
  int firstSpace = requestLine.indexOf(' ');
  if (firstSpace <= 0) return false;
  int secondSpace = requestLine.indexOf(' ', firstSpace + 1);
  if (secondSpace <= firstSpace) return false;
  method = requestLine.substring(0, firstSpace);
  path = requestLine.substring(firstSpace + 1, secondSpace);
  return method.length() > 0 && path.length() > 0;
}

String readRequestBody(NetworkClient& client, int contentLength) {
  if (contentLength <= 0) return "";
  String body = "";
  unsigned long start = millis();
  while ((int)body.length() < contentLength && millis() - start < 1500) {
    while (client.available() && (int)body.length() < contentLength) {
      body += char(client.read());
    }
    delay(1);
  }
  if ((int)body.length() < contentLength) {
    Serial.print("http_body_incomplete:expected=");
    Serial.print(contentLength);
    Serial.print(":received=");
    Serial.println(body.length());
  } 
  return body;
}

bool isCaptiveProbePath(const String& path) {
  return path == "/hotspot-detect.html" || path == "/generate_204" || path == "/ncsi.txt" || path == "/connecttest.txt";
}

String buildCoinEventId() {
  coinEventCounter++;
  return String((uint32_t)esp_random(), HEX) + "-" + String(millis()) + "-" + String(coinEventCounter);
}

void logCoinSendFailure(const String& classification, int code, const String& body) {
  Serial.print("coin_send_failed:");
  Serial.print(classification);
  Serial.print(":code=");
  Serial.print(code);
  if (body.length() > 0) {
    Serial.print(":body=");
    Serial.print(body);
  }
  Serial.println();
}

void emitHopperAck(const String& requestId) {
  Serial.print("HOPPER ACK ");
  Serial.println(requestId);
}

void emitHopperProgress(const String& requestId, int dispensed, int total) {
  Serial.print("HOPPER PROGRESS ");
  Serial.print(requestId);
  Serial.print(" ");
  Serial.print(dispensed);
  Serial.print(" ");
  Serial.println(total);
}

void emitHopperDone(const String& requestId, int dispensedCount) {
  Serial.print("HOPPER DONE ");
  Serial.print(requestId);
  Serial.print(" ");
  Serial.println(dispensedCount);
}

void emitHopperError(
  const String& requestId,
  const String& errorCode,
  const String& detail) {
  Serial.print("HOPPER ERR ");
  Serial.print(requestId.length() > 0 ? requestId : "n/a");
  Serial.print(" ");
  Serial.print(errorCode);
  if (detail.length() > 0) {
    Serial.print(" ");
    Serial.print(detail);
  }
  Serial.println();
}

void sendCoinToTablet(int value) {
  if (WiFi.status() != WL_CONNECTED) {
    logCoinSendFailure("wifi_sta_not_connected", 0, "");
    return;
  }
  if (tabletServer.length() == 0) {
    logCoinSendFailure("not_registered", 0, "");
    return;
  }

  const String eventId = buildCoinEventId();
  const String url =
    tabletServer + "?value=" + String(value) + "&eventId=" + eventId;

  for (int attempt = 1; attempt <= maxCoinSendAttempts; attempt++) {
    HTTPClient http;
    http.begin(url);
    http.addHeader("x-coin-source", coinBridgeSource);
    http.addHeader("x-coin-api-key", coinBridgeApiKey);
    http.addHeader("x-coin-event-id", eventId);
    int code = http.GET();
    String body = http.getString();
    http.end();

    if (code >= 200 && code < 300) {
      markTabletContact();
      Serial.print("coin_sent_ok:eventId=");
      Serial.print(eventId);
      Serial.print(":value=");
      Serial.println(value);
      return;
    }
    // if (code == 409) {
    //   logCoinSendFailure("coin_rejected_409", code, body);
    //   return;
    // }
    // if (code == 400) {
    //   logCoinSendFailure("validation_failed", code, body);
    //   return;
    // }
    // if (code == 401 || code == 403) {
    //   logCoinSendFailure("auth_failed", code, body);
    //   return;
    // }
    // if (code > 0 && code < 500) {
    //   logCoinSendFailure("request_rejected", code, body);
    //   return;
    // }

    // Serial.print("coin_send_retry:attempt=");
    // Serial.print(attempt);
    // Serial.print(":code=");
    // Serial.println(code);

    if (attempt >= maxCoinSendAttempts) {
      if (code < 0) {
        logCoinSendFailure("network_unreachable", code, body);
      } else {
        logCoinSendFailure("server_error", code, body);
      }
      return;
    }
    delay(200 * attempt);
  }
}

// The tablet remains the registration initiator. It POSTs to this endpoint
// after discovering this ESP32 over the PrintBit router (or mDNS).
void handleRegisterRequest(NetworkClient& client, const String& body) {
  String postedToken = getFormValue(body, "token");
  String postedIp = getFormValue(body, "ip");
  String postedPort = getFormValue(body, "port");
  String postedPath = getFormValue(body, "path");
  postedToken.trim();
  postedIp.trim();
  postedPort.trim();
  postedPath.trim();

  if (postedToken.length() == 0 || postedToken != kioskRegisterToken) {
    replyPlain(client, 401, "Unauthorized", "Invalid registration token");
    Serial.println("kiosk_register_failed:unauthorized");
    return;
  }
  if (postedIp.length() == 0 || !isValidIpv4Address(postedIp)) {
    replyPlain(client, 400, "Bad Request", "Missing or invalid ip");
    Serial.println("kiosk_register_failed:invalid_ip");
    return;
  }

  int parsedPort = postedPort.toInt();
  if (parsedPort <= 0 || parsedPort > 65535) {
    parsedPort = defaultKioskPort;
  }

  kioskIp = postedIp;
  kioskPort = uint16_t(parsedPort);
  kioskPortalPath = normalizedPath(postedPath);
  hasKioskRegistration = true;
  // A successful registration is direct proof that the tablet is reachable.
  // Mark it online immediately instead of waiting for the first coin event.
  markTabletContact();
  refreshTargets();

  Serial.print("kiosk_registered:coin_target=");
  Serial.println(tabletServer);
  Serial.print("kiosk_registered:portal_target=");
  Serial.println(kioskPortalUrl);

  replyPlain(client, 200, "OK", "registered");
}

void handleWifiRequest(NetworkClient& client) {
  client.setTimeout(250);
  String requestLine = client.readStringUntil('\r');
  client.readStringUntil('\n');
  if (requestLine.length() == 0) {
    Serial.println("http_request_error:empty_request_line");
    client.stop();
    return;
  }

  String method = "";
  String path = "";
  if (!parseRequestLine(requestLine, method, path)) {
    Serial.print("http_request_error:malformed_request_line:");
    Serial.println(requestLine);
    replyPlain(client, 400, "Bad Request", "Invalid request line");
    client.stop();
    return;
  }

  String routePath = path;
  String query = "";
  int querySep = path.indexOf('?');
  if (querySep >= 0) {
    routePath = path.substring(0, querySep);
    query = path.substring(querySep + 1);
  }

  int contentLength = 0;
  String hopperTokenHeader = "";
  String authHeader = "";
  while (client.connected()) {
    String headerLine = client.readStringUntil('\r');
    client.readStringUntil('\n');
    if (headerLine.length() == 0) break;
    int colonPos = headerLine.indexOf(':');
    if (colonPos <= 0) continue;
    String headerKey = headerLine.substring(0, colonPos);
    headerKey.toLowerCase();
    if (headerKey == "content-length") {
      String lengthPart = headerLine.substring(colonPos + 1);
      lengthPart.trim();
      contentLength = lengthPart.toInt();
    } else if (headerKey == "x-hopper-token") {
      hopperTokenHeader = headerLine.substring(colonPos + 1);
      hopperTokenHeader.trim();
    } else if (headerKey == "authorization") {
      authHeader = headerLine.substring(colonPos + 1);
      authHeader.trim();
    }
  }

  String body = "";
  if (contentLength > 0 && contentLength <= 512) {
    body = readRequestBody(client, contentLength);
  } else if (contentLength > 512) {
    Serial.print("http_request_error:content_length_too_large:");
    Serial.println(contentLength);
  }

  if ((method == "GET" && routePath == "/admin") ||
      (method == "POST" && (routePath == "/admin/save" ||
                             routePath == "/admin/restart" ||
                             routePath == "/admin/configuration-mode" ||
                             routePath == "/admin/factory-reset"))) {
    handleAdminRequest(client, method, routePath, authHeader, body);
    client.stop();
    return;
  }

  if (method == "POST" && routePath.startsWith("/kiosk/register")) {
    if (contentLength <= 0 || contentLength > 512) {
      replyPlain(client, 413, "Payload Too Large", "Invalid payload size");
      client.stop();
      return;
    }
    handleRegisterRequest(client, body);
    client.stop();
    return;
  }

  if (method == "GET" && routePath == "/status") {
    String response = "{";
    response += "\"deviceId\":\"";
    response += printBitDeviceId;
    response += "\",\"firmware\":\"";
    response += firmwareVersion;
    response += "\",\"wifiConnected\":";
    response += WiFi.status() == WL_CONNECTED ? "true" : "false";
    response += ",\"ip\":\"";
    response += getEsp32Ip();
    response += "\",\"tabletRegistered\":";
    response += hasKioskRegistration ? "true" : "false";
    response += ",\"tabletOnline\":";
    response += tabletOnline ? "true" : "false";
    response += ",\"freeHeap\":";
    response += String(ESP.getFreeHeap());
    response += ",\"rssi\":";
    response += String(WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0);
    response += ",\"gateway\":\"";
    response += WiFi.gatewayIP().toString();
    response += "\",\"ssid\":\"";
    response += WiFi.SSID();
    response += "\",\"uptimeMs\":";
    response += String(millis());
    response += ",\"configurationMode\":";
    response += maintenanceBusy ? "true" : "false";
    response += "}";
    replyPlain(client, 200, "OK", response);
    client.stop();
    return;
  }

  if (method == "GET" && isCaptiveProbePath(routePath)) {
    replyRedirect(client, kioskPortalUrl);
    client.stop();
    return;
  }

  if ((method == "POST" || method == "GET") && routePath == "/hopper/dispense") {
    String postedToken = getFormValue(body, "token");
    String postedCoins = getFormValue(body, "coins");
    String postedRequestId = getFormValue(body, "requestId");
    if (postedToken.length() == 0) postedToken = hopperTokenHeader;
    if (postedToken.length() == 0) postedToken = getQueryValue(query, "token");
    if (postedCoins.length() == 0) postedCoins = getQueryValue(query, "coins");
    if (postedRequestId.length() == 0) postedRequestId = getQueryValue(query, "requestId");

    postedToken.trim();
    if (postedToken.length() == 0 || postedToken != hopperControlToken) {
      // NOTE: never print the actual token value to Serial/logs — only length,
      // so a leaked/attached logger can't recover the real secret.
      Serial.print("hopper_dispense_rejected:unauthorized:got_len=");
      Serial.print(postedToken.length());
      Serial.print(":expected_len=");
      Serial.println(strlen(hopperControlToken));
      replyPlain(client, 401, "Unauthorized", "Invalid hopper token");
      client.stop();
      return;
    }
    if (!isNumericString(postedCoins)) {
      Serial.print("hopper_dispense_rejected:invalid_coins:raw=");
      Serial.println(postedCoins);
      replyPlain(client, 400, "Bad Request", "Missing or invalid coins");
      client.stop();
      return;
    }

    int coins = postedCoins.toInt();
    String requestId = postedRequestId.length() > 0 ? postedRequestId : buildHopperRequestId();
    if (!startDispense(coins, requestId, "http")) {
      replyPlain(client, 409, "Conflict", "Dispense busy or invalid");
      client.stop();
      return;
    }
    replyPlain(client, 202, "Accepted", "hopper_dispense_started");
    client.stop();
    return;
  }

  if (method == "GET" && routePath == "/hopper/status") {
    String providedToken = getQueryValue(query, "token");
    if (providedToken.length() == 0) providedToken = hopperTokenHeader;
    if (providedToken.length() == 0 || providedToken != hopperControlToken) {
      Serial.println("hopper_status_rejected:unauthorized");
      replyPlain(client, 401, "Unauthorized", "Invalid hopper token");
      client.stop();
      return;
    }
    int dispensedSnapshot = 0;
    noInterrupts();
    dispensedSnapshot = coinDispensed;
    interrupts();

    String response = "{";

    response += "\"dispensing\":";
    response += dispensing ? "true" : "false";

    response += ",\"targetCoins\":";
    response += String(targetCoins);

    response += ",\"dispensedCoins\":";
    response += String(dispensedSnapshot);

    response += ",\"activeRequestId\":\"";
    response += activeDispenseRequestId;

    response += "\",\"lastRequestId\":\"";
    response += lastDispenseRequestId;

    response += "\",\"lastOutcome\":\"";
    response += lastDispenseOutcome;

    response += "\",\"lastError\":\"";
    response += lastDispenseError;

    response += "\",\"hopperLow\":";
    response += (lastDispenseOutcome == "failed" &&
                lastDispenseError == "MOTOR_TIMEOUT")
                ? "true"
                : "false";

    response += ",\"success\":";
    response += (!dispensing &&
                lastDispenseOutcome == "done" &&
                dispensedSnapshot >= targetCoins)
                ? "true"
                : "false";

    response += ",\"lastFinishedAtMs\":";
    response += String(lastDispenseFinishedAt);

    response += "}";

    replyPlain(client, 200, "OK", response);
    client.stop();
    return;
  }

  if (method == "GET" && routePath == "/" && query.startsWith("coins=")) {
    int coins = getQueryValue(query, "coins").toInt();
    startDispense(coins, buildHopperRequestId(), "legacy_query");
  }

  if (routePath != "/") {
    Serial.print("http_request_unmatched:method=");
    Serial.print(method);
    Serial.print(":path=");
    Serial.println(path);
  }

  replyPlain(client, 200, "OK", "PRINTBIT OK");
  client.stop();
}

// INTERRUPTS
void IRAM_ATTR countPulse() {
  unsigned long nowMicros = micros();

  if (nowMicros - lastPulseMicros > debounceMicros) {
    if (pulseCount < pulseCountCap) {
      pulseCount++;
    } else {
      glitchPulseCount++;
    }
    lastPulseMicros = nowMicros;
    lastPulseMillis = millis();
  }
}

void IRAM_ATTR coinDetected() {
  unsigned long now = micros();

  if (now - lastCoinTime > hopperDebounce) {
    coinDispensed++;
    dispenseProgressDirty = true;
    lastCoinTime = now;

    if (dispensing && coinDispensed >= targetCoins) {
      digitalWrite(relayPin, LOW);
      dispensing = false;
      dispenseDone = true;
    }
  }
}

// DISPENSE
bool startDispense(
  int coins,
  const String& requestId,
  const String& sourceLabel) {
  if (dispensing) {
    emitHopperError(requestId, "UNKNOWN", "BUSY");
    return false;
  }
  if (coins <= 0 || coins > maxDispenseCoins) {
    emitHopperError(requestId, "UNKNOWN", "INVALID_COIN_COUNT");
    return false;
  }

  targetCoins = coins;
  noInterrupts();
  coinDispensed = 0;
  dispenseProgressDirty = false;
  interrupts();
  dispensing = true;
  dispenseDone = false;
  dispenseTimedOut = false;
  hopperStartTime = millis();
  lastProgressReported = -1;
  activeDispenseRequestId = requestId.length() > 0 ? requestId : buildHopperRequestId();
  lastDispenseRequestId = activeDispenseRequestId;
  lastDispenseOutcome = "dispensing";
  lastDispenseError = "";

  digitalWrite(relayPin, HIGH);
  emitHopperAck(activeDispenseRequestId);

  Serial.print("hopper_start:requestId=");
  Serial.print(activeDispenseRequestId);
  Serial.print(":coins=");
  Serial.print(targetCoins);
  Serial.print(":source=");
  Serial.println(sourceLabel);
  return true;
}

void handleSerialCommand(const String& rawLine) {
  String line = rawLine;
  line.trim();
  if (line.length() == 0) return;

  if (line.startsWith("HOPPER ")) {
    int first = line.indexOf(' ');
    int second = line.indexOf(' ', first + 1);
    String verb = second > 0 ? line.substring(first + 1, second) : "";
    verb.toUpperCase();

    if (verb == "SELFTEST") {
      String requestId =
        second > 0 ? line.substring(second + 1) : buildHopperRequestId();
      requestId.trim();
      if (requestId.length() == 0) requestId = buildHopperRequestId();
      emitHopperAck(requestId);
      emitHopperDone(requestId, 0);
      return;
    }

    if (verb == "DISPENSE") {
      int third = line.indexOf(' ', second + 1);
      String requestId = third > 0 ? line.substring(second + 1, third) : "";
      String coinsRaw = third > 0 ? line.substring(third + 1) : "";
      requestId.trim();
      coinsRaw.trim();
      if (requestId.length() == 0) requestId = buildHopperRequestId();
      if (!isNumericString(coinsRaw)) {
        emitHopperError(requestId, "UNKNOWN", "INVALID_COIN_COUNT");
        return;
      }

      int coins = coinsRaw.toInt();
      startDispense(coins, requestId, "serial_protocol");
      return;
    }

    Serial.print("serial_command_error:unsupported_verb:");
    Serial.println(verb);
    emitHopperError(buildHopperRequestId(), "UNKNOWN", "UNSUPPORTED_COMMAND");
    return;
  }

  if (isNumericString(line)) {
    int command = line.toInt();
    if (command > 0 && command <= maxDispenseCoins) {
      startDispense(command, buildHopperRequestId(), "serial_legacy");
    } else {
      Serial.print("serial_command_error:coin_count_out_of_range:");
      Serial.println(command);
    }
    return;
  }

  Serial.print("serial_command_error:unrecognized_line:");
  Serial.println(line);
}

// SETUP
void setup() {
  pinMode(coinAcceptorPin, INPUT_PULLUP);
  pinMode(hopperSensorPin, INPUT);
  pinMode(relayPin, OUTPUT);

  digitalWrite(relayPin, LOW);

  Serial.begin(115200);

  // Start the application normally, then allow one simple BOOT-button press
  // during the recovery window. Holding BOOT during reset is intentionally
  // not used because GPIO0 controls the ESP32 ROM download mode.
  recoverAdminCredentialsFromBoot();
  refreshTargets();

  // WiFiManager may temporarily block while the configuration portal is open.
  // Attach hardware interrupts only after network setup so coin/hopper events
  // are not accumulated while the device is waiting for Wi-Fi configuration.
  setupWiFi();
  wifiWasConnected = WiFi.status() == WL_CONNECTED;

  attachInterrupt(coinAcceptorPin, countPulse, FALLING);
  attachInterrupt(hopperSensorPin, coinDetected, FALLING);

  Serial.print("STA_IP:");
  Serial.println(getEsp32Ip());
  Serial.print("MDNS_HOSTNAME:");
  Serial.print(mdnsHostname);
  Serial.println(".local");
  Serial.print("tablet_target:");
  Serial.println(tabletServer);
  Serial.print("portal_target:");
  Serial.println(kioskPortalUrl);

  server.begin();

  minFreeHeapSeen = ESP.getFreeHeap();
  Serial.println("k kDY");
}

// LOOP
void loop() {
  handleWiFiState();
  handleMaintenanceRequests();

  uint16_t tempCount;
  unsigned long tempLastPulse;
  uint16_t tempGlitchCount;

  noInterrupts();
  tempCount = pulseCount;
  tempLastPulse = lastPulseMillis;
  tempGlitchCount = glitchPulseCount;
  interrupts();

  if (tempCount > 0 && millis() - tempLastPulse > coinTimeout) {
    int value = 0;
    if (tempCount == 1) value = 1;
    else if (tempCount == 3) value = 5;
    else if (tempCount == 5) value = 10;
    else if (tempCount == 7) value = 20;

    if (value > 0) {
      Serial.print("coin_pulse:");
      Serial.println(value);
      sendCoinToTablet(value);
    } else if (tempCount >= pulseCountCap || tempGlitchCount > 0) {
      Serial.print("coin_pulse_error:pulse_train_saturated:count=");
      Serial.print(tempCount);
      Serial.print(":overflow=");
      Serial.println(tempGlitchCount);
    } else {
      Serial.print("coin_pulse_error:unrecognized_pulse_count:");
      Serial.println(tempCount);
    }

    noInterrupts();
    pulseCount = 0;
    glitchPulseCount = 0;
    interrupts();
  }

  // SERIAL COMMAND
  while (Serial.available()) {
    char c = char(Serial.read());
    if (c == '\r') continue;
    if (c == '\n') {
      handleSerialCommand(serialLineBuffer);
      serialLineBuffer = "";
      continue;
    }
    if (serialLineBuffer.length() < 120) {
      serialLineBuffer += c;
    } else {
      Serial.println("serial_command_error:line_too_long_truncated");
    }
  }

  // WIFI REQUEST
  NetworkClient client = server.accept();
  if (client) {
    handleWifiRequest(client);
  }

  int dispensedSnapshot = 0;
  bool progressDirtySnapshot = false;
  noInterrupts();
  dispensedSnapshot = coinDispensed;
  progressDirtySnapshot = dispenseProgressDirty;
  dispenseProgressDirty = false;
  interrupts();

  if (dispensing && progressDirtySnapshot && dispensedSnapshot != lastProgressReported) {
    lastProgressReported = dispensedSnapshot;
    emitHopperProgress(activeDispenseRequestId, dispensedSnapshot, targetCoins);
  }

  // HOPPER TIMEOUT
  if (dispensing && millis() - hopperStartTime > hopperMaxRunTime) {
    digitalWrite(relayPin, LOW);
    dispensing = false;
    dispenseTimedOut = true;
  }

  if (dispenseTimedOut) {
    dispenseTimedOut = false;
    lastDispenseOutcome = "failed";
    lastDispenseError = "MOTOR_TIMEOUT";
    lastDispenseFinishedAt = millis();
    emitHopperError(activeDispenseRequestId, "MOTOR_TIMEOUT", "timeout");
    Serial.print("hopper_done:requestId=");
    Serial.print(activeDispenseRequestId);
    Serial.println(":outcome=failed");
    activeDispenseRequestId = "";
  }

  if (dispenseDone) {
    dispenseDone = false;
    lastDispenseOutcome = "done";
    lastDispenseError = "";
    lastDispenseFinishedAt = millis();
    emitHopperDone(activeDispenseRequestId, dispensedSnapshot);
    Serial.print("hopper_done:requestId=");
    Serial.print(lastDispenseRequestId);
    Serial.print(":dispensed=");
    Serial.println(dispensedSnapshot);
    activeDispenseRequestId = "";
  }

  static unsigned long lastRegistrationStatusAt = 0;
  if (!hasKioskRegistration && millis() - lastRegistrationStatusAt > 15000) {
    lastRegistrationStatusAt = millis();
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("kiosk_register_pending:waiting_for_tablet");
    } else {
      Serial.println("kiosk_register_pending:wifi_not_connected");
    }
  }

  // HEAP HEALTH
  if (millis() - lastHeapCheckAt > heapCheckIntervalMs) {
    lastHeapCheckAt = millis();
    uint32_t freeHeap = ESP.getFreeHeap();
    if (freeHeap < minFreeHeapSeen) minFreeHeapSeen = freeHeap;
    if (freeHeap < lowHeapWarnThreshold) {
      Serial.print("system_warning:low_heap:free=");
      Serial.print(freeHeap);
      Serial.print(":min_seen=");
      Serial.println(minFreeHeapSeen);
    }
  }
}

