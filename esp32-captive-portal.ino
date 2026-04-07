/*
 * ESP32 Captive Portal for PrintBit Kiosk
 *
 * Captive redirect helper for PrintBit.
 * Keep KIOSK_IP in sync with the kiosk URL host used by PrintBit server.
 *
 * SETUP:
 * 1. Flash this to ESP32
 * 2. Connect kiosk's WiFi adapter to "PrintBit" network (password: printbit123)
 * 3. Kiosk will get IP 192.168.4.2
 * 4. Phones connect to same network and get redirected to kiosk
 */

#include <WiFi.h>
#include <DNSServer.h>
#include <NetworkClient.h>
#include <WiFiAP.h>
#include <HTTPClient.h>
#include <EEPROM.h>

#define coinAcceptorPin 4
#define hopperSensorPin 5
#define relayPin 18

const char *ssid = "PrintBit";
const char *password = "printbit123";

const IPAddress apIp(192, 168, 4, 1);
const IPAddress apGateway(192, 168, 4, 1);
const IPAddress apSubnet(255, 255, 255, 0);

const char *fallbackKioskIp = "192.168.4.2";
const uint16_t fallbackKioskPort = 3000;
const char *fallbackPortalPath = "/portal";
const char *coinBridgeSource = "esp32";
const char *coinBridgeApiKey = "printbit-coin-bridge-key";

NetworkServer server(80);
DNSServer dnsServer;

String kioskIp = fallbackKioskIp;
uint16_t kioskPort = fallbackKioskPort;
String kioskPortalPath = fallbackPortalPath;
String kioskPortalUrl = "";
String tabletServer = "";

// COIN ACCEPTOR
volatile byte pulseCount = 0;
volatile unsigned long lastPulseMicros = 0;
volatile unsigned long lastPulseMillis = 0;

const unsigned long debounceMicros = 3000;
const unsigned long coinTimeout = 200;

// HOPPER
volatile int coinDispensed = 0;
int targetCoins = 0;

unsigned long lastCoinTime = 0;
const unsigned long hopperDebounce = 120;

bool dispensing = false;
bool dispenseDone = false;

// SAFETY
unsigned long hopperStartTime = 0;
const unsigned long hopperMaxRunTime = 15000;

struct CoinEvent {
  uint32_t eventId;
  uint8_t value;
};

const uint8_t QUEUE_MAGIC = 0xC7;
const uint16_t QUEUE_EEPROM_SIZE = 1024;
const uint8_t QUEUE_MAX_ITEMS = 120;
const uint16_t QUEUE_META_OFFSET = 0;
const uint16_t QUEUE_ITEMS_OFFSET = 8;
const unsigned long QUEUE_FLUSH_MIN_MS = 120;
const unsigned long QUEUE_FLUSH_BACKOFF_BASE_MS = 500;
const unsigned long QUEUE_FLUSH_BACKOFF_MAX_MS = 10000;

uint8_t queueHead = 0;
uint8_t queueTail = 0;
uint8_t queueCount = 0;
uint32_t nextCoinEventId = 1;
unsigned long nextQueueFlushAt = 0;
unsigned long queueBackoffMs = QUEUE_FLUSH_BACKOFF_BASE_MS;

String decodeUrlComponent(const String &value) {
  String decoded = "";
  for (size_t i = 0; i < value.length(); i++) {
    char c = value.charAt(i);
    if (c == '+') {
      decoded += ' ';
      continue;
    }
    if (c == '%' && i + 2 < value.length()) {
      char h1 = value.charAt(i + 1);
      char h2 = value.charAt(i + 2);
      auto hexToInt = [](char h) -> int {
        if (h >= '0' && h <= '9') return h - '0';
        if (h >= 'A' && h <= 'F') return h - 'A' + 10;
        if (h >= 'a' && h <= 'f') return h - 'a' + 10;
        return -1;
      };
      int hi = hexToInt(h1);
      int lo = hexToInt(h2);
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

String getFormValue(const String &body, const String &key) {
  String needle = key + "=";
  int start = body.indexOf(needle);
  if (start < 0) return "";
  start += needle.length();
  int end = body.indexOf('&', start);
  if (end < 0) end = body.length();
  return decodeUrlComponent(body.substring(start, end));
}

String normalizedPortalPath(const String &pathCandidate) {
  if (pathCandidate.length() == 0) return "/portal";
  if (pathCandidate.charAt(0) == '/') return pathCandidate;
  return "/" + pathCandidate;
}

bool isValidIpv4Address(const String &ip) {
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
  kioskPortalPath = normalizedPortalPath(kioskPortalPath);
  kioskPortalUrl =
      "http://" + kioskIp + ":" + String(kioskPort) + kioskPortalPath;
  tabletServer = "http://" + kioskIp + ":" + String(kioskPort) + "/coin";
}

bool isCaptiveProbePath(const String &path) {
  return path == "/hotspot-detect.html" || path == "/generate_204" ||
         path == "/ncsi.txt" || path == "/connecttest.txt";
}

void replyRedirect(NetworkClient &client, const String &location) {
  client.println("HTTP/1.1 302 Found");
  client.print("Location: ");
  client.println(location);
  client.println("Content-Length: 0");
  client.println("Connection: close");
  client.println();
}

void replyPlain(NetworkClient &client, int statusCode, const String &statusText,
                const String &body) {
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

bool parseRequestLine(const String &requestLine, String &method, String &path) {
  int firstSpace = requestLine.indexOf(' ');
  if (firstSpace <= 0) return false;
  int secondSpace = requestLine.indexOf(' ', firstSpace + 1);
  if (secondSpace <= firstSpace) return false;
  method = requestLine.substring(0, firstSpace);
  path = requestLine.substring(firstSpace + 1, secondSpace);
  return method.length() > 0 && path.length() > 0;
}

String readRequestBody(NetworkClient &client, int contentLength) {
  if (contentLength <= 0) return "";
  String body = "";
  unsigned long start = millis();
  while ((int)body.length() < contentLength && millis() - start < 1200) {
    while (client.available() && (int)body.length() < contentLength) {
      body += char(client.read());
    }
    delay(1);
  }
  return body;
}

uint16_t queueItemOffset(uint8_t index) {
  return QUEUE_ITEMS_OFFSET + uint16_t(index) * 5;
}

uint32_t readUint32Eeprom(uint16_t offset) {
  uint32_t v = 0;
  v |= uint32_t(EEPROM.read(offset));
  v |= uint32_t(EEPROM.read(offset + 1)) << 8;
  v |= uint32_t(EEPROM.read(offset + 2)) << 16;
  v |= uint32_t(EEPROM.read(offset + 3)) << 24;
  return v;
}

void writeUint32Eeprom(uint16_t offset, uint32_t value) {
  EEPROM.update(offset, uint8_t(value & 0xFF));
  EEPROM.update(offset + 1, uint8_t((value >> 8) & 0xFF));
  EEPROM.update(offset + 2, uint8_t((value >> 16) & 0xFF));
  EEPROM.update(offset + 3, uint8_t((value >> 24) & 0xFF));
}

CoinEvent readQueueItem(uint8_t index) {
  const uint16_t offset = queueItemOffset(index);
  CoinEvent event;
  event.eventId = readUint32Eeprom(offset);
  event.value = EEPROM.read(offset + 4);
  return event;
}

void writeQueueItem(uint8_t index, const CoinEvent &event) {
  const uint16_t offset = queueItemOffset(index);
  writeUint32Eeprom(offset, event.eventId);
  EEPROM.update(offset + 4, event.value);
}

void saveQueueState() {
  EEPROM.update(QUEUE_META_OFFSET, QUEUE_MAGIC);
  EEPROM.update(QUEUE_META_OFFSET + 1, queueHead);
  EEPROM.update(QUEUE_META_OFFSET + 2, queueTail);
  EEPROM.update(QUEUE_META_OFFSET + 3, queueCount);
  writeUint32Eeprom(QUEUE_META_OFFSET + 4, nextCoinEventId);
  EEPROM.commit();
}

void resetQueueState() {
  queueHead = 0;
  queueTail = 0;
  queueCount = 0;
  nextCoinEventId = 1;
  saveQueueState();
}

void initCoinQueue() {
  EEPROM.begin(QUEUE_EEPROM_SIZE);
  if (EEPROM.read(QUEUE_META_OFFSET) != QUEUE_MAGIC) {
    resetQueueState();
    return;
  }

  queueHead = EEPROM.read(QUEUE_META_OFFSET + 1);
  queueTail = EEPROM.read(QUEUE_META_OFFSET + 2);
  queueCount = EEPROM.read(QUEUE_META_OFFSET + 3);
  nextCoinEventId = readUint32Eeprom(QUEUE_META_OFFSET + 4);

  const bool invalidState =
      queueHead >= QUEUE_MAX_ITEMS || queueTail >= QUEUE_MAX_ITEMS ||
      queueCount > QUEUE_MAX_ITEMS || nextCoinEventId == 0;
  if (invalidState) {
    resetQueueState();
  }
}

bool enqueueCoinValue(uint8_t value) {
  if (queueCount >= QUEUE_MAX_ITEMS) {
    Serial.println("WARN: Coin queue full, dropping newest coin event");
    return false;
  }
  CoinEvent event;
  event.eventId = nextCoinEventId++;
  event.value = value;
  writeQueueItem(queueTail, event);
  queueTail = (queueTail + 1) % QUEUE_MAX_ITEMS;
  queueCount++;
  saveQueueState();
  return true;
}

bool peekCoinEvent(CoinEvent &event) {
  if (queueCount == 0) return false;
  event = readQueueItem(queueHead);
  return true;
}

void popCoinEvent() {
  if (queueCount == 0) return;
  queueHead = (queueHead + 1) % QUEUE_MAX_ITEMS;
  queueCount--;
  saveQueueState();
}

bool dispatchCoinEvent(const CoinEvent &event, int &httpCodeOut) {
  HTTPClient http;
  String url = tabletServer + "?value=" + String(event.value) +
               "&eventId=" + String(event.eventId) + "&source=" +
               String(coinBridgeSource) + "&apiKey=" + String(coinBridgeApiKey);
  http.begin(url);
  httpCodeOut = http.GET();
  http.end();
  return httpCodeOut == 200;
}

void flushCoinQueue(bool force) {
  if (queueCount == 0) return;
  if (!force && millis() < nextQueueFlushAt) return;
  if (WiFi.softAPgetStationNum() == 0) {
    nextQueueFlushAt = millis() + queueBackoffMs;
    return;
  }

  CoinEvent event;
  if (!peekCoinEvent(event)) return;

  int httpCode = -1;
  if (dispatchCoinEvent(event, httpCode)) {
    popCoinEvent();
    queueBackoffMs = QUEUE_FLUSH_BACKOFF_BASE_MS;
    nextQueueFlushAt = millis() + QUEUE_FLUSH_MIN_MS;
    Serial.print("COIN_HTTP_OK:");
    Serial.println(event.value);
    return;
  }

  queueBackoffMs =
      min(queueBackoffMs * 2, (unsigned long)QUEUE_FLUSH_BACKOFF_MAX_MS);
  nextQueueFlushAt = millis() + queueBackoffMs;
  Serial.print("WARN: Coin queue flush failed, code=");
  Serial.print(httpCode);
  Serial.print(", retry_in_ms=");
  Serial.println(queueBackoffMs);
}

void handleRegisterRequest(NetworkClient &client, const String &body) {
  String postedIp = getFormValue(body, "ip");
  String postedPort = getFormValue(body, "port");
  String postedPath = getFormValue(body, "path");
  postedIp.trim();
  postedPort.trim();
  postedPath.trim();

  if (postedIp.length() == 0 || !isValidIpv4Address(postedIp)) {
    replyPlain(client, 400, "Bad Request", "Missing or invalid ip");
    return;
  }

  int parsedPort = postedPort.toInt();
  if (parsedPort <= 0 || parsedPort > 65535) parsedPort = fallbackKioskPort;

  kioskIp = postedIp;
  kioskPort = uint16_t(parsedPort);
  kioskPortalPath = normalizedPortalPath(postedPath);
  refreshTargets();

  Serial.print("KIOSK_IP:");
  Serial.println(kioskIp);
  Serial.print("KIOSK_PORT:");
  Serial.println(kioskPort);
  Serial.print("KIOSK_PORTAL_URL:");
  Serial.println(kioskPortalUrl);

  replyPlain(client, 200, "OK", "registered");
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
    lastCoinTime = now;

    if (dispensing && coinDispensed >= targetCoins) {
      digitalWrite(relayPin, LOW);
      dispensing = false;
      dispenseDone = true;
    }
  }
}

// ENQUEUE COIN EVENT; FLUSH ROUTINE DELIVERS WITH RETRY/BACKOFF
void sendCoinToTablet(int value) {
  if (!enqueueCoinValue(uint8_t(value))) {
    return;
  }

  if (WiFi.softAPgetStationNum() == 0) {
    Serial.println("WARN: No stations connected, queued coin event");
    return;
  }

  flushCoinQueue(true);
}

// DISPENSE
void startDispense(int coins) {
  if (dispensing) return;
  if (coins <= 0 || coins > 50) return;

  targetCoins = coins;
  coinDispensed = 0;
  dispensing = true;
  dispenseDone = false;

  hopperStartTime = millis();

  digitalWrite(relayPin, HIGH);

  Serial.print("START ");
  Serial.println(targetCoins);
}

void handleWifiRequest(NetworkClient &client) {
  client.setTimeout(200);
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

  int contentLength = 0;
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
    }
  }

  String body = readRequestBody(client, contentLength);

  if (method == "POST" && path == "/kiosk/register") {
    handleRegisterRequest(client, body);
    client.stop();
    return;
  }

  if (method == "GET" && isCaptiveProbePath(path)) {
    replyRedirect(client, kioskPortalUrl);
    client.stop();
    return;
  }

  if (method == "GET" && path.startsWith("/?coins=")) {
    int coins = path.substring(8).toInt();
    startDispense(coins);
  }

  replyPlain(client, 200, "OK", "PRINTBIT OK");
  client.stop();
}

// SETUP
void setup() {
  pinMode(coinAcceptorPin, INPUT_PULLUP);
  pinMode(hopperSensorPin, INPUT_PULLUP);
  pinMode(relayPin, OUTPUT);

  digitalWrite(relayPin, LOW);

  Serial.begin(115200);
  initCoinQueue();
  Serial.print("COIN_QUEUE_RESTORED:");
  Serial.println(queueCount);

  attachInterrupt(coinAcceptorPin, countPulse, FALLING);
  attachInterrupt(hopperSensorPin, coinDetected, FALLING);

  refreshTargets();

  if (!WiFi.softAPConfig(apIp, apGateway, apSubnet)) {
    Serial.println("WARN: softAPConfig failed, using default AP network settings");
  }
  WiFi.softAP(ssid, password);
  dnsServer.start(53, "*", WiFi.softAPIP());

  Serial.println("AP Started");
  Serial.print("AP_IP:");
  Serial.println(WiFi.softAPIP());
  Serial.print("KIOSK_IP:");
  Serial.println(kioskIp);
  Serial.print("KIOSK_PORT:");
  Serial.println(kioskPort);
  Serial.print("KIOSK_PORTAL_URL:");
  Serial.println(kioskPortalUrl);

  server.begin();

  Serial.println("SYSTEM READY");
}

// LOOP
void loop() {
  dnsServer.processNextRequest();
  flushCoinQueue(false);
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
      Serial.print("COIN_PULSE:");
      Serial.println(value);
      sendCoinToTablet(value);
    }

    noInterrupts();
    pulseCount = 0;
    interrupts();
  }

  // SERIAL COMMAND
  if (Serial.available()) {
    int command = Serial.parseInt();
    if (command > 0 && command <= 50) {
      startDispense(command);
    }
  }

  // WIFI REQUEST
  NetworkClient client = server.accept();
  if (client) {
    handleWifiRequest(client);
  }

  // HOPPER TIMEOUT
  if (dispensing && millis() - hopperStartTime > hopperMaxRunTime) {
    Serial.println("HOPPER TIMEOUT");
    digitalWrite(relayPin, LOW);
    dispensing = false;
    dispenseDone = true;
  }

  if (dispenseDone) {
    Serial.println("DONE");
    dispenseDone = false;
  }
}
