#include <WiFi.h>
#include <NetworkClient.h>
#include <WiFiAP.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <esp_wifi.h>
#include <esp_netif.h>

#define coinAcceptorPin 4
#define hopperSensorPin 19
#define relayPin 27
#define bootButtonPin 0

const char* defaultApSsid = "PrintBit";
const char* defaultApPassword = "";
const char* defaultAdminUsername = "admin";
const char* defaultAdminPassword = "printbitadmin";
const unsigned long credentialRecoveryWindowMs = 15000;

Preferences preferences;
String apSsid = "";
String apPassword = "";
bool apPasswordEnabled = false;
String adminUsername = "";
String adminPassword = "";
String adminSessionToken = "";
const IPAddress apIp(192, 168, 4, 1);

const char* fallbackKioskIp = "192.168.4.2";
const uint16_t fallbackKioskPort = 3000;
const char* fallbackKioskPortalPath = "/portal";
const char* kioskRegisterToken = "printbit-register-token";
const char* coinBridgeSource = "esp32";
const char* coinBridgeApiKey = "printbit-coin-bridge-key";
const char* hopperControlToken = "printbit-coin-bridge-key";

NetworkServer server(80);

String kioskIp = fallbackKioskIp;
uint16_t kioskPort = fallbackKioskPort;
String kioskPortalPath = fallbackKioskPortalPath;
String kioskPortalUrl = "";
String tabletServer = "";
bool hasKioskRegistration = false;

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
bool hopperManualOn = false;
bool dispenseAllMode = false;
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

// HEAP MONITORING
const unsigned long heapCheckIntervalMs = 10000;
const uint32_t lowHeapWarnThreshold = 20000;
unsigned long lastHeapCheckAt = 0;
uint32_t minFreeHeapSeen = UINT32_MAX;

bool startDispense(
  int coins,
  const String& requestId,
  const String& sourceLabel);
void handleAdminWifiSave(NetworkClient& client, const String& body);
void handleAdminCredentials(NetworkClient& client, const String& body);
void handleAdminDisconnectDevice(NetworkClient& client, const String& body);
void handleAdminDisconnectAllDevices(NetworkClient& client);
void handleAdminHopperDispense(NetworkClient& client, const String& body);
void handleAdminHopperDispenseAll(NetworkClient& client);
void handleAdminHopperOn(NetworkClient& client);
void handleAdminHopperStop(NetworkClient& client);
void replyPlain(NetworkClient& client, int statusCode, const String& statusText, const String& message);
bool saveApCredentials(const String& newSsid, const String& newPassword, bool passwordEnabled);
void loadApCredentials();

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

String htmlEscape(const String& value) {
  String escaped = "";
  escaped.reserve(value.length() + 16);
  for (size_t i = 0; i < value.length(); i++) {
    char c = value.charAt(i);
    if (c == '&') escaped += "&amp;";
    else if (c == '<') escaped += "&lt;";
    else if (c == '>') escaped += "&gt;";
    else if (c == '"') escaped += "&quot;";
    else if (c == '\'') escaped += "&#39;";
    else escaped += c;
  }
  return escaped;
}

void resetApCredentials() {
  preferences.begin("printbit", false);
  preferences.remove("ssid");
  preferences.remove("password");
  preferences.remove("passwordEnabled");
  preferences.end();
  apSsid = defaultApSsid;
  apPassword = "";
  apPasswordEnabled = false;
}

String makeAdminSessionToken() {
  return String((uint32_t)esp_random(), HEX) + String((uint32_t)esp_random(), HEX);
}

bool hasAdminAuthorization(const String& authorizationHeader) {
  const String prefix = "Bearer ";
  if (!authorizationHeader.startsWith(prefix)) return false;
  String token = authorizationHeader.substring(prefix.length());
  token.trim();
  return token.length() > 0 && token == adminSessionToken;
}

void replyAdminRedirect(NetworkClient& client, const String& location) {
  client.println("HTTP/1.1 302 Found");
  client.print("Location: ");
  client.println(location);
  client.println("Cache-Control: no-store");
  client.println("Content-Length: 0");
  client.println("Connection: close");
  client.println();
}

void replyAdminHtml(NetworkClient& client, const String& html, const String& extraHeaders = "") {
  client.println("HTTP/1.1 200 OK");
  client.println("Content-Type: text/html; charset=utf-8");
  client.println("Cache-Control: no-store");
  if (extraHeaders.length() > 0) client.print(extraHeaders);
  client.print("Content-Length: ");
  client.println(html.length());
  client.println("Connection: close");
  client.println();
  client.print(html);
}

void replyAdminUnauthorized(NetworkClient& client) {
  client.println("HTTP/1.1 401 Unauthorized");
  client.println("Content-Type: text/plain; charset=utf-8");
  client.println("Cache-Control: no-store");
  client.println("Content-Length: 20");
  client.println("Connection: close");
  client.println();
  client.print("Admin login required");
}

void replyAdminJson(NetworkClient& client, const String& json, int statusCode = 200, const String& statusText = "OK") {
  client.print("HTTP/1.1 "); client.print(statusCode); client.print(" "); client.println(statusText);
  client.println("Content-Type: application/json; charset=utf-8");
  client.println("Cache-Control: no-store");
  client.print("Content-Length: "); client.println(json.length());
  client.println("Connection: close"); client.println(); client.print(json);
}

void loadAdminCredentials() {
  preferences.begin("printbit", true);
  adminUsername = preferences.getString("admin_user", defaultAdminUsername);
  adminPassword = preferences.getString("admin_pass", defaultAdminPassword);
  preferences.end();

  if (adminUsername.length() == 0 || adminUsername.length() > 32) {
    adminUsername = defaultAdminUsername;
  }
  if (adminPassword.length() < 8 || adminPassword.length() > 63) {
    adminPassword = defaultAdminPassword;
  }
}

bool saveAdminCredentials(const String& newUsername, const String& newPassword) {
  if (newUsername.length() == 0 || newUsername.length() > 32) return false;
  if (newPassword.length() < 8 || newPassword.length() > 63) return false;

  preferences.begin("printbit", false);
  bool ok = preferences.putString("admin_user", newUsername) > 0;
  ok = preferences.putString("admin_pass", newPassword) > 0 && ok;
  preferences.end();

  if (ok) {
    adminUsername = newUsername;
    adminPassword = newPassword;
  }
  return ok;
}

void handleAdminLogin(NetworkClient& client, const String& body) {
  String username = getFormValue(body, "username");
  String password = getFormValue(body, "password");
  username.trim(); password.trim();
  if (username != adminUsername || password != adminPassword) {
    Serial.print("admin_login_failed:invalid_credentials:username=");
    Serial.println(username.length() > 0 ? "provided" : "missing");
    replyAdminJson(client, "{\"ok\":false,\"error\":\"Invalid username or password\"}", 401, "Unauthorized");
    return;
  }
  adminSessionToken = makeAdminSessionToken();
  Serial.println("admin_login_success:session_created");
  replyAdminJson(client, "{\"ok\":true,\"token\":\"" + adminSessionToken + "\"}");
}

void replyAdminLoginPage(NetworkClient& client) {
  String html = R"HTML(<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>PrintBit Admin</title><style>body{margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#18202a}.wrap{max-width:430px;margin:70px auto;padding:20px}.card{background:#fff;border:1px solid #e0e5ea;border-radius:18px;padding:28px;box-shadow:0 8px 30px rgba(0,0,0,.06)}.brand{font-size:13px;font-weight:700;letter-spacing:1.5px;color:#66717d;text-transform:uppercase}h1{margin:8px 0 6px;font-size:28px}p{color:#66717d;line-height:1.5}label{display:block;margin-top:18px;font-weight:700;font-size:14px}input{box-sizing:border-box;width:100%;padding:13px 14px;margin-top:7px;border:1px solid #cbd3db;border-radius:10px;font-size:16px}button{width:100%;border:0;border-radius:10px;padding:13px;margin-top:22px;background:#18202a;color:#fff;font-size:16px;font-weight:700;cursor:pointer}.error{display:none;margin-top:16px;padding:11px;border-radius:9px;background:#fff0f0;color:#a22b2b;font-size:14px}</style></head><body><div class="wrap"><div class="card"><div class="brand">PrintBit</div><h1>Admin Login</h1><p>Sign in to manage this kiosk locally.</p><form id="login"><label>Username</label><input id="username" autocomplete="username" required><label>Password</label><input id="password" type="password" autocomplete="current-password" required><div id="error" class="error"></div><button type="submit">Sign in</button></form></div></div><script>document.getElementById('login').addEventListener('submit',async e=>{e.preventDefault();const er=document.getElementById('error');er.style.display='none';try{const body='username='+encodeURIComponent(username.value)+'&password='+encodeURIComponent(password.value);const r=await fetch('/admin/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});const d=await r.json();if(!r.ok)throw Error(d.error||'Login failed');sessionStorage.setItem('printbit_admin_token',d.token);location='/admin';}catch(x){er.textContent=x.message;er.style.display='block';}});</script></body></html>)HTML";
  replyAdminHtml(client, html);
}

String stationMacToString(const uint8_t* mac) {
  char buffer[18];
  snprintf(buffer, sizeof(buffer), "%02X:%02X:%02X:%02X:%02X:%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return String(buffer);
}

bool getStationIpByMac(const uint8_t* mac, IPAddress& stationIp) {
  esp_netif_t* apNetif = esp_netif_get_handle_from_ifkey("WIFI_AP_DEF");
  if (apNetif == nullptr) return false;

  esp_netif_pair_mac_ip_t pair;
  memset(&pair, 0, sizeof(pair));
  memcpy(pair.mac, mac, 6);

  esp_err_t result = esp_netif_dhcps_get_clients_by_mac(apNetif, 1, &pair);
  if (result != ESP_OK) {
    result = esp_netif_arp_get_client_by_mac(apNetif, &pair);
    if (result != ESP_OK) return false;
  }

  if (pair.ip.addr == 0) return false;
  stationIp = IPAddress(pair.ip.addr);
  return true;
}

String buildConnectedDevicesJson(const IPAddress& adminIp) {
  wifi_sta_list_t stationList;
  memset(&stationList, 0, sizeof(stationList));

  String json = "[";
  if (esp_wifi_ap_get_sta_list(&stationList) == ESP_OK) {
    bool first = true;
    for (int i = 0; i < stationList.num; i++) {
      IPAddress stationIp;
      bool ipKnown = getStationIpByMac(stationList.sta[i].mac, stationIp);
      bool isAdmin = ipKnown && stationIp == adminIp;

      if (!first) json += ",";
      first = false;

      json += "{\"mac\":\"" + stationMacToString(stationList.sta[i].mac) +
              "\",\"rssi\":" + String(stationList.sta[i].rssi) +
              ",\"ip\":\"";
      json += ipKnown ? stationIp.toString() : "";
      json += "\",\"isAdmin\":" + String(isAdmin ? "true" : "false") + "}";
    }
  }
  json += "]";
  return json;
}

String disconnectErrorCode = "";

bool disconnectAllStationsExcept(const IPAddress& adminIp, int& disconnectedCount, bool& adminExcluded) {
  disconnectedCount = 0;
  adminExcluded = false;

  wifi_sta_list_t stationList;
  memset(&stationList, 0, sizeof(stationList));
  esp_err_t listResult = esp_wifi_ap_get_sta_list(&stationList);
  if (listResult != ESP_OK) {
    disconnectErrorCode = "STA_LIST_FAILED";
    Serial.print("admin_device_clear_all:failed:sta_list:error=");
    Serial.println((int)listResult);
    return false;
  }

  bool adminIdentified = false;
  for (int i = 0; i < stationList.num; i++) {
    IPAddress stationIp;
    if (getStationIpByMac(stationList.sta[i].mac, stationIp) && stationIp == adminIp) {
      adminIdentified = true;
      adminExcluded = true;
      break;
    }
  }

  if (!adminIdentified) {
    disconnectErrorCode = "ADMIN_DEVICE_NOT_IDENTIFIED";
    Serial.println("admin_device_clear_all:failed:admin_device_not_identified");
    return false;
  }

  for (int i = 0; i < stationList.num; i++) {
    IPAddress stationIp;
    bool isAdmin = getStationIpByMac(stationList.sta[i].mac, stationIp) && stationIp == adminIp;
    if (isAdmin) continue;

    uint16_t aid = 0;
    esp_err_t aidResult = esp_wifi_ap_get_sta_aid(stationList.sta[i].mac, &aid);
    if (aidResult != ESP_OK || aid == 0) {
      Serial.print("admin_device_clear_all:skip:aid_lookup_failed:mac=");
      Serial.println(stationMacToString(stationList.sta[i].mac));
      continue;
    }

    esp_err_t result = esp_wifi_deauth_sta(aid);
    if (result == ESP_OK) {
      disconnectedCount++;
      Serial.print("admin_device_clear_all:success:mac=");
      Serial.println(stationMacToString(stationList.sta[i].mac));
    } else {
      Serial.print("admin_device_clear_all:skip:deauth_failed:mac=");
      Serial.print(stationMacToString(stationList.sta[i].mac));
      Serial.print(":error=");
      Serial.println((int)result);
    }
  }

  return true;
}

bool disconnectStationByMac(const String& macText) {
  disconnectErrorCode = "";
  String wanted = macText;
  wanted.trim();
  wanted.toUpperCase();

  if (wanted.length() != 17) {
    disconnectErrorCode = "INVALID_MAC";
    return false;
  }

  wifi_sta_list_t stationList;
  memset(&stationList, 0, sizeof(stationList));
  esp_err_t listResult = esp_wifi_ap_get_sta_list(&stationList);
  if (listResult != ESP_OK) {
    disconnectErrorCode = "STA_LIST_FAILED";
    Serial.print("admin_device_disconnect:failed:sta_list:error=");
    Serial.println((int)listResult);
    return false;
  }

  for (int i = 0; i < stationList.num; i++) {
    String current = stationMacToString(stationList.sta[i].mac);
    if (current != wanted) continue;

    uint16_t aid = 0;
    esp_err_t aidResult = esp_wifi_ap_get_sta_aid(stationList.sta[i].mac, &aid);
    if (aidResult != ESP_OK || aid == 0) {
      disconnectErrorCode = "AID_LOOKUP_FAILED";
      Serial.print("admin_device_disconnect:failed:aid_lookup:mac=");
      Serial.print(wanted);
      Serial.print(":error=");
      Serial.println((int)aidResult);
      return false;
    }

    Serial.print("admin_device_disconnect:attempt:mac=");
    Serial.print(wanted);
    Serial.print(":aid=");
    Serial.println(aid);

    esp_err_t result = esp_wifi_deauth_sta(aid);
    if (result == ESP_OK) {
      Serial.print("admin_device_disconnect:success:mac=");
      Serial.print(wanted);
      Serial.print(":aid=");
      Serial.println(aid);
      return true;
    }

    disconnectErrorCode = "DEAUTH_FAILED";
    Serial.print("admin_device_disconnect:failed:deauth:mac=");
    Serial.print(wanted);
    Serial.print(":aid=");
    Serial.print(aid);
    Serial.print(":error=");
    Serial.println((int)result);
    return false;
  }

  disconnectErrorCode = "NOT_CONNECTED";
  Serial.print("admin_device_disconnect:failed:mac_not_connected:mac=");
  Serial.println(wanted);
  return false;
}

void replyAdminDashboardPage(NetworkClient& client) {
  String html = R"HTML(<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>PrintBit Admin</title><style>:root{--bg:#f5f7fa;--card:#fff;--text:#17202a;--muted:#697586;--line:#e7ebef;--primary:#17202a;--soft:#eef2f5;--success:#197a4b;--success-bg:#eaf7f0;--danger:#b42318;--danger-bg:#fff0ee;--shadow:0 8px 28px rgba(16,24,40,.06)}*{box-sizing:border-box}body{margin:0;background:var(--bg);font-family:Arial,sans-serif;color:var(--text)}button,input{font:inherit}.wrap{max-width:1080px;margin:0 auto;padding:28px 20px 44px}.top{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:28px}.brand{font-size:12px;font-weight:800;letter-spacing:1.8px;color:var(--muted);text-transform:uppercase}.top h1{margin:5px 0 3px;font-size:30px;letter-spacing:-.5px}.muted{color:var(--muted);font-size:14px}.section{margin-top:24px}.section-title{display:flex;align-items:end;justify-content:space-between;margin-bottom:10px}.section-title h2{margin:0;font-size:17px}.section-title span{font-size:13px;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}.card{grid-column:span 6;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;box-shadow:var(--shadow)}.wide{grid-column:span 12}.card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}.card h3{margin:0;font-size:16px}.badge{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:700;background:var(--soft);color:var(--muted)}.badge:before{content:"";width:7px;height:7px;border-radius:50%;background:#98a2b3}.badge.success{background:var(--success-bg);color:var(--success)}.badge.success:before{background:var(--success)}.rows{border-top:1px solid var(--line)}.row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:12px 0;border-bottom:1px solid var(--line)}.row:last-child{border-bottom:0}.label{color:var(--muted);font-size:14px}.value{font-size:14px;font-weight:700;text-align:right;word-break:break-word}.hint{margin:0 0 16px;color:var(--muted);font-size:13px;line-height:1.5}.field{margin-top:14px}.field:first-of-type{margin-top:0}.field label{display:block;margin-bottom:6px;font-size:13px;font-weight:700}.field input{width:100%;padding:11px 12px;border:1px solid #cfd6de;border-radius:10px;background:#fff;color:var(--text);outline:none}.field input:focus{border-color:#7b8794;box-shadow:0 0 0 3px rgba(123,135,148,.12)}.check{display:flex;align-items:center;gap:9px;margin-top:14px;font-size:14px;font-weight:700}.check input{width:16px;height:16px}.actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:16px}.btn{border:0;border-radius:10px;padding:10px 14px;background:var(--primary);color:#fff;font-size:14px;font-weight:700;cursor:pointer}.btn:hover{filter:brightness(.94)}.btn:disabled{opacity:.55;cursor:not-allowed}.btn.secondary{background:var(--soft);color:var(--text)}.btn.danger{background:var(--danger);color:#fff}.top .btn{margin:0}.device-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap}.device-list{border-top:1px solid var(--line)}.device{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 0;border-bottom:1px solid var(--line)}.device:last-child{border-bottom:0}.device-main{min-width:0}.device-name{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:14px;font-weight:800}.device-meta{margin-top:4px;color:var(--muted);font-size:12px}.device-badge{display:inline-flex;margin-left:8px;padding:3px 7px;border-radius:999px;background:var(--success-bg);color:var(--success);font-size:10px;font-weight:800}.device-actions{display:flex;gap:8px;align-items:center}.hopper-controls{display:grid;grid-template-columns:minmax(180px,260px) 1fr;gap:16px;align-items:end}.hopper-actions{display:grid;grid-template-columns:repeat(4,minmax(110px,1fr));gap:9px}.hopper-actions .btn{width:100%;margin:0}.device .btn{padding:8px 11px;font-size:12px;white-space:nowrap}.empty{padding:12px 0;color:var(--muted);font-size:14px}.notice{margin-top:14px;padding:11px 12px;border-radius:10px;background:#f8fafb;color:#596675;font-size:13px;line-height:1.5}.danger-zone{border-color:#f1d5d2}.error{display:none;margin-bottom:18px;padding:12px 14px;border:1px solid #f0c7c3;border-radius:10px;background:var(--danger-bg);color:var(--danger);font-size:13px}.toast{position:fixed;right:20px;bottom:20px;max-width:360px;padding:12px 14px;border-radius:10px;background:var(--primary);color:#fff;box-shadow:var(--shadow);font-size:13px;display:none}.spinner{display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;vertical-align:-2px;margin-right:6px}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:900px){.hopper-controls{grid-template-columns:1fr}.hopper-actions{grid-template-columns:repeat(2,minmax(120px,1fr))}}@media(max-width:760px){.wrap{padding:20px 14px 34px}.top{align-items:flex-start;flex-direction:column}.top .btn{width:100%}.card,.wide{grid-column:span 12}.device{align-items:flex-start}.device .btn{margin-top:2px}}@media(max-width:460px){.device{flex-direction:column}.device-actions{width:100%}.device-actions .btn{flex:1}.actions .btn{width:100%}.hopper-actions{grid-template-columns:1fr}.top h1{font-size:26px}}</style></head><body><div class="wrap"><header class="top"><div><div class="brand">PrintBit</div><h1>Admin Dashboard</h1><div class="muted">Manage this kiosk locally</div></div><button id="logout" class="btn secondary" type="button">Log out</button></header><div id="error" class="error"></div><section class="section"><div class="section-title"><h2>Overview</h2><span>Live kiosk information</span></div><div class="grid"><section class="card"><div class="card-head"><h3>Network status</h3><span id="networkBadge" class="badge">Loading</span></div><div class="rows"><div class="row"><span class="label">Wi-Fi network</span><span id="ssid" class="value">Loading...</span></div><div class="row"><span class="label">AP address</span><span class="value">192.168.4.1</span></div><div class="row"><span class="label">Connected devices</span><span id="stations" class="value">Loading...</span></div></div></section><section class="card"><div class="card-head"><h3>Kiosk status</h3><span id="registrationBadge" class="badge">Loading</span></div><div class="rows"><div class="row"><span class="label">Registration</span><span id="registration" class="value">Loading...</span></div><div class="row"><span class="label">Free memory</span><span id="heap" class="value">Loading...</span></div><div class="row"><span class="label">Admin account</span><span id="adminUser" class="value">Loading...</span></div></div></section></div></section><section class="section"><div class="section-title"><h2>Devices</h2><span>Currently connected to PrintBit</span></div><div class="grid"><section class="card wide"><div class="card-head"><h3>Connected devices</h3><span id="deviceCount" class="badge">0 devices</span></div><p class="hint">Disconnect removes one device. Clear Other Devices disconnects every client except the device currently using this admin session.</p><div class="device-toolbar"><span class="muted">Admin device is protected during Clear Other Devices.</span><button id="clearOtherDevices" class="btn danger" type="button">Clear Other Devices</button></div><div id="devices" class="device-list"><div class="empty">Loading devices...</div></div></section></div></section><section class="section"><div class="section-title"><h2>Network</h2><span>Access point configuration</span></div><div class="grid"><section class="card"><div class="card-head"><h3>Wi-Fi settings</h3></div><p class="hint">Choose the network name and whether the PrintBit access point requires a password.</p><form id="wifi"><div class="field"><label for="newSsid">SSID</label><input id="newSsid" maxlength="32" required></div><label class="check"><input id="passwordEnabled" type="checkbox"> Enable Wi-Fi password</label><div class="field"><label for="newPassword">Password</label><input id="newPassword" type="password" minlength="8" maxlength="63" placeholder="8-63 characters"></div><div class="notice">Disabling the password creates an open Wi-Fi network. Saving changes restarts the ESP32.</div><div class="actions"><button class="btn" type="submit">Save &amp; Restart</button></div></form></section><section class="card"><div class="card-head"><h3>Admin account</h3></div><p class="hint">Update the username and password used to access this dashboard.</p><form id="credentials"><div class="field"><label for="newUsername">Username</label><input id="newUsername" maxlength="32" autocomplete="username" required></div><div class="field"><label for="newAdminPassword">New password</label><input id="newAdminPassword" type="password" minlength="8" maxlength="63" autocomplete="new-password" required></div><div class="notice">Changing credentials immediately ends the current admin session.</div><div class="actions"><button class="btn" type="submit">Save Account</button></div></form></section></div></section><section class="section"><div class="section-title"><h2>Hopper</h2><span>Manual coin dispensing</span></div><div class="grid"><section class="card wide"><div class="card-head"><h3>Hopper Control</h3><span id="hopperBadge" class="badge">Loading</span></div><p class="hint">Test the coin hopper from the admin page. Normal dispensing counts coins using the hopper sensor. Dispense All runs the motor until you stop it or the safety timeout is reached.</p><div class="hopper-controls"><div class="field"><label for="hopperCoins">Coins to dispense</label><input id="hopperCoins" type="number" min="1" max="50" value="10" inputmode="numeric"></div><div class="hopper-actions"><button id="hopperDispense" class="btn" type="button">Dispense</button><button id="hopperOn" class="btn secondary" type="button">Motor ON</button><button id="hopperAll" class="btn secondary" type="button">Dispense All</button><button id="hopperStop" class="btn danger" type="button" disabled>Stop</button></div></div><div class="rows" style="margin-top:16px"><div class="row"><span class="label">Progress</span><span id="hopperProgress" class="value">0 / 0</span></div><div class="row"><span class="label">Last result</span><span id="hopperResult" class="value">Idle</span></div></div><div class="notice">Safety limit: the hopper motor automatically stops after 30 seconds if the requested count is not reached. Dispense All is intentionally limited by the same timeout.</div></section></div></section><section class="section"><div class="section-title"><h2>System</h2><span>Recovery and maintenance</span></div><div class="grid"><section class="card wide danger-zone"><div class="card-head"><h3>System actions</h3></div><p class="hint">Use these actions only when needed. Restart temporarily disconnects all clients.</p><div class="actions"><button id="resetWifi" class="btn danger" type="button">Reset Wi-Fi</button><button id="restartEsp" class="btn secondary" type="button">Restart ESP32</button></div><div class="notice">Reset Wi-Fi restores <b>PrintBit</b> with no Wi-Fi password. The admin account is not reset.</div></section></div></section></div><div id="toast" class="toast"></div><script>const token=sessionStorage.getItem('printbit_admin_token');if(!token){location='/admin/login';}const auth={'Authorization':'Bearer '+token};const $=id=>document.getElementById(id);const api=async(url,opts={})=>{opts.headers=Object.assign({},auth,opts.headers||{});const r=await fetch(url,opts);if(r.status===401){sessionStorage.removeItem('printbit_admin_token');location='/admin/login';throw Error('Admin authorization expired.');}return r;};const showError=m=>{const x=$('error');x.textContent=m;x.style.display='block';};const clearError=()=>{$('error').style.display='none';};const toast=m=>{const x=$('toast');x.textContent=m;x.style.display='block';clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>x.style.display='none',2400);};const setBadge=(el,text,success)=>{el.textContent=text;el.className='badge'+(success?' success':'');};const renderDevices=list=>{const box=$('devices');const count=list?list.length:0;$('deviceCount').textContent=count+' device'+(count===1?'':'s');if(!list||count===0){box.innerHTML='<div class="empty">No devices are currently connected.</div>';return;}box.innerHTML=list.map(d=>'<div class="device"><div class="device-main"><div class="device-name">'+d.mac+(d.isAdmin?'<span class="device-badge">THIS ADMIN DEVICE</span>':'')+'</div><div class="device-meta">Signal '+d.rssi+' dBm'+(d.ip?' · '+d.ip:'')+'</div></div><div class="device-actions">'+(d.isAdmin?'<span class="muted">Protected</span>':'<button class="btn danger device-disconnect" type="button" data-device-mac="'+d.mac+'">Disconnect</button>')+'</div></div>').join('');};const load=async silent=>{try{if(!silent)clearError();const r=await api('/admin/api/status');const d=await r.json();$('ssid').textContent=d.ssid;$('stations').textContent=d.stations;$('registration').textContent=d.registration;$('heap').textContent=d.freeHeap+' bytes';$('adminUser').textContent=d.adminUsername;$('newSsid').value=d.ssid;$('passwordEnabled').checked=!!d.passwordEnabled;$('newPassword').disabled=!d.passwordEnabled;setBadge($('networkBadge'),d.passwordEnabled?'Password protected':'Open network',true);const registered=!!d.registration&&d.registration.indexOf('Registered')===0;setBadge($('registrationBadge'),registered?'Registered':'Waiting',registered);renderDevices(d.devices);updateHopper(d);}catch(e){if(!silent)showError(e.message);}};const updateHopper=d=>{const running=!!d.dispensing||!!d.manualOn;const all=!!d.dispenseAllMode;setBadge($('hopperBadge'),running?(all?'Dispensing all':'Dispensing'):'Ready',running);$('hopperProgress').textContent=(d.dispensedCoins||0)+' / '+(all?'∞':(d.targetCoins||0));$('hopperResult').textContent=running?(all?'Running until stopped':'Dispensing'):((d.lastOutcome||'idle').replace('_',' '));$('hopperDispense').disabled=running;$('hopperOn').disabled=running;$('hopperAll').disabled=running;$('hopperStop').disabled=!running;};
const hopperAction=async(url,body='')=>{const r=await api(url,{method:'POST',headers:body?{'Content-Type':'application/x-www-form-urlencoded'}:{},body});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw Error(d.error||'Hopper command failed');toast(d.message||'Hopper command accepted');await load(true);};
$('hopperDispense').addEventListener('click',async()=>{const n=Number($('hopperCoins').value);if(!Number.isInteger(n)||n<1||n>50){showError('Enter a coin count from 1 to 50.');return;}if(!confirm('Dispense '+n+' coins?'))return;try{clearError();await hopperAction('/admin/api/hopper/dispense','coins='+encodeURIComponent(String(n)));}catch(e){showError(e.message);}});
$('hopperOn').addEventListener('click',async()=>{if(!confirm('Turn the hopper motor on? It will stop automatically after 30 seconds or when you press Stop.'))return;try{clearError();await hopperAction('/admin/api/hopper/on');}catch(e){showError(e.message);}});
$('hopperAll').addEventListener('click',async()=>{if(!confirm('Start Dispense All? The hopper will run until you press Stop or the 30-second safety timeout is reached.'))return;try{clearError();await hopperAction('/admin/api/hopper/dispense-all');}catch(e){showError(e.message);}});
$('hopperStop').addEventListener('click',async()=>{if(!confirm('Stop the hopper now?'))return;try{clearError();await hopperAction('/admin/api/hopper/stop');}catch(e){showError(e.message);}});
$('clearOtherDevices').addEventListener('click',async()=>{if(!confirm('Disconnect all other devices from the PrintBit AP? This admin device will be kept connected.'))return;const btn=$('clearOtherDevices');btn.disabled=true;btn.innerHTML='<span class="spinner"></span>Clearing';try{clearError();const r=await api('/admin/api/disconnect-all',{method:'POST'});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw Error((d.error||'Clear Other Devices failed')+(d.errorCode?' ['+d.errorCode+']':''));toast(d.message||'Other devices disconnected');setTimeout(()=>load(true),180);}catch(e){showError(e.message);}finally{btn.disabled=false;btn.textContent='Clear Other Devices';}});
$('passwordEnabled').addEventListener('change',()=>{$('newPassword').disabled=!$('passwordEnabled').checked;if(!$('passwordEnabled').checked)$('newPassword').value='';});$('devices').addEventListener('click',async e=>{const btn=e.target.closest('.device-disconnect');if(!btn)return;const mac=btn.dataset.deviceMac;if(!confirm('Disconnect '+mac+' from the PrintBit AP?'))return;btn.disabled=true;btn.innerHTML='<span class="spinner"></span>Disconnecting';try{const r=await api('/admin/api/disconnect',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'mac='+encodeURIComponent(mac)});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw Error((d.error||'Disconnect failed')+(d.errorCode?' ['+d.errorCode+']':''));toast('Device disconnected');setTimeout(()=>load(true),180);}catch(e){showError(e.message);btn.disabled=false;btn.textContent='Disconnect';}});$('wifi').addEventListener('submit',async e=>{e.preventDefault();if(!confirm('Save the new Wi-Fi settings and restart the ESP32?'))return;try{const r=await api('/admin/api/wifi',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'ssid='+encodeURIComponent($('newSsid').value)+'&password='+encodeURIComponent($('newPassword').value)+'&passwordEnabled='+($('passwordEnabled').checked?'1':'0')});toast(await r.text());}catch(e){showError(e.message);}});$('credentials').addEventListener('submit',async e=>{e.preventDefault();if(!confirm('Change the admin username and password? You will be logged out.'))return;try{const r=await api('/admin/api/credentials',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'username='+encodeURIComponent($('newUsername').value)+'&password='+encodeURIComponent($('newAdminPassword').value)});sessionStorage.removeItem('printbit_admin_token');alert(await r.text());location='/admin/login';}catch(e){showError(e.message);}});$('resetWifi').addEventListener('click',async()=>{if(!confirm('Reset Wi-Fi to PrintBit defaults and restart the ESP32?'))return;try{alert(await(await api('/admin/api/reset-wifi',{method:'POST'})).text());}catch(e){showError(e.message);}});$('restartEsp').addEventListener('click',async()=>{if(!confirm('Restart the ESP32 now?'))return;try{alert(await(await api('/admin/api/restart',{method:'POST'})).text());}catch(e){showError(e.message);}});$('logout').addEventListener('click',()=>{sessionStorage.removeItem('printbit_admin_token');location='/admin/login';});load(false);setInterval(()=>load(true),5000);</script></body></html>)HTML";
  replyAdminHtml(client, html);
}

void handleAdminStatus(NetworkClient& client) {
  String registration = hasKioskRegistration ? "Registered" : "Waiting for kiosk registration";
  int dispensedSnapshot = 0;
  noInterrupts();
  dispensedSnapshot = coinDispensed;
  interrupts();

  String json =
    "{\"ssid\":\"" + htmlEscape(apSsid) +
    "\",\"passwordEnabled\":" + String(apPasswordEnabled ? "true" : "false") +
    ",\"stations\":" + String(WiFi.softAPgetStationNum()) +
    ",\"registration\":\"" + registration +
    "\",\"freeHeap\":" + String(ESP.getFreeHeap()) +
    ",\"adminUsername\":\"" + htmlEscape(adminUsername) +
    "\",\"devices\":" + buildConnectedDevicesJson(client.remoteIP()) +
    ",\"dispensing\":" + String((dispensing || hopperManualOn) ? "true" : "false") +
    ",\"manualOn\":" + String(hopperManualOn ? "true" : "false") +
    ",\"dispenseAllMode\":" + String(dispenseAllMode ? "true" : "false") +
    ",\"targetCoins\":" + String(targetCoins) +
    ",\"dispensedCoins\":" + String(dispensedSnapshot) +
    ",\"lastOutcome\":\"" + lastDispenseOutcome +
    "\",\"lastError\":\"" + lastDispenseError + "\"}";
  replyAdminJson(client, json);
}

void handleAdminWifiSave(NetworkClient& client, const String& body) {
  String newSsid = getFormValue(body, "ssid");
  String newPassword = getFormValue(body, "password");
  String passwordEnabledValue = getFormValue(body, "passwordEnabled");
  newSsid.trim();
  newPassword.trim();
  passwordEnabledValue.trim();
  bool newPasswordEnabled = passwordEnabledValue == "1";

  if (newSsid.length() == 0 || newSsid.length() > 32) {
    Serial.println("wifi_settings_failed:invalid_ssid:length_out_of_range");
    replyPlain(client, 400, "Bad Request", "SSID must be 1-32 characters");
    return;
  }
  if (newPasswordEnabled && (newPassword.length() < 8 || newPassword.length() > 63)) {
    Serial.println("wifi_settings_failed:invalid_password:length_out_of_range");
    replyPlain(client, 400, "Bad Request", "Password must be 8-63 characters when Wi-Fi password is enabled");
    return;
  }
  if (!newPasswordEnabled) newPassword = "";
  if (!saveApCredentials(newSsid, newPassword, newPasswordEnabled)) {
    Serial.println("wifi_settings_failed:storage_write_failed");
    replyPlain(client, 500, "Internal Server Error", "Failed to save AP settings");
    return;
  }

  Serial.print("wifi_settings_saved:ssid="); Serial.println(newSsid);
  replyPlain(client, 200, "OK", "AP settings saved. Restarting with the new SSID and password...");
  delay(500);
  ESP.restart();
}

void handleAdminCredentials(NetworkClient& client, const String& body) {
  String newUsername = getFormValue(body, "username");
  String newPassword = getFormValue(body, "password");
  newUsername.trim();
  newPassword.trim();

  if (newUsername.length() == 0 || newUsername.length() > 32) {
    Serial.println("admin_credentials_failed:invalid_username:length_out_of_range");
    replyPlain(client, 400, "Bad Request", "Username must be 1-32 characters");
    return;
  }
  if (newPassword.length() < 8 || newPassword.length() > 63) {
    Serial.println("admin_credentials_failed:invalid_password:length_out_of_range");
    replyPlain(client, 400, "Bad Request", "Password must be 8-63 characters");
    return;
  }
  if (!saveAdminCredentials(newUsername, newPassword)) {
    Serial.println("admin_credentials_failed:storage_write_failed");
    replyPlain(client, 500, "Internal Server Error", "Failed to save admin credentials");
    return;
  }

  adminSessionToken = makeAdminSessionToken();
  Serial.print("admin_credentials_saved:username=");
  Serial.println(newUsername);
  replyPlain(client, 200, "OK", "Admin credentials saved. Current session invalidated.");
}

void handleAdminDisconnectDevice(NetworkClient& client, const String& body) {
  String mac = getFormValue(body, "mac");
  mac.trim();
  if (mac.length() != 17) {
    Serial.println("admin_device_disconnect:failed:invalid_mac");
    replyAdminJson(client, "{\"ok\":false,\"errorCode\":\"INVALID_MAC\",\"error\":\"Invalid device MAC address\"}", 400, "Bad Request");
    return;
  }

  if (!disconnectStationByMac(mac)) {
    String code = disconnectErrorCode.length() > 0 ? disconnectErrorCode : "DISCONNECT_FAILED";
    String message = code == "NOT_CONNECTED" ? "Device is no longer connected" : "ESP32 could not disconnect the device";
    int status = code == "NOT_CONNECTED" ? 404 : 500;
    String json = "{\"ok\":false,\"errorCode\":\"" + code + "\",\"error\":\"" + message + "\"}";
    replyAdminJson(client, json, status, status == 404 ? "Not Found" : "Internal Server Error");
    return;
  }

  replyAdminJson(client, "{\"ok\":true,\"errorCode\":null,\"message\":\"Device disconnected\"}");
}

void handleAdminDisconnectAllDevices(NetworkClient& client) {
  int disconnectedCount = 0;
  bool adminExcluded = false;

  if (!disconnectAllStationsExcept(client.remoteIP(), disconnectedCount, adminExcluded)) {
    String code = disconnectErrorCode.length() > 0 ? disconnectErrorCode : "CLEAR_ALL_FAILED";
    replyAdminJson(
      client,
      "{\"ok\":false,\"errorCode\":\"" + code +
      "\",\"error\":\"Clear All was not performed because the admin device could not be safely identified.\"}",
      409,
      "Conflict"
    );
    return;
  }

  String json =
    "{\"ok\":true,\"adminExcluded\":" + String(adminExcluded ? "true" : "false") +
    ",\"disconnected\":" + String(disconnectedCount) +
    ",\"message\":\"Disconnected " + String(disconnectedCount) +
    " device" + String(disconnectedCount == 1 ? "" : "s") + ". The admin device was kept connected.\"}";
  replyAdminJson(client, json);
}

void handleAdminHopperDispense(NetworkClient& client, const String& body) {
  String postedCoins = getFormValue(body, "coins");
  postedCoins.trim();
  if (!isNumericString(postedCoins)) {
    replyAdminJson(client, "{\"ok\":false,\"error\":\"Enter a valid coin count\"}", 400, "Bad Request");
    return;
  }
  int coins = postedCoins.toInt();
  if (coins <= 0 || coins > maxDispenseCoins) {
    String json = "{\"ok\":false,\"error\":\"Coin count must be 1-" + String(maxDispenseCoins) + "\"}";
    replyAdminJson(client, json, 400, "Bad Request");
    return;
  }
  if (!startDispense(coins, buildHopperRequestId(), "admin")) {
    replyAdminJson(client, "{\"ok\":false,\"error\":\"Hopper is busy or the request is invalid\"}", 409, "Conflict");
    return;
  }
  replyAdminJson(client, "{\"ok\":true,\"message\":\"Dispensing started\"}");
}

void handleAdminHopperDispenseAll(NetworkClient& client) {
  if (dispensing) {
    replyAdminJson(client, "{\"ok\":false,\"error\":\"Hopper is already running\"}", 409, "Conflict");
    return;
  }
  targetCoins = 0;
  noInterrupts();
  coinDispensed = 0;
  dispenseProgressDirty = false;
  interrupts();
  dispensing = true;
  hopperManualOn = false;
  dispenseAllMode = true;
  dispenseDone = false;
  dispenseTimedOut = false;
  hopperStartTime = millis();
  lastProgressReported = -1;
  activeDispenseRequestId = buildHopperRequestId();
  lastDispenseRequestId = activeDispenseRequestId;
  lastDispenseOutcome = "dispensing_all";
  lastDispenseError = "";
  digitalWrite(relayPin, HIGH);
  emitHopperAck(activeDispenseRequestId);
  Serial.print("hopper_start_all:requestId=");
  Serial.println(activeDispenseRequestId);
  replyAdminJson(client, "{\"ok\":true,\"message\":\"Dispense-all started\"}");
}

void handleAdminHopperOn(NetworkClient& client) {
  if (dispensing || hopperManualOn) {
    replyAdminJson(client, "{\"ok\":false,\"error\":\"Hopper is already running\"}", 409, "Conflict");
    return;
  }
  noInterrupts();
  coinDispensed = 0;
  dispenseProgressDirty = false;
  interrupts();
  targetCoins = 0;
  dispenseAllMode = false;
  dispensing = false;
  dispenseDone = false;
  dispenseTimedOut = false;
  hopperManualOn = true;
  hopperStartTime = millis();
  lastDispenseRequestId = buildHopperRequestId();
  lastDispenseOutcome = "manual_on";
  lastDispenseError = "";
  digitalWrite(relayPin, HIGH);
  Serial.print("hopper_manual_on:requestId=");
  Serial.println(lastDispenseRequestId);
  replyAdminJson(client, "{\"ok\":true,\"message\":\"Hopper motor turned on\"}");
}

void handleAdminHopperStop(NetworkClient& client) {
  bool wasRunning = dispensing || hopperManualOn;
  digitalWrite(relayPin, LOW);
  if (dispensing || hopperManualOn) {
    dispensing = false;
    dispenseAllMode = false;
    dispenseDone = false;
    dispenseTimedOut = false;
    lastDispenseOutcome = "stopped";
    lastDispenseError = "MANUAL_STOP";
    lastDispenseFinishedAt = millis();
    Serial.print("hopper_stop:requestId=");
    Serial.println(lastDispenseRequestId);
    activeDispenseRequestId = "";
  }
  hopperManualOn = false;
  replyAdminJson(client, wasRunning
    ? "{\"ok\":true,\"message\":\"Hopper stopped\"}"
    : "{\"ok\":true,\"message\":\"Hopper is already off\"}");
}

void handleAdminResetWifi(NetworkClient& client) {
  resetApCredentials();
  Serial.println("admin_wifi_reset:credentials_cleared:restoring_defaults");
  replyPlain(client, 200, "OK", "Wi-Fi credentials reset to defaults. Restarting...");
  delay(500);
  ESP.restart();
}

void handleAdminRestart(NetworkClient& client) {
  Serial.println("admin_restart:requested_from_dashboard");
  replyPlain(client, 200, "OK", "Restarting ESP32...");
  delay(500);
  ESP.restart();
}

void checkPhysicalCredentialRecovery() {
  pinMode(bootButtonPin, INPUT_PULLUP);
  unsigned long start = millis();
  Serial.println("credential_recovery_window:15s:press_boot_to_reset_wifi");

  while (millis() - start < credentialRecoveryWindowMs) {
    if (digitalRead(bootButtonPin) == LOW) {
      delay(60);
      if (digitalRead(bootButtonPin) == LOW) {
        resetApCredentials();
        Serial.println("credential_recovery:boot_pressed:reset_to_defaults");
        Serial.println("credential_recovery:release_boot_to_continue");
        while (digitalRead(bootButtonPin) == LOW) delay(10);
        delay(200);
        ESP.restart();
      }
    }
    delay(10);
  }
  Serial.println("credential_recovery_window:expired:normal_boot");
}

void loadApCredentials() {
  preferences.begin("printbit", true);
  apSsid = preferences.getString("ssid", defaultApSsid);
  apPassword = preferences.getString("password", defaultApPassword);
  apPasswordEnabled = preferences.getBool("passwordEnabled", false);
  preferences.end();

  if (apSsid.length() == 0 || apSsid.length() > 32) apSsid = defaultApSsid;
  if (apPasswordEnabled && (apPassword.length() < 8 || apPassword.length() > 63)) {
    apPasswordEnabled = false;
    apPassword = "";
  }
  if (!apPasswordEnabled) apPassword = "";
}

bool saveApCredentials(const String& newSsid, const String& newPassword, bool passwordEnabled) {
  if (newSsid.length() == 0 || newSsid.length() > 32) return false;
  if (passwordEnabled && (newPassword.length() < 8 || newPassword.length() > 63)) return false;

  preferences.begin("printbit", false);
  bool ok = preferences.putString("ssid", newSsid) > 0;
  ok = preferences.putString("password", passwordEnabled ? newPassword : "") > 0 && ok;
  ok = preferences.putBool("passwordEnabled", passwordEnabled) && ok;
  preferences.end();

  if (ok) {
    apSsid = newSsid;
    apPassword = passwordEnabled ? newPassword : "";
    apPasswordEnabled = passwordEnabled;
  }
  return ok;
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
  if (WiFi.softAPgetStationNum() == 0) {
    logCoinSendFailure("network_unreachable_no_station", 0, "");
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

    if (code == 200) {
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
    parsedPort = fallbackKioskPort;
  }

  kioskIp = postedIp;
  kioskPort = uint16_t(parsedPort);
  kioskPortalPath = normalizedPath(postedPath);
  hasKioskRegistration = true;
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
  String authorizationHeader = "";
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
      authorizationHeader = headerLine.substring(colonPos + 1);
      authorizationHeader.trim();
    }
  }

  String body = "";
  if (contentLength > 0 && contentLength <= 512) {
    body = readRequestBody(client, contentLength);
  } else if (contentLength > 512) {
    Serial.print("http_request_error:content_length_too_large:");
    Serial.println(contentLength);
  }

  if (routePath == "/admin/login") {
    if (method == "GET") { replyAdminLoginPage(client); client.stop(); return; }
    if (method == "POST") {
      if (contentLength <= 0 || contentLength > 256) { Serial.println("admin_login_failed:invalid_payload_size"); replyPlain(client,413,"Payload Too Large","Invalid login payload size"); client.stop(); return; }
      handleAdminLogin(client, body); client.stop(); return;
    }
  }

  if (routePath == "/admin") {
    if (method == "GET") { replyAdminDashboardPage(client); client.stop(); return; }
  }

  if (routePath.startsWith("/admin/api/")) {
    if (!hasAdminAuthorization(authorizationHeader)) {
      Serial.print("admin_auth_failed:path="); Serial.print(routePath); Serial.print(":reason=");
      Serial.println(authorizationHeader.length() == 0 ? "missing_authorization_header" : "invalid_bearer_token");
      replyAdminUnauthorized(client); client.stop(); return;
    }
    if (method == "GET" && routePath == "/admin/api/status") { handleAdminStatus(client); client.stop(); return; }
    if (method == "GET" && routePath == "/admin/api/hopper/status") { handleAdminStatus(client); client.stop(); return; }
    if (method == "POST" && routePath == "/admin/api/wifi") {
      if (contentLength <= 0 || contentLength > 256) { Serial.println("wifi_settings_failed:invalid_payload_size"); replyPlain(client,413,"Payload Too Large","Invalid Wi-Fi payload size"); client.stop(); return; }
      handleAdminWifiSave(client, body); client.stop(); return;
    }
    if (method == "POST" && routePath == "/admin/api/hopper/dispense") {
      if (contentLength <= 0 || contentLength > 64) { replyAdminJson(client, "{\"ok\":false,\"error\":\"Invalid hopper payload size\"}", 413, "Payload Too Large"); client.stop(); return; }
      handleAdminHopperDispense(client, body); client.stop(); return;
    }
    if (method == "POST" && routePath == "/admin/api/hopper/dispense-all") { handleAdminHopperDispenseAll(client); client.stop(); return; }
    if (method == "POST" && routePath == "/admin/api/hopper/on") { handleAdminHopperOn(client); client.stop(); return; }
    if (method == "POST" && routePath == "/admin/api/hopper/stop") { handleAdminHopperStop(client); client.stop(); return; }
    if (method == "POST" && routePath == "/admin/api/reset-wifi") { handleAdminResetWifi(client); client.stop(); return; }
    if (method == "POST" && routePath == "/admin/api/restart") { handleAdminRestart(client); client.stop(); return; }
    if (method == "POST" && routePath == "/admin/api/credentials") {
      if (contentLength <= 0 || contentLength > 160) { Serial.println("admin_credentials_failed:invalid_payload_size"); replyPlain(client,413,"Payload Too Large","Invalid admin credentials payload size"); client.stop(); return; }
      handleAdminCredentials(client, body); client.stop(); return;
    }
    if (method == "POST" && routePath == "/admin/api/disconnect") {
      if (contentLength <= 0 || contentLength > 64) { Serial.println("admin_device_disconnect:failed:invalid_payload_size"); replyPlain(client,413,"Payload Too Large","Invalid disconnect payload size"); client.stop(); return; }
      handleAdminDisconnectDevice(client, body); client.stop(); return;
    }
    if (method == "POST" && routePath == "/admin/api/disconnect-all") {
      handleAdminDisconnectAllDevices(client); client.stop(); return;
    }
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

  if (method == "GET" && isCaptiveProbePath(routePath)) {
    if (hasKioskRegistration && kioskPortalUrl.length() > 0) {
      replyRedirect(client, kioskPortalUrl);
    } else {
      replyRedirect(client, "http://192.168.4.1/admin/login");
    }
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
    response += (dispensing || hopperManualOn) ? "true" : "false";

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
    response += (lastDispenseOutcome == "failed" && lastDispenseError == "MOTOR_TIMEOUT")
                  ? "true"
                  : "false";

    response += ",\"success\":";
    response += (!dispensing && lastDispenseOutcome == "done" && dispensedSnapshot >= targetCoins)
                  ? "true"
                  : "false";

    response += ",\"lastFinishedAtMs\":";
    response += String(lastDispenseFinishedAt);

    response += ",\"manualOn\":";
    response += hopperManualOn ? "true" : "false";
    response += ",\"dispenseAllMode\":";
    response += dispenseAllMode ? "true" : "false";

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

    if (dispensing && targetCoins > 0 && coinDispensed >= targetCoins) {
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
  dispenseAllMode = false;
  hopperManualOn = false;
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

  checkPhysicalCredentialRecovery();

  attachInterrupt(coinAcceptorPin, countPulse, FALLING);
  attachInterrupt(hopperSensorPin, coinDetected, FALLING);

  refreshTargets();

  WiFi.onEvent([](WiFiEvent_t event) {
    if (event == ARDUINO_EVENT_WIFI_AP_STACONNECTED) {
      Serial.println("wifi_ap_event:station_connected");
    } else if (event == ARDUINO_EVENT_WIFI_AP_STADISCONNECTED) {
      Serial.println("wifi_ap_event:station_disconnected");
    }
  });

  loadApCredentials();
  loadAdminCredentials();
  WiFi.mode(WIFI_AP);

  if (!WiFi.softAP(apSsid.c_str(), apPasswordEnabled ? apPassword.c_str() : nullptr, 1, 0)) {
    Serial.println("wifi_ap_error:softAP_start_failed");
  }

  Serial.println("AP Started");
  Serial.print("AP_SSID:");
  Serial.println(apSsid);
  Serial.print("AP_PASSWORD:");
  Serial.println(apPasswordEnabled ? "enabled" : "disabled");
  Serial.print("AP_IP:");
  Serial.println(WiFi.softAPIP());
  Serial.print("coin_target:");
  Serial.println(tabletServer);
  Serial.print("portal_target:");
  Serial.println(kioskPortalUrl);

  adminSessionToken = makeAdminSessionToken();
  server.begin();

  Serial.println("ADMIN:http://192.168.4.1/admin");
  Serial.print("ADMIN_USERNAME:");
  Serial.println(adminUsername);
  Serial.println("ADMIN_AUTH:Authorization Bearer session header");

  minFreeHeapSeen = ESP.getFreeHeap();
  Serial.println("k kDY");
}

// LOOP
void loop() {
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
  if ((dispensing || hopperManualOn) && millis() - hopperStartTime > hopperMaxRunTime) {
    digitalWrite(relayPin, LOW);
    dispensing = false;
    dispenseAllMode = false;
    hopperManualOn = false;
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
    dispenseAllMode = false;
    hopperManualOn = false;
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
    Serial.println("kiosk_register_pending:waiting_for_post");
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
