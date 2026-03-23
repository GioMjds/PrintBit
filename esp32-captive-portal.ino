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
#include <WebServer.h>

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════════════════════

// AP settings - phones and kiosk both connect to this network
const char* AP_SSID = "PrintBit";               // Must match PRINTBIT_HOTSPOT_SSID
const char* AP_PASS = "printbit123";            // Must match PRINTBIT_HOTSPOT_PASSWORD

// Kiosk address used as captive redirect target (must match PrintBit session URL host)
const char* KIOSK_IP = "192.168.5.1";
const int KIOSK_PORT = 3000;
const char* KIOSK_PATH = "/portal";

// ══════════════════════════════════════════════════════════════════════════════

// ESP32 AP configuration
const IPAddress AP_IP(192, 168, 4, 1);
const IPAddress SUBNET(255, 255, 255, 0);
const byte DNS_PORT = 53;

DNSServer dnsServer;
WebServer webServer(80);

String kioskIp = KIOSK_IP;
int kioskPort = KIOSK_PORT;
String kioskPath = KIOSK_PATH;

// ── Captive portal redirect target ───────────────────────────────────────────
String getKioskPortalUrl() {
  return String("http://") + kioskIp + ":" + String(kioskPort) + kioskPath;
}

bool isValidIpv4(const String& ip) {
  int dots = 0;
  int start = 0;
  for (int i = 0; i <= ip.length(); i++) {
    if (i == ip.length() || ip[i] == '.') {
      String part = ip.substring(start, i);
      if (part.length() == 0) return false;
      for (int j = 0; j < part.length(); j++) {
        if (!isDigit(part[j])) return false;
      }
      int value = part.toInt();
      if (value < 0 || value > 255) return false;
      if (i != ip.length()) dots++;
      start = i + 1;
    }
  }
  return dots == 3;
}

void handleRegisterKiosk() {
  String ip = webServer.arg("ip");
  String portRaw = webServer.arg("port");
  String path = webServer.arg("path");

  if (!isValidIpv4(ip)) {
    webServer.send(400, "application/json", "{\"ok\":false,\"error\":\"invalid_ip\"}");
    return;
  }

  int parsedPort = portRaw.toInt();
  if (parsedPort <= 0 || parsedPort > 65535) {
    parsedPort = KIOSK_PORT;
  }

  if (path.length() == 0) path = KIOSK_PATH;
  if (!path.startsWith("/")) path = "/" + path;

  kioskIp = ip;
  kioskPort = parsedPort;
  kioskPath = path;

  Serial.print("[REGISTER] Kiosk target updated: ");
  Serial.println(getKioskPortalUrl());
  webServer.send(200, "application/json", "{\"ok\":true}");
}

// ── Route handlers ────────────────────────────────────────────────────────────

void handleCaptivePortal() {
  String redirectUrl = getKioskPortalUrl();
  
  Serial.print("[CAPTIVE] Redirecting to: ");
  Serial.println(redirectUrl);
  
  webServer.sendHeader("Location", redirectUrl, true);
  webServer.send(302, "text/plain", "");
}

void handleRoot() {
  // Root path also redirects to kiosk portal
  handleCaptivePortal();
}

void handleNotFound() {
  // All unknown paths redirect to kiosk portal
  handleCaptivePortal();
}

// ── Setup ─────────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(100);
  
  Serial.println("\n\n=== PrintBit ESP32 Captive Portal ===");
  Serial.print("AP SSID: ");
  Serial.println(AP_SSID);
  
  // Start Access Point (pure AP mode)
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(AP_IP, AP_IP, SUBNET);
  
  bool apStarted = WiFi.softAP(AP_SSID, AP_PASS);
  
  if (apStarted) {
    Serial.println("✓ AP started successfully");
    Serial.print("ESP32 AP IP: ");
    Serial.println(WiFi.softAPIP());
  } else {
    Serial.println("✗ Failed to start AP");
  }
  
  // Start DNS server - hijack all DNS queries to ESP32
  dnsServer.start(DNS_PORT, "*", AP_IP);
  Serial.println("✓ DNS server started");
  
  // Android captive portal detection
  webServer.on("/generate_204", HTTP_GET, handleCaptivePortal);
  webServer.on("/gen_204", HTTP_GET, handleCaptivePortal);
  
  // iOS/macOS captive portal detection
  webServer.on("/hotspot-detect.html", HTTP_GET, handleCaptivePortal);
  webServer.on("/library/test/success.html", HTTP_GET, handleCaptivePortal);
  
  // Windows captive portal detection
  webServer.on("/connecttest.txt", HTTP_GET, handleCaptivePortal);
  webServer.on("/ncsi.txt", HTTP_GET, handleCaptivePortal);
  
  // Firefox captive portal detection
  webServer.on("/success.txt", HTTP_GET, handleCaptivePortal);
  
  // Generic routes
  webServer.on("/", HTTP_GET, handleRoot);
  webServer.on("/kiosk/register", HTTP_POST, handleRegisterKiosk);
  webServer.onNotFound(handleNotFound);
  
  webServer.begin();
  Serial.println("✓ Web server started");
  
  Serial.println("\n=== Ready ===");
  Serial.print("Kiosk target: ");
  Serial.println(getKioskPortalUrl());
  Serial.println("\nEnsure KIOSK_IP matches current kiosk network host.\n");
}

// ── Loop ──────────────────────────────────────────────────────────────────────

void loop() {
  dnsServer.processNextRequest();
  webServer.handleClient();
}
