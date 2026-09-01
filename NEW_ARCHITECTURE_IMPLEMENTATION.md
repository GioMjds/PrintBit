For PrintBit, I would divide the responsibility like this:

| Component          | Responsibility                                        | Change needed?              |
| ------------------ | ----------------------------------------------------- | --------------------------- |
| **Windows Tablet** | Keep tablet network address predictable               | ✅ Yes                      |
| **ESP32**          | Keep AP address fixed, discover/register kiosk server | ✅ Yes, main change         |
| **Node.js**        | Listen correctly and register itself with ESP32       | ✅ Yes, main change         |
| **C# Worker**      | Local printer/hardware worker on same tablet          | ⚠️ Probably small/no change |

The target architecture should be:

```text
                     PRINTBIT

                 ESP32 Controller
                   192.168.4.1
                        |
                PrintBit Wi-Fi AP
                        |
          +-------------+-------------+
          |                           |
    Windows Tablet                User Phones
     192.168.4.2                  DHCP clients
          |
          |
   +------+-------+
   |              |
Node.js         C# Worker
:3000
0.0.0.0
```

Then add a safety mechanism:

```text
Node.js starts
      |
      v
POST http://192.168.4.1/kiosk/register
      |
      v
ESP32 reads client.remoteIP()
      |
      v
ESP32 knows where Node.js is
```

## Step-by-step implementation order

1. **First, make the ESP32 AP address permanently `192.168.4.1`.**

   In your ESP32 firmware, configure the AP before `WiFi.softAP()`:

```cpp
IPAddress apIP(192, 168, 4, 1);
IPAddress gateway(192, 168, 4, 1);
IPAddress subnet(255, 255, 255, 0);

WiFi.mode(WIFI_AP_STA);

if (!WiFi.softAPConfig(apIP, gateway, subnet)) {
    Serial.println("Failed to configure AP IP");
}

WiFi.softAP("PrintBit", "printbit123");

Serial.print("PrintBit AP: ");
Serial.println(WiFi.softAPIP());
```

You want this invariant:

```text
ESP32 = ALWAYS 192.168.4.1
```

Not:

```text
ESP32 = 192.168.4.x
```

This becomes the one address every PrintBit component can safely know.

---

2. **Configure the Windows Tablet to prefer `192.168.4.2`.**

   This is worth doing because the tablet is a fixed component of the kiosk.

   On Windows 10:

```text
Control Panel
    ↓
Network and Internet
    ↓
Network and Sharing Center
    ↓
Change adapter settings
    ↓
Wi-Fi
    ↓
Properties
    ↓
Internet Protocol Version 4 (TCP/IPv4)
    ↓
Properties
```

Configure:

```text
Use the following IP address:

IP address:
192.168.4.2

Subnet mask:
255.255.255.0

Default gateway:
192.168.4.1
```

For your local ESP32-only network, DNS is not particularly important. You can generally use:

```text
Preferred DNS:
192.168.4.1
```

if your ESP32 captive portal/DNS server is providing DNS behavior.

The resulting network is:

```text
192.168.4.1 = ESP32
192.168.4.2 = PrintBit Tablet
```

Do not assign `.2` to another device.

---

3. **Change Node.js so it does not bind specifically to `192.168.4.2`.**

Avoid this:

```ts
app.listen(3000, '192.168.4.2');
```

Use:

```ts
const PORT = 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PrintBit server running on port ${PORT}`);
});
```

This means:

```text
Node.js
   |
   +-- localhost:3000
   |
   +-- 127.0.0.1:3000
   |
   +-- 192.168.4.2:3000
   |
   +-- other tablet interfaces
```

This is important.

The **operating system owns the IP address**.

Node.js should primarily own:

```text
port 3000
```

not:

```text
192.168.4.2
```

So mentally think:

```text
Wrong:

Node.js owns
192.168.4.2:3000


Correct:

Windows owns
192.168.4.2

Node.js listens on
*:3000
```

---

4. **Keep Node.js and C# communication local whenever possible.**

Since Node.js and your C# Worker run on the same Windows Tablet, they should generally not communicate through:

```text
192.168.4.2
```

when they don't have to.

Use:

```text
http://127.0.0.1:3000
```

or:

```text
http://localhost:3000
```

For example, if your C# Worker calls Node:

```csharp
var baseUrl = "http://127.0.0.1:3000";
```

rather than:

```csharp
var baseUrl = "http://192.168.4.2:3000";
```

This separates two concepts:

```text
Inside Tablet
=============

C# Worker
    |
localhost
    |
Node.js


Outside Tablet
==============

ESP32
    |
Wi-Fi
    |
192.168.4.2:3000
Node.js
```

That is much more robust.

Even if Wi-Fi disappears temporarily:

```text
C# ↔ Node.js
```

can still work locally.

---

5. **Implement `/kiosk/register` on the ESP32.**

Your ESP32 should accept something like:

```http
POST /kiosk/register
```

When Node connects, do not trust Node to say:

```json
{
  "ip": "192.168.4.2"
}
```

The ESP32 can obtain the real network source address itself:

```cpp
IPAddress kioskIp;
uint16_t kioskPort = 3000;
bool kioskRegistered = false;
```

Then when handling registration:

```cpp
void handleKioskRegister(NetworkClient &client) {
    kioskIp = client.remoteIP();
    kioskPort = 3000;
    kioskRegistered = true;

    Serial.print("Kiosk registered: ");
    Serial.print(kioskIp);
    Serial.print(":");
    Serial.println(kioskPort);

    client.println("HTTP/1.1 200 OK");
    client.println("Content-Type: application/json");
    client.println("Connection: close");
    client.println();

    client.println("{\"success\":true}");
}
```

Conceptually:

```text
Tablet gets 192.168.4.2

Node:
POST /kiosk/register

ESP32 sees:

client.remoteIP()
       =
192.168.4.2
```

Now ESP32 stores:

```cpp
kioskIp = 192.168.4.2;
```

---

6. **Stop hardcoding `192.168.4.2:3000` throughout ESP32.**

If you currently have:

```cpp
HTTPClient http;

http.begin(
    "http://192.168.4.2:3000/api/coin"
);
```

replace that pattern.

Create:

```cpp
String getKioskBaseUrl() {
    return "http://" +
           kioskIp.toString() +
           ":" +
           String(kioskPort);
}
```

Then:

```cpp
HTTPClient http;

String url =
    getKioskBaseUrl() +
    "/api/hardware/coin";

http.begin(url);
```

Now your ESP32 does not care whether the tablet becomes:

```text
192.168.4.2
```

or unexpectedly:

```text
192.168.4.3
```

because `/kiosk/register` updates:

```cpp
kioskIp
```

---

7. **Make Node.js register itself automatically at startup.**

Your Express server should do something similar to:

```ts
const ESP32_BASE_URL = 'http://192.168.4.1';

async function registerKiosk() {
  try {
    const response = await fetch(`${ESP32_BASE_URL}/kiosk/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        port: 3000,
      }),
    });

    if (!response.ok) {
      throw new Error(`Registration failed: ${response.status}`);
    }

    console.log('Registered with PrintBit ESP32.');
  } catch (error) {
    console.error('Unable to register with ESP32:', error);
  }
}
```

Then:

```ts
app.listen(3000, '0.0.0.0', async () => {
  console.log('PrintBit server started.');

  await registerKiosk();
});
```

So your boot becomes automatic:

```text
Windows boots
     ↓
Connects to PrintBit Wi-Fi
     ↓
Tablet receives/configures
192.168.4.2
     ↓
Node.js starts
     ↓
0.0.0.0:3000
     ↓
POST 192.168.4.1/kiosk/register
     ↓
ESP32 learns tablet address
     ↓
PrintBit Ready
```

---

8. **Add retries to Node registration.**

This matters because Windows may start Node before Wi-Fi is completely ready.

For example:

```ts
async function registerWithRetry() {
  while (true) {
    try {
      const response = await fetch('http://192.168.4.1/kiosk/register', {
        method: 'POST',
      });

      if (response.ok) {
        console.log('ESP32 registration complete.');
        return;
      }
    } catch {
      console.log('ESP32 unavailable, retrying...');
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
```

Then:

```text
Node starts
    ↓
ESP32 reachable?
   / \
 YES  NO
  |    |
  |   retry
  |   3 sec
  |    |
  +----+
  |
registered
```

For production, I would eventually add a maximum backoff rather than retrying exactly every 3 seconds indefinitely.

---

9. **Add heartbeat or health checking.**

Registration only tells ESP32:

> Node existed at this address at some point.

You also want to know:

> Is Node still alive?

Node could provide:

```http
GET /api/health
```

returning:

```json
{
  "status": "ok"
}
```

ESP32 periodically checks:

```text
http://<kioskIp>:3000/api/health
```

For example:

```text
Every 5 seconds

ESP32
   |
   v
GET /api/health
   |
   +--> 200 OK
   |       ↓
   |     READY
   |
   +--> timeout
           ↓
       DISCONNECTED
```

For a coin-operated kiosk, this is important.

---

10. **Disable payment when Node is unavailable.**

This is where your architecture becomes much safer.

Do not allow:

```text
Customer inserts ₱20
        ↓
Node is dead
        ↓
transaction lost
```

Instead:

```text
kioskRegistered == false
        OR
heartbeat failed
        ↓
Coin acceptor disabled
        ↓
Maintenance Mode
```

Conceptually:

```cpp
if (!kioskRegistered) {
    disableCoinAcceptor();
}
```

and:

```cpp
if (kioskHealthy) {
    enableCoinAcceptor();
}
```

Your UI can display:

```text
PrintBit temporarily unavailable

Reconnecting to kiosk controller...
```

---

11. **Audit the C# Worker for IP dependencies.**

The C# Worker should not need to participate in ESP32 discovery unless it directly communicates with ESP32.

Search the Worker repo for:

```text
192.168.
192.168.4.2
:3000
localhost
127.0.0.1
```

If you see:

```csharp
http://192.168.4.2:3000
```

and the Worker is communicating with Node on the same tablet, replace it with:

```csharp
http://127.0.0.1:3000
```

The ideal architecture is:

```text
                 NETWORK

ESP32 192.168.4.1
        |
        |
        v
Node.js :3000
        |
        | localhost
        |
        v
C# Worker
        |
        |
 Windows Printer API
        |
        v
 Epson L5290
```

C# shouldn't care whether the tablet is `.2`, `.3`, or `.50`.

It operates locally.

---

12. **Centralize all addresses into configuration constants.**

Node.js:

```ts
export const networkConfig = {
  port: 3000,
  host: '0.0.0.0',
  esp32Url: 'http://192.168.4.1',
};
```

ESP32:

```cpp
const IPAddress PRINTBIT_AP_IP(
    192, 168, 4, 1
);

const uint16_t KIOSK_DEFAULT_PORT = 3000;
```

C#:

```csharp
public static class NetworkConfig
{
    public const string NodeBaseUrl =
        "http://127.0.0.1:3000";
}
```

Do not scatter:

```text
192.168.4.1
192.168.4.2
3000
```

through dozens of files.

---

## The final configuration I recommend

```text
ESP32
────────────────────────────
AP IP:
192.168.4.1

Mode:
WIFI_AP_STA

Responsibilities:
Wi-Fi AP
Coin acceptor
Hopper
Hardware events
Kiosk registration
Heartbeat monitoring


WINDOWS TABLET
────────────────────────────
Preferred/static:
192.168.4.2

Subnet:
255.255.255.0

Gateway:
192.168.4.1


NODE.JS
────────────────────────────
Listen:
0.0.0.0:3000

ESP32:
http://192.168.4.1

Startup:
POST /kiosk/register

Health:
GET /api/health


C# WORKER
────────────────────────────
Node.js:
http://127.0.0.1:3000

No dependency on:
192.168.4.2
```

### Priority order

If you're writing an implementation plan or GitHub issue, I would divide it into these phases:

```text
Phase 1
Windows static network
192.168.4.2

        ↓

Phase 2
ESP32 fixed AP
192.168.4.1

        ↓

Phase 3
Node
0.0.0.0:3000

        ↓

Phase 4
Node → ESP32
/kiosk/register

        ↓

Phase 5
ESP32 removes hardcoded .4.2

        ↓

Phase 6
Heartbeat + reconnect

        ↓

Phase 7
C# audit
localhost only

        ↓

Phase 8
Payment safety /
Maintenance Mode
```

So the **actual coding task belongs primarily to ESP32 and Node.js**. Windows static configuration should still be done because this is a fixed kiosk appliance, but it should be treated as the first layer of stability, not your only protection. The C# Worker should ideally remain network-address agnostic and communicate with Node locally through `127.0.0.1`.
