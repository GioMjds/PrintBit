#include <WiFi.h>
#include <NetworkClient.h>
#include <WiFiAP.h>
#include <HTTPClient.h>
#include <WiFiManager.h>
#include <Preferences.h>

#define coinAcceptorPin 4
#define hopperSensorPin 5
#define relayPin 18
#define reprovisionButtonPin 19

const char* provisioningApSsid = "PrintBit-Setup";
const char* provisioningApPassword = "printbit123";
const char* provisioningPrefsNamespace = "printbit";

const char* fallbackKioskIp = "192.168.4.2";
const uint16_t fallbackKioskPort = 3000;
const char* fallbackKioskPortalPath = "/portal";
const char* kioskRegisterToken = "printbit-register-token";
const char* coinBridgeSource = "esp32";
const char* coinBridgeApiKey = "printbit-coin-bridge-key";
const char* hopperControlToken = "printbit-coin-bridge-key";

NetworkServer server(80);
WiFiManager wifiManager;

char backendUrlParamValue[161] = "";
char deviceIdParamValue[65] = "";
char apiKeyParamValue[129] = "";
char printerModelParamValue[65] = "";

WiFiManagerParameter backendUrlParam(
    "backend_url",
    "Backend URL",
    backendUrlParamValue,
    sizeof(backendUrlParamValue) - 1);
WiFiManagerParameter deviceIdParam(
    "device_id",
    "Device ID",
    deviceIdParamValue,
    sizeof(deviceIdParamValue) - 1);
WiFiManagerParameter apiKeyParam(
    "api_key",
    "API Key",
    apiKeyParamValue,
    sizeof(apiKeyParamValue) - 1);
WiFiManagerParameter printerModelParam(
    "printer_model",
    "Printer Model",
    printerModelParamValue,
    sizeof(printerModelParamValue) - 1);

String kioskIp = fallbackKioskIp;
uint16_t kioskPort = fallbackKioskPort;
String kioskPortalPath = fallbackKioskPortalPath;
String kioskPortalUrl = "";
String tabletServer = "";
String provisionedBackendUrl = "";
String provisionedDeviceId = "";
String provisionedApiKey = "";
String provisionedPrinterModel = "";
bool hasKioskRegistration = false;
bool customServerRunning = false;
bool shouldSaveProvisioningConfig = false;
bool reprovisionPending = false;

enum WifiLifecycleState {
  WIFI_CONNECTING,
  WIFI_PROVISIONING_PORTAL,
  WIFI_RUNNING
};

WifiLifecycleState wifiState = WIFI_CONNECTING;
unsigned long wifiConnectStartedAt = 0;
unsigned long wifiDisconnectedAt = 0;
unsigned long lastPortalEnsureAt = 0;
unsigned long reprovisionButtonPressedAt = 0;
bool reprovisionButtonHeld = false;

const unsigned long wifiConnectingGraceMs = 10000;
const unsigned long wifiReconnectPortalDelayMs = 15000;
const unsigned long wifiPortalEnsureIntervalMs = 12000;
const unsigned long reprovisionButtonHoldMs = 5000;

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
int targetCoins = 0;

unsigned long lastCoinTime = 0;
const unsigned long hopperDebounce = 120;

bool dispensing = false;
bool dispenseDone = false;
bool dispenseTimedOut = false;
volatile bool dispenseProgressDirty = false;
int lastProgressReported = -1;

// SAFETY
unsigned long hopperStartTime = 0;
const unsigned long hopperMaxRunTime = 15000;

unsigned long coinEventCounter = 0;
String activeDispenseRequestId = "";
String lastDispenseRequestId = "";
String lastDispenseOutcome = "idle";
String lastDispenseError = "";
unsigned long lastDispenseFinishedAt = 0;
String serialLineBuffer = "";

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

bool isLikelyHttpUrl(const String& url) {
  if (url.length() < 10) return false;
  String normalized = url;
  normalized.toLowerCase();
  return normalized.startsWith("http://") || normalized.startsWith("https://");
}

void copyStringToBuffer(const String& source, char* destination, size_t destinationSize) {
  if (destinationSize == 0) return;
  size_t copyLength = source.length();
  if (copyLength >= destinationSize) copyLength = destinationSize - 1;
  memcpy(destination, source.c_str(), copyLength);
  destination[copyLength] = '\0';
}

bool validateProvisioningFields(
    const String& backendUrl,
    const String& deviceId,
    const String& apiKey,
    const String& printerModel,
    String& reason) {
  if (backendUrl.length() == 0 || deviceId.length() == 0 || apiKey.length() == 0 ||
      printerModel.length() == 0) {
    reason = "missing_required_field";
    return false;
  }
  if (!isLikelyHttpUrl(backendUrl)) {
    reason = "invalid_backend_url";
    return false;
  }
  if (backendUrl.length() >= sizeof(backendUrlParamValue) ||
      deviceId.length() >= sizeof(deviceIdParamValue) ||
      apiKey.length() >= sizeof(apiKeyParamValue) ||
      printerModel.length() >= sizeof(printerModelParamValue)) {
    reason = "field_too_long";
    return false;
  }
  return true;
}

void loadProvisioningConfig() {
  Preferences prefs;
  if (!prefs.begin(provisioningPrefsNamespace, true)) {
    Serial.println("provisioning_load_failed:prefs_begin_failed");
    return;
  }

  provisionedBackendUrl = prefs.getString("backend_url", "");
  provisionedDeviceId = prefs.getString("device_id", "");
  provisionedApiKey = prefs.getString("api_key", "");
  provisionedPrinterModel = prefs.getString("printer_model", "");
  prefs.end();

  provisionedBackendUrl.trim();
  provisionedDeviceId.trim();
  provisionedApiKey.trim();
  provisionedPrinterModel.trim();

  copyStringToBuffer(provisionedBackendUrl, backendUrlParamValue, sizeof(backendUrlParamValue));
  copyStringToBuffer(provisionedDeviceId, deviceIdParamValue, sizeof(deviceIdParamValue));
  copyStringToBuffer(provisionedApiKey, apiKeyParamValue, sizeof(apiKeyParamValue));
  copyStringToBuffer(
      provisionedPrinterModel,
      printerModelParamValue,
      sizeof(printerModelParamValue));

  String reason = "";
  if (validateProvisioningFields(
          provisionedBackendUrl,
          provisionedDeviceId,
          provisionedApiKey,
          provisionedPrinterModel,
          reason)) {
    Serial.println("provisioning_config_loaded");
    return;
  }
  if (provisionedBackendUrl.length() == 0 && provisionedDeviceId.length() == 0 &&
      provisionedApiKey.length() == 0 && provisionedPrinterModel.length() == 0) {
    Serial.println("provisioning_config_empty");
    return;
  }
  Serial.print("provisioning_config_invalid:");
  Serial.println(reason);
  provisionedBackendUrl = "";
  provisionedDeviceId = "";
  provisionedApiKey = "";
  provisionedPrinterModel = "";
}

void clearProvisioningConfig() {
  Preferences prefs;
  if (!prefs.begin(provisioningPrefsNamespace, false)) {
    Serial.println("provisioning_clear_failed:prefs_begin_failed");
    return;
  }
  prefs.remove("backend_url");
  prefs.remove("device_id");
  prefs.remove("api_key");
  prefs.remove("printer_model");
  prefs.end();
}

bool saveProvisioningConfig() {
  String backendUrl = String(backendUrlParam.getValue());
  String deviceId = String(deviceIdParam.getValue());
  String apiKey = String(apiKeyParam.getValue());
  String printerModel = String(printerModelParam.getValue());
  backendUrl.trim();
  deviceId.trim();
  apiKey.trim();
  printerModel.trim();

  String reason = "";
  if (!validateProvisioningFields(backendUrl, deviceId, apiKey, printerModel, reason)) {
    Serial.print("provisioning_save_rejected:");
    Serial.println(reason);
    return false;
  }

  Preferences prefs;
  if (!prefs.begin(provisioningPrefsNamespace, false)) {
    Serial.println("provisioning_save_failed:prefs_begin_failed");
    return false;
  }
  prefs.putString("backend_url", backendUrl);
  prefs.putString("device_id", deviceId);
  prefs.putString("api_key", apiKey);
  prefs.putString("printer_model", printerModel);
  prefs.end();

  provisionedBackendUrl = backendUrl;
  provisionedDeviceId = deviceId;
  provisionedApiKey = apiKey;
  provisionedPrinterModel = printerModel;
  hasKioskRegistration = false;
  Serial.println("provisioning_saved");
  return true;
}

void onWiFiConfigPortal(WiFiManager* wm) {
  wifiState = WIFI_PROVISIONING_PORTAL;
  lastPortalEnsureAt = millis();
  if (customServerRunning) {
    server.stop();
    customServerRunning = false;
  }
  Serial.print("wifi_provisioning_portal_started:ssid=");
  Serial.println(wm->getConfigPortalSSID());
}

void onWiFiSaveConfig() {
  shouldSaveProvisioningConfig = true;
}

void configureWiFiManager() {
  wifiManager.setConfigPortalBlocking(false);
  wifiManager.setConfigPortalTimeout(180);
  wifiManager.setConnectTimeout(20);
  wifiManager.setBreakAfterConfig(true);
  wifiManager.setAPCallback(onWiFiConfigPortal);
  wifiManager.setSaveConfigCallback(onWiFiSaveConfig);
  wifiManager.addParameter(&backendUrlParam);
  wifiManager.addParameter(&deviceIdParam);
  wifiManager.addParameter(&apiKeyParam);
  wifiManager.addParameter(&printerModelParam);
}

void startCustomServerIfNeeded() {
  if (customServerRunning) return;
  server.begin();
  customServerRunning = true;
  Serial.println("http_server_started");
}

void stopCustomServerIfRunning() {
  if (!customServerRunning) return;
  server.stop();
  customServerRunning = false;
  Serial.println("http_server_stopped");
}

void beginProvisioningPortal() {
  wifiState = WIFI_PROVISIONING_PORTAL;
  stopCustomServerIfRunning();
  lastPortalEnsureAt = millis();
  wifiManager.startConfigPortal(provisioningApSsid, provisioningApPassword);
}

void refreshTargets() {
  if (!hasKioskRegistration && provisionedBackendUrl.length() > 0) {
    tabletServer = provisionedBackendUrl;
    kioskPortalUrl = provisionedBackendUrl;
    return;
  }
  kioskPortalPath = normalizedPath(kioskPortalPath);
  kioskPortalUrl =
      "http://" + kioskIp + ":" + String(kioskPort) + kioskPortalPath;
  tabletServer = "http://" + kioskIp + ":" + String(kioskPort) + "/coin";
}

void processNetworkLifecycle() {
  wifiManager.process();

  if (shouldSaveProvisioningConfig) {
    shouldSaveProvisioningConfig = false;
    if (!saveProvisioningConfig()) {
      Serial.println("provisioning_save_failed");
    }
    refreshTargets();
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiDisconnectedAt = 0;
    if (wifiState != WIFI_RUNNING) {
      wifiState = WIFI_RUNNING;
      refreshTargets();
      startCustomServerIfNeeded();
      Serial.print("wifi_connected:ip=");
      Serial.println(WiFi.localIP());
    }
    return;
  }

  stopCustomServerIfRunning();

  if (wifiState == WIFI_CONNECTING) {
    if (millis() - wifiConnectStartedAt > wifiConnectingGraceMs) {
      Serial.println("wifi_connect_timeout:starting_provisioning");
      beginProvisioningPortal();
    }
    return;
  }

  if (wifiState == WIFI_RUNNING) {
    if (wifiDisconnectedAt == 0) {
      wifiDisconnectedAt = millis();
      return;
    }
    if (millis() - wifiDisconnectedAt > wifiReconnectPortalDelayMs) {
      Serial.println("wifi_lost:starting_provisioning");
      beginProvisioningPortal();
    }
    return;
  }

  if (wifiState == WIFI_PROVISIONING_PORTAL &&
      millis() - lastPortalEnsureAt > wifiPortalEnsureIntervalMs) {
    lastPortalEnsureAt = millis();
    wifiManager.startConfigPortal(provisioningApSsid, provisioningApPassword);
  }
}

void triggerReprovisionReset() {
  if (reprovisionPending) return;
  reprovisionPending = true;
  Serial.println("reprovision_reset_triggered");
  stopCustomServerIfRunning();
  wifiManager.resetSettings();
  clearProvisioningConfig();
  delay(300);
  ESP.restart();
}

void processReprovisionButton() {
  if (digitalRead(reprovisionButtonPin) == LOW) {
    if (!reprovisionButtonHeld) {
      reprovisionButtonHeld = true;
      reprovisionButtonPressedAt = millis();
      return;
    }
    if (millis() - reprovisionButtonPressedAt >= reprovisionButtonHoldMs) {
      triggerReprovisionReset();
    }
    return;
  }
  reprovisionButtonHeld = false;
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
  return body;
}

bool isCaptiveProbePath(const String& path) {
  return path == "/hotspot-detect.html" || path == "/generate_204" ||
      path == "/ncsi.txt" || path == "/connecttest.txt";
}

String buildCoinEventId() {
  coinEventCounter++;
  return String((uint32_t)esp_random(), HEX) + "-" + String(millis()) + "-" +
      String(coinEventCounter);
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
    logCoinSendFailure("network_unreachable_no_wifi", 0, "");
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
    String apiKeyHeader =
        provisionedApiKey.length() > 0 ? provisionedApiKey : String(coinBridgeApiKey);
    http.addHeader("x-coin-api-key", apiKeyHeader);
    http.addHeader("x-coin-event-id", eventId);
    if (provisionedDeviceId.length() > 0) {
      http.addHeader("x-device-id", provisionedDeviceId);
    }
    if (provisionedPrinterModel.length() > 0) {
      http.addHeader("x-printer-model", provisionedPrinterModel);
    }
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
  if (contentLength > 0 && contentLength <= 512) {
    body = readRequestBody(client, contentLength);
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

    if (postedToken.length() == 0 || postedToken != hopperControlToken) {
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
    response += "\",\"lastFinishedAtMs\":";
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

  replyPlain(client, 200, "OK", "PRINTBIT OK");
  client.stop();
}

// INTERRUPTS
void IRAM_ATTR countPulse() {
  unsigned long nowMicros = micros();

  if (nowMicros - lastPulseMicros > debounceMicros) {
    if (pulseCount < 8) pulseCount++;
    lastPulseMicros = nowMicros;
    lastPulseMillis = millis();
  }
}

void IRAM_ATTR coinDetected() {
  unsigned long now = millis();

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

    emitHopperError(buildHopperRequestId(), "UNKNOWN", "UNSUPPORTED_COMMAND");
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
  pinMode(coinAcceptorPin, INPUT_PULLUP);
  pinMode(hopperSensorPin, INPUT_PULLUP);
  pinMode(relayPin, OUTPUT);
  pinMode(reprovisionButtonPin, INPUT_PULLUP);

  digitalWrite(relayPin, LOW);

  Serial.begin(115200);

  attachInterrupt(coinAcceptorPin, countPulse, FALLING);
  attachInterrupt(hopperSensorPin, coinDetected, FALLING);

  loadProvisioningConfig();
  refreshTargets();
  configureWiFiManager();

  WiFi.mode(WIFI_STA);
  wifiConnectStartedAt = millis();
  bool connected = wifiManager.autoConnect(provisioningApSsid, provisioningApPassword);
  if (connected && WiFi.status() == WL_CONNECTED) {
    wifiState = WIFI_RUNNING;
    startCustomServerIfNeeded();
    Serial.print("wifi_connected:ip=");
    Serial.println(WiFi.localIP());
  } else if (wifiState != WIFI_PROVISIONING_PORTAL) {
    wifiState = WIFI_CONNECTING;
    Serial.println("wifi_connect_pending");
  }

  Serial.print("coin_target:");
  Serial.println(tabletServer);
  Serial.print("portal_target:");
  Serial.println(kioskPortalUrl);

  Serial.println("SYSTEM READY");
}

// LOOP
void loop() {
  processNetworkLifecycle();
  processReprovisionButton();

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

    if (value > 0) {
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

  // WIFI REQUEST
  if (customServerRunning) {
    NetworkClient client = server.accept();
    if (client) {
      handleWifiRequest(client);
    }
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
    emitHopperDone(lastDispenseRequestId, dispensedSnapshot);
    Serial.print("hopper_done:requestId=");
    Serial.print(lastDispenseRequestId);
    Serial.print(":dispensed=");
    Serial.println(dispensedSnapshot);
    activeDispenseRequestId = "";
  }

  static unsigned long lastRegistrationStatusAt = 0;
  if (!hasKioskRegistration && provisionedBackendUrl.length() == 0 &&
      millis() - lastRegistrationStatusAt > 15000) {
    lastRegistrationStatusAt = millis();
    Serial.println("kiosk_register_pending:waiting_for_post");
  }
}
