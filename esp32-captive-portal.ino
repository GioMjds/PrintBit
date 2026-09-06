#include <WiFiManager.h>
#include <NetworkClient.h>
#include <WiFiAP.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ESPmDNS.h>
#include <DNSServer.h>

#define coinAcceptorPin 4
#define hopperSensorPin 19
#define relayPin 32

const byte DNS_PORT = 53;
IPAddress printBitApIp(192, 168, 4, 1);
IPAddress printBitSubnet(255, 255, 255, 0);

const char* fallbackKioskIp = "192.168.4.2";
const uint16_t fallbackKioskPort = 3000;
const char* fallbackKioskPortalPath = "/portal";
const char* kioskRegisterToken = "printbit-register-token";
const char* nodeHealthToken = "printbit-health-token";
const char* coinBridgeSource = "esp32";
const char* coinBridgeApiKey = "printbit-coin-bridge-key";
const char* hopperControlToken = "printbit-coin-bridge-key";

Preferences preferences;
const char* PREFS_NAMESPACE = "printbit-cfg";
WiFiManager wifiManager;
WiFiManagerParameter permanentApPassword(
  "printbit_ap_password",
  "Permanent PrintBit AP password (8-63 characters)",
  "",
  64,
  "type='password' minlength='8' maxlength='63' required"
);

DNSServer dnsServer;
NetworkServer server(80);

String apSsid = "PrintBit";
String apPass = "";
String staSsid = "";
String staPass = "";
bool provisioningComplete = false;

String kioskIp = fallbackKioskIp;
uint16_t kioskPort = fallbackKioskPort;
String kioskPortalPath = fallbackKioskPortalPath;
String kioskPortalUrl = "";
String tabletServer = "";
bool hasKioskRegistration = false;

// Node liveness lease. Coins remain disabled until Node proves it is alive.
volatile bool coinAcceptorEnabled = false;
unsigned long lastNodeHealthSuccess = 0;
unsigned long lastNodeHealthCheck = 0;
const unsigned long nodeHealthInterval = 2000;
const unsigned long nodeHealthLease = 6000;

// COIN ACCEPTOR
volatile byte pulseCount = 0;
volatile unsigned long lastPulseMicros = 0;
volatile unsigned long lastPulseMillis = 0;

const unsigned long debounceMicros = 3000;
const unsigned long coinTimeout = 200;
const int maxCoinSendAttempts = 3;
const int maxDispenseCoins = 50;

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

bool startDispense(
    int coins,
    const String& requestId,
    const String& sourceLabel
);

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
  kioskPortalUrl =
    "http://" + kioskIp + ":" + String(kioskPort) + kioskPortalPath;
  tabletServer = "http://" + kioskIp + ":" + String(kioskPort) + "/coin";
}

void loadNvsConfig() {
  preferences.begin(PREFS_NAMESPACE, true);
  apSsid = preferences.getString("ap_ssid", "PrintBit");
  apPass = preferences.getString("ap_pass", "");
  String savedIp = preferences.getString("kiosk_ip", fallbackKioskIp);
  uint32_t savedPort = preferences.getUInt("kiosk_port", fallbackKioskPort);
  String savedPath = preferences.getString("kiosk_path", fallbackKioskPortalPath);
  preferences.end();

  if (apSsid.length() == 0) apSsid = "PrintBit";
  provisioningComplete = apPass.length() >= 8 && apPass.length() <= 63;

  if (isValidIpv4Address(savedIp)) {
    kioskIp = savedIp;
  } else {
    kioskIp = fallbackKioskIp;
  }

  if (savedPort > 0 && savedPort <= 65535) {
    kioskPort = uint16_t(savedPort);
  } else {
    kioskPort = fallbackKioskPort;
  }

  kioskPortalPath = normalizedPath(savedPath);
  hasKioskRegistration = true;
  refreshTargets();
}

void savePermanentApPassword(const String& newApPass) {
  if (newApPass.length() < 8 || newApPass.length() > 63) return;
  preferences.begin(PREFS_NAMESPACE, false);
  preferences.putString("ap_ssid", "PrintBit");
  preferences.putString("ap_pass", newApPass);
  preferences.end();
}

void saveWifiConfigToNvs(const String&, const String&, const String& newApPass = "") {
  savePermanentApPassword(newApPass);
}

void saveProvisioningParameters() {
  String candidate = permanentApPassword.getValue();
  candidate.trim();
  if (candidate.length() < 8 || candidate.length() > 63) {
    Serial.println("PROVISIONING_REJECTED:AP_PASSWORD_MUST_BE_8_TO_63_CHARACTERS");
    return;
  }
  savePermanentApPassword(candidate);
  apPass = candidate;
  provisioningComplete = true;
  Serial.println("PROVISIONING_SAVED");
}

void runInitialProvisioning() {
  wifiManager.setAPStaticIPConfig(printBitApIp, printBitApIp, printBitSubnet);
  wifiManager.setBreakAfterConfig(true);
  wifiManager.setSaveConnect(false);
  wifiManager.setSaveParamsCallback(saveProvisioningParameters);
  wifiManager.addParameter(&permanentApPassword);
  const char* menu[] = { "wifi", "info", "restart", "exit" };
  wifiManager.setMenu(menu, 4);

  while (!provisioningComplete) {
    Serial.println("PROVISIONING_REQUIRED:CONNECT_TO_OPEN_AP:PrintBit-Setup");
    wifiManager.startConfigPortal("PrintBit-Setup");
    if (!provisioningComplete) {
      Serial.println("PROVISIONING_INCOMPLETE:AP_PASSWORD_REQUIRED");
      delay(500);
    }
  }

  Serial.println("PROVISIONING_COMPLETE:RESTARTING");
  delay(500);
  ESP.restart();
}

void factoryResetWifi() {
  digitalWrite(relayPin, LOW);
  wifiManager.resetSettings();
  preferences.begin(PREFS_NAMESPACE, false);
  preferences.clear();
  preferences.end();
  Serial.println("WIFI_FACTORY_RESET:RESTARTING_IN_SETUP_MODE");
  delay(500);
  ESP.restart();
}

void saveKioskConfigToNvs(const String& newIp, uint16_t newPort, const String& newPath) {
  preferences.begin(PREFS_NAMESPACE, false);
  preferences.putString("kiosk_ip", newIp);
  preferences.putUInt("kiosk_port", (uint32_t)newPort);
  preferences.putString("kiosk_path", newPath);
  preferences.end();
}

bool updateKioskRegistration(const String& newIp, uint16_t newPort, const String& newPath) {
  if (!isValidIpv4Address(newIp)) return false;
  uint16_t port = (newPort > 0 && newPort <= 65535) ? newPort : fallbackKioskPort;
  String path = normalizedPath(newPath);

  bool changed = (kioskIp != newIp || kioskPort != port || kioskPortalPath != path);
  kioskIp = newIp;
  kioskPort = port;
  kioskPortalPath = path;
  hasKioskRegistration = true;
  refreshTargets();

  if (changed) {
    saveKioskConfigToNvs(kioskIp, kioskPort, kioskPortalPath);
    Serial.println("kiosk_config_saved_to_nvs");
  }

  Serial.print("kiosk_registered:coin_target=");
  Serial.println(tabletServer);
  Serial.print("kiosk_registered:portal_target=");
  Serial.println(kioskPortalUrl);
  return true;
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

void replyHtml(
  NetworkClient& client,
  int statusCode,
  const String& statusText,
  const String& html) {
  client.print("HTTP/1.1 ");
  client.print(statusCode);
  client.print(" ");
  client.println(statusText);
  client.println("Content-Type: text/html; charset=utf-8");
  client.print("Content-Length: ");
  client.println(html.length());
  client.println("Connection: close");
  client.println();
  client.print(html);
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
  return body;
}

bool isCaptiveProbePath(const String& path) {
  return path == "/hotspot-detect.html" ||
         path == "/generate_204" ||
         path == "/gen_204" ||
         path == "/ncsi.txt" ||
         path == "/connecttest.txt" ||
         path == "/canonical.html" ||
         path == "/success.txt";
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
  if (!coinAcceptorEnabled) {
    logCoinSendFailure("node_health_unavailable", 0, "");
    return;
  }
  if (!provisioningComplete) {
    logCoinSendFailure("provisioning_required", 0, "");
    return;
  }
  if (WiFi.softAPgetStationNum() == 0 && WiFi.status() != WL_CONNECTED) {
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
    if (code == 409) {
      logCoinSendFailure("coin_rejected_409", code, body);
      return;
    }
    if (code == 400) {
      logCoinSendFailure("validation_failed", code, body);
      return;
    }
    if (code == 401 || code == 403) {
      logCoinSendFailure("auth_failed", code, body);
      return;
    }
    if (code > 0 && code < 500) {
      logCoinSendFailure("request_rejected", code, body);
      return;
    }

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

bool jsonBooleanIsTrue(const String& body, const String& key) {
  String needle = "\"" + key + "\":";
  int start = body.indexOf(needle);
  if (start < 0) return false;
  start += needle.length();
  while (start < (int)body.length() && body.charAt(start) == ' ') start++;
  return body.substring(start, start + 4) == "true";
}

void disableCoinAcceptor(const char* reason) {
  if (coinAcceptorEnabled) {
    Serial.print("coin_acceptor_disabled:");
    Serial.println(reason);
  }
  coinAcceptorEnabled = false;
  noInterrupts();
  pulseCount = 0;
  lastPulseMillis = 0;
  interrupts();
}

void enableCoinAcceptor() {
  if (!coinAcceptorEnabled) Serial.println("coin_acceptor_enabled:node_health_ok");
  coinAcceptorEnabled = true;
}

void checkNodeHealth() {
  unsigned long now = millis();
  if (now - lastNodeHealthCheck < nodeHealthInterval) {
    if (now - lastNodeHealthSuccess > nodeHealthLease) {
      disableCoinAcceptor("health_lease_expired");
    }
    return;
  }
  lastNodeHealthCheck = now;

  if (WiFi.status() != WL_CONNECTED || kioskIp.length() == 0) {
    disableCoinAcceptor("network_unavailable");
    return;
  }

  HTTPClient http;
  String healthUrl = "http://" + kioskIp + ":" + String(kioskPort) + "/api/health";
  http.setTimeout(1200);
  http.begin(healthUrl);
  if (String(nodeHealthToken).length() > 0) {
    http.addHeader("x-esp32-health-token", nodeHealthToken);
  }
  int code = http.GET();
  String body = code > 0 ? http.getString() : "";
  http.end();

  bool healthy = code == 200 && jsonBooleanIsTrue(body, "ok") &&
                 jsonBooleanIsTrue(body, "coinAccepting");
  if (healthy) {
    lastNodeHealthSuccess = now;
    enableCoinAcceptor();
  } else {
    disableCoinAcceptor(code > 0 ? "health_check_failed" : "health_unreachable");
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

  updateKioskRegistration(postedIp, uint16_t(parsedPort), postedPath);
  replyPlain(client, 200, "OK", "registered");
}

void handleSetupPage(NetworkClient& client) {
  int n = WiFi.scanNetworks(false, false);
  String scanOptions = "";
  if (n <= 0) {
    scanOptions = "<option value=\"\">No networks found</option>";
  } else {
    for (int i = 0; i < n; ++i) {
      String ssidName = WiFi.SSID(i);
      int rssi = WiFi.RSSI(i);
      String encType = (WiFi.encryptionType(i) == WIFI_AUTH_OPEN) ? "Open" : "Secured";
      scanOptions += "<option value=\"" + ssidName + "\">" + ssidName + " (" + String(rssi) + " dBm, " + encType + ")</option>";
    }
  }
  WiFi.scanDelete();

  String currentStaStatusStr = (WiFi.status() == WL_CONNECTED)
    ? ("Connected (" + WiFi.localIP().toString() + ")")
    : "Disconnected";

  String html = "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>PrintBit Setup Portal</title>";
  html += "<style>";
  html += "body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;margin:0;padding:20px;background:#f3f4f6;color:#1f2937}";
  html += ".card{max-width:480px;margin:0 auto;background:#fff;padding:24px;border-radius:12px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1)}";
  html += "h1{font-size:1.25rem;font-weight:700;margin-top:0;margin-bottom:16px;color:#111827;display:flex;align-items:center;gap:8px}";
  html += ".badge{font-size:0.75rem;padding:2px 8px;border-radius:9999px;background:#e0e7ff;color:#3730a3}";
  html += ".info{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-size:0.875rem;margin-bottom:20px}";
  html += ".info p{margin:4px 0}";
  html += "label{display:block;font-size:0.875rem;font-weight:600;margin-bottom:4px;color:#374151}";
  html += "select,input[type=text],input[type=password]{width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:0.95rem;box-sizing:border-box;margin-bottom:14px}";
  html += "button{width:100%;padding:12px;background:#2563eb;color:#fff;border:none;border-radius:6px;font-size:1rem;font-weight:600;cursor:pointer}";
  html += "button:hover{background:#1d4ed8}";
  html += ".sec{border-top:1px solid #e5e7eb;padding-top:16px;margin-top:16px}";
  html += "</style></head><body>";
  html += "<div class='card'>";
  html += "<h1>PrintBit Setup <span class='badge'>Firmware</span></h1>";
  html += "<div class='info'>";
  html += "<p><strong>AP IP:</strong> " + WiFi.softAPIP().toString() + " (" + apSsid + ")</p>";
  html += "<p><strong>STA Status:</strong> " + currentStaStatusStr + "</p>";
  html += "<p><strong>Kiosk Server:</strong> http://" + kioskIp + ":" + String(kioskPort) + "</p>";
  html += "</div>";
  html += "<form method='POST' action='/setup/save'>";
  html += "<label for='sta_sel'>Select Wi-Fi Network</label>";
  html += "<select id='sta_sel' onchange=\"if(this.value)document.getElementById('sta_custom').value=this.value\">";
  html += "<option value=''>-- Select Scanned Network --</option>" + scanOptions;
  html += "</select>";
  html += "<label for='sta_custom'>Wi-Fi SSID (or Manual)</label>";
  html += "<input type='text' id='sta_custom' name='sta_ssid' placeholder='SSID name' value='" + staSsid + "'>";
  html += "<label for='sta_pass'>Wi-Fi Password</label>";
  html += "<input type='password' id='sta_pass' name='sta_pass' placeholder='Router password' value='" + staPass + "'>";
  html += "<div class='sec'>";
  html += "<label for='ap_pass'>Hotspot AP Password (Optional, min 8 chars)</label>";
  html += "<input type='password' id='ap_pass' name='ap_pass' placeholder='Keep current password'>";
  html += "</div>";
  html += "<button type='submit'>Save & Connect</button>";
  html += "</form>";
  html += "</div></body></html>";

  replyHtml(client, 200, "OK", html);
}

void handleSetupSave(NetworkClient& client, const String& body) {
  String postedStaSsid = getFormValue(body, "sta_ssid");
  String postedStaPass = getFormValue(body, "sta_pass");
  String postedApPass = getFormValue(body, "ap_pass");
  postedStaSsid.trim();
  postedStaPass.trim();
  postedApPass.trim();

  bool staUpdated = false;
  if (postedStaSsid.length() > 0) {
    staSsid = postedStaSsid;
    staPass = postedStaPass;
    staUpdated = true;
  }

  bool apUpdated = false;
  if (postedApPass.length() >= 8) {
    apPass = postedApPass;
    apUpdated = true;
  }

  saveWifiConfigToNvs(staSsid, staPass, apUpdated ? apPass : "");

  if (staUpdated) {
    WiFi.disconnect();
    Serial.print("Connecting to Wi-Fi: ");
    Serial.println(staSsid);
    Serial.println("WIFI_STA_CONNECTING");
    WiFi.begin(staSsid.c_str(), staPass.c_str());
  }

  if (apUpdated) {
    WiFi.softAP(apSsid.c_str(), apPass.c_str(), 1, 0);
  }

  String responseHtml = "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><meta http-equiv='refresh' content='4;url=/setup'><title>Saved</title>";
  responseHtml += "<style>body{font-family:sans-serif;padding:24px;text-align:center;background:#f3f4f6;color:#111827}.card{max-width:400px;margin:40px auto;background:#fff;padding:24px;border-radius:12px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1)}a{display:inline-block;margin-top:12px;color:#2563eb;text-decoration:none;font-weight:600}</style></head><body>";
  responseHtml += "<div class='card'><h2>Credentials Saved!</h2><p>Connecting to external Wi-Fi in background...</p><a href='/setup'>Return to Setup</a></div></body></html>";

  replyHtml(client, 200, "OK", responseHtml);
}

void handleWifiRequest(NetworkClient& client) {
  client.setTimeout(250);
  String requestLine = client.readStringUntil('\r');
  client.readStringUntil('\n');
  if (requestLine.length() == 0) {
    client.stop();
    return;
  }

  String method = "";
  String path = "";
  if (!parseRequestLine(requestLine, method, path)) {
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
    }
  }

  String body = "";
  if (contentLength > 0 && contentLength <= 1024) {
    body = readRequestBody(client, contentLength);
  }

  if (method == "POST" && routePath.startsWith("/kiosk/register")) {
    if (contentLength <= 0 || contentLength > 1024) {
      replyPlain(client, 413, "Payload Too Large", "Invalid payload size");
      client.stop();
      return;
    }
    handleRegisterRequest(client, body);
    client.stop();
    return;
  }

  // Admin dashboard redirection
  if (routePath.startsWith("/admin")) {
    String adminTarget = "http://" + kioskIp + ":" + String(kioskPort) + routePath;
    if (query.length() > 0) {
      adminTarget += "?" + query;
    }
    replyRedirect(client, adminTarget);
    client.stop();
    return;
  }

  // Captive probe and portal redirection
  if (method == "GET" && (isCaptiveProbePath(routePath) || routePath == "/portal")) {
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
      Serial.print("hopper_token_debug: got='");
      Serial.print(postedToken);
      Serial.print("' (len=");
      Serial.print(postedToken.length());
      Serial.print(") expected='");
      Serial.print(hopperControlToken);
      Serial.println("'");
      replyPlain(client, 401, "Unauthorized", "Invalid hopper token");
      Serial.println("hopper_dispense_rejected:unauthorized");
      client.stop();
      return;
    }
    if (!isNumericString(postedCoins)) {
      replyPlain(client, 400, "Bad Request", "Missing or invalid coins");
      Serial.println("hopper_dispense_rejected:invalid_coins");
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

  // Captive-network detectors vary by device and OS. Redirect every remaining
  // GET request (including a user browsing to the AP gateway) so an unknown
  // probe cannot strand the customer on the ESP32's plain-text response.
  if (method == "GET") {
    replyRedirect(client, kioskPortalUrl);
    client.stop();
    return;
  }

  replyPlain(client, 200, "OK", "PRINTBIT OK");
  client.stop();
}

// INTERRUPTS
void IRAM_ATTR countPulse() {
  if (!coinAcceptorEnabled) return;
  unsigned long nowMicros = micros();

  if (nowMicros - lastPulseMicros > debounceMicros) {
    if (pulseCount < 8) pulseCount++;
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
  if (!provisioningComplete) {
    emitHopperError(requestId, "PROVISIONING_REQUIRED", "HARDWARE_DISABLED");
    return false;
  }
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

    emitHopperError(buildHopperRequestId(), "UNKNOWN", "UNSUPPORTED_COMMAND");
    return;
  }

  if (line.startsWith("KIOSK_IP") || line.startsWith("kiosk_ip")) {
    String rest = line.substring(8);
    rest.trim();
    if (rest.startsWith(":") || rest.startsWith("=")) {
      rest = rest.substring(1);
      rest.trim();
    }

    char delimiter = (rest.indexOf(' ') >= 0) ? ' ' : ':';
    int firstDelim = rest.indexOf(delimiter);
    String ipToken = firstDelim > 0 ? rest.substring(0, firstDelim) : rest;
    ipToken.trim();

    String portToken = "";
    String pathToken = "";
    if (firstDelim > 0) {
      int secondDelim = rest.indexOf(delimiter, firstDelim + 1);
      if (secondDelim > 0) {
        portToken = rest.substring(firstDelim + 1, secondDelim);
        pathToken = rest.substring(secondDelim + 1);
      } else {
        portToken = rest.substring(firstDelim + 1);
      }
    }
    portToken.trim();
    pathToken.trim();

    if (isValidIpv4Address(ipToken)) {
      int parsedPort = portToken.toInt();
      if (parsedPort <= 0 || parsedPort > 65535) parsedPort = fallbackKioskPort;
      if (pathToken.length() == 0) pathToken = fallbackKioskPortalPath;

      updateKioskRegistration(ipToken, uint16_t(parsedPort), pathToken);
      Serial.print("KIOSK_IP:");
      Serial.println(kioskIp);
      return;
    } else {
      Serial.print("kiosk_register_failed:invalid_ip:");
      Serial.println(ipToken);
      return;
    }
  }

  if (line == "WIFI_DISCONNECT" || line == "wifi_disconnect") {
    WiFi.disconnect();
    Serial.println("WIFI_STA_DISCONNECTED");
    return;
  }

  if (line == "WIFI_FACTORY_RESET" || line == "wifi_factory_reset") {
    factoryResetWifi();
    return;
  }

  if (line == "WIFI_STATUS" || line == "wifi_status") {
    Serial.print("AP_SSID:");
    Serial.println(apSsid);
    Serial.print("AP_IP:");
    Serial.println(WiFi.softAPIP());
    Serial.print("STA_SSID:");
    Serial.println(staSsid);
    Serial.print("STA_STATUS:");
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("CONNECTED");
      Serial.print("STA_IP:");
      Serial.println(WiFi.localIP());
    } else if (WiFi.status() == WL_DISCONNECTED) {
      Serial.println("DISCONNECTED");
    } else {
      Serial.println("IDLE");
    }
    Serial.print("KIOSK_IP:");
    Serial.println(kioskIp);
    return;
  }

  if (isNumericString(line)) {
    int command = line.toInt();
    if (command > 0 && command <= maxDispenseCoins) {
      startDispense(command, buildHopperRequestId(), "serial_legacy");
    }
  }
}

// SETUP
void setup() {
  pinMode(coinAcceptorPin, INPUT);
  pinMode(hopperSensorPin, INPUT);
  pinMode(relayPin, OUTPUT);

  digitalWrite(relayPin, LOW);
  coinAcceptorEnabled = false;

  Serial.begin(115200);

  attachInterrupt(coinAcceptorPin, countPulse, RISING);
  attachInterrupt(hopperSensorPin, coinDetected, FALLING);

  loadNvsConfig();

  if (!provisioningComplete) {
    runInitialProvisioning();
    return;
  }

  WiFi.mode(WIFI_AP_STA);
  if (!WiFi.softAPConfig(printBitApIp, printBitApIp, printBitSubnet)) {
    Serial.println("AP_CONFIG_FAILED");
  }
  WiFi.softAP(apSsid.c_str(), apPass.c_str(), 1, 0);

  dnsServer.setErrorReplyCode(DNSReplyCode::NoError);
  dnsServer.start(DNS_PORT, "*", WiFi.softAPIP());

  if (MDNS.begin("printbit")) {
    MDNS.addService("http", "tcp", 80);
    Serial.println("mDNS responder started: printbit.local");
  } else {
    Serial.println("mDNS responder failed to start");
  }

  staSsid = wifiManager.getWiFiSSID();
  if (staSsid.length() > 0 && WiFi.status() != WL_CONNECTED) {
    Serial.print("Connecting to STA Wi-Fi: ");
    Serial.println(staSsid);
    Serial.println("WIFI_STA_CONNECTING");
    WiFi.begin();
  }

  Serial.println("AP Started");
  Serial.print("AP_IP:");
  Serial.println(WiFi.softAPIP());
  Serial.print("KIOSK_IP:");
  Serial.println(kioskIp);
  Serial.print("coin_target:");
  Serial.println(tabletServer);
  Serial.print("portal_target:");
  Serial.println(kioskPortalUrl);

  server.begin();

  Serial.println("SYSTEM READY");
}

// LOOP
void loop() {
  checkNodeHealth();

  byte tempCount;
  unsigned long tempLastPulse;

  noInterrupts();
  tempCount = pulseCount;
  tempLastPulse = lastPulseMillis;
  interrupts();

  if (tempCount > 8) tempCount = 0;

  if (tempCount > 0 && millis() - tempLastPulse > coinTimeout) {
    int value = 0;
    if (tempCount == 1) value = 1;
    else if (tempCount == 3) value = 5;
    else if (tempCount == 5) value = 10;
    else if (tempCount == 7) value = 20;

    if (value > 0 && coinAcceptorEnabled) {
      Serial.print("coin_pulse:");
      Serial.println(value);
      sendCoinToTablet(value);
    }

    noInterrupts();
    pulseCount = 0;
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
    }
  }

  // DNS SERVER
  dnsServer.processNextRequest();

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

  // NON-BLOCKING STA STATUS TELEMETRY
  static wl_status_t lastStaStatus = WL_IDLE_STATUS;
  static unsigned long lastStaCheckAt = 0;
  if (millis() - lastStaCheckAt >= 1000) {
    lastStaCheckAt = millis();
    wl_status_t currentStaStatus = WiFi.status();
    if (currentStaStatus != lastStaStatus) {
      if (currentStaStatus == WL_CONNECTED) {
        Serial.print("STA_IP:");
        Serial.println(WiFi.localIP());
        Serial.println("WIFI_STA_CONNECTED");
      } else if (lastStaStatus == WL_CONNECTED && currentStaStatus != WL_CONNECTED) {
        Serial.println("WIFI_STA_DISCONNECTED");
      }
      lastStaStatus = currentStaStatus;
    }
  }

  static unsigned long lastRegistrationStatusAt = 0;
  if (!hasKioskRegistration && millis() - lastRegistrationStatusAt > 15000) {
    lastRegistrationStatusAt = millis();
    Serial.println("kiosk_register_pending:waiting_for_post");
  }
}
