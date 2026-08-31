For PrintBit, I recommend a **fixed, offline-first kiosk network architecture**, but I would not make the Node.js server depend on the ESP32-assigned IP address at startup.

The most important change is this:

> **Express should start independently of the ESP32 network.**
>
> The kiosk UI should always use `localhost`, while the ESP32 Wi-Fi subnet is only used for devices that actually need LAN access.

## Recommended PrintBit architecture

```text
                   PRINTBIT KIOSK
┌─────────────────────────────────────────────────────┐
│ Windows Tablet                                      │
│                                                     │
│  Edge Kiosk                                         │
│      │                                              │
│      │ http://127.0.0.1:3000                       │
│      ▼                                              │
│  Node.js + Express                                  │
│      │                                              │
│      │ localhost IPC / HTTP / WebSocket             │
│      ▼                                              │
│  C# PrintBit Worker                                 │
│      │                    │                         │
│      │ USB / Serial        │ Windows APIs / USB     │
│      ▼                    ▼                         │
│    ESP32                Epson L5290                 │
│                                                     │
│  Wi-Fi adapter                                     │
│  Static IP: 10.77.0.2                              │
└──────────────┬──────────────────────────────────────┘
               │
               │ Wi-Fi
               ▼
┌─────────────────────────────────────────────────────┐
│ ESP32 SoftAP                                        │
│                                                     │
│ SSID: PrintBit                                      │
│ IP:   10.77.0.1                                     │
│ Mask: 255.255.255.0                                 │
│                                                     │
│ DHCP pool:                                          │
│ 10.77.0.100 - 10.77.0.199                           │
└──────────────┬──────────────────────────────────────┘
               │
        ┌──────┴───────┐
        ▼              ▼
   Admin phone     Customer phone
   10.77.0.x       10.77.0.x

Customer upload:
http://10.77.0.2:3000/upload
```

This is the architecture I would deploy before introducing a captive portal.

---

# 1. Do not use `10.0.0.1`

Technically, `10.0.0.1` will work. It is not inherently more stable than `192.168.4.1`.

The stability comes from **static network configuration**, not from choosing `10.x.x.x`.

I would instead choose something uncommon and PrintBit-specific, such as:

```text
Network:     10.77.0.0/24

ESP32:       10.77.0.1
Tablet:      10.77.0.2

DHCP:
10.77.0.100
through
10.77.0.199
```

Why avoid `10.0.0.1`?

Because these are extremely common:

```text
192.168.0.0/24
192.168.1.0/24
192.168.4.0/24
10.0.0.0/24
10.0.1.0/24
```

If PrintBit later gains another Wi-Fi/Ethernet interface, VPN, router, or Internet connection, overlapping subnets can cause confusing routing problems.

`10.77.0.0/24` is still a valid private network but is less likely to collide.

---

# 2. Your ESP32 and tablet must have different IPs

This part of your existing configuration is particularly important.

You should never have:

```text
ESP32  = 192.168.4.2
Tablet = 192.168.4.2
```

That causes an IP conflict.

Every interface must have its own address.

For the proposed architecture:

```text
ESP32
10.77.0.1

Windows tablet
10.77.0.2
```

Then phones receive:

```text
10.77.0.100
10.77.0.101
10.77.0.102
...
```

---

# 3. Give the ESP32 a permanent SoftAP IP

Arduino ESP32 supports configuring the SoftAP interface with a fixed IP, gateway, and subnet through `softAPConfig()`. ([Espressif Systems][1])

I would configure it approximately like this:

```cpp
#include <WiFi.h>

const char* WIFI_SSID = "PrintBit";
const char* WIFI_PASSWORD = "your-secure-password";

IPAddress apIP(
  10, 77, 0, 1
);

IPAddress gateway(
  10, 77, 0, 1
);

IPAddress subnet(
  255, 255, 255, 0
);

IPAddress dhcpStart(
  10, 77, 0, 100
);

void setup() {
  Serial.begin(115200);

  WiFi.mode(WIFI_AP);

  bool configured = WiFi.softAPConfig(
    apIP,
    gateway,
    subnet,
    dhcpStart
  );

  if (!configured) {
    Serial.println("[WiFi] SoftAP configuration failed");
    ESP.restart();
  }

  bool started = WiFi.softAP(
    WIFI_SSID,
    WIFI_PASSWORD,
    6,      // channel
    0,      // SSID visible
    4       // max clients
  );

  if (!started) {
    Serial.println("[WiFi] SoftAP failed");
    ESP.restart();
  }

  Serial.println("[WiFi] PrintBit AP started");

  Serial.print("[WiFi] IP: ");
  Serial.println(WiFi.softAPIP());
}

void loop() {
}
```

The current Arduino-ESP32 source exposes the optional DHCP lease-start argument on `softAPConfig()`, which lets you deliberately start DHCP away from addresses reserved for infrastructure devices. ([GitHub][2])

That gives you:

```text
10.77.0.1      ESP32
10.77.0.2      reserved for kiosk
10.77.0.3-99   reserved for future infrastructure

10.77.0.100+
DHCP devices
```

That is substantially cleaner than letting the tablet randomly become `.2`, `.3`, `.4`, etc.

---

# 4. Do not make Express listen specifically on `10.77.0.2`

This is probably one of the biggest improvements you can make.

Avoid:

```ts
app.listen(3000, "10.77.0.2");
```

Because if the Windows Wi-Fi adapter has not initialized yet when PrintBit boots, Express can fail with an address binding error.

Instead:

```ts
const PORT = 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`PrintBit server running on port ${PORT}`);
});
```

`0.0.0.0` means:

> Listen on all available network interfaces.

The server does not need to know whether Windows currently owns:

```text
10.77.0.2
```

or another interface.

This eliminates the ESP32 IP from the **server startup dependency chain**.

---

# 5. The kiosk UI should always use `localhost`

This is another major architectural improvement.

Do not launch Edge with:

```text
http://10.77.0.2:3000
```

Use:

```text
http://127.0.0.1:3000
```

or:

```text
http://localhost:3000
```

Your kiosk browser and Node server are on the same machine.

Therefore the network should be:

```text
Edge
  ↓
127.0.0.1:3000
  ↓
Express
```

Not:

```text
Edge
  ↓
ESP32 WiFi
  ↓
10.77.0.2
  ↓
Express
```

There is no benefit to putting the ESP32 network in that loop.

### Result

Even if:

```text
ESP32 Wi-Fi crashes
ESP32 restarts
Wi-Fi disconnects
Windows reconnects
DHCP fails
```

your kiosk interface can still load:

```text
http://localhost:3000
```

That is exactly the type of isolation you want in unattended kiosk software.

---

# 6. External phones use `10.77.0.2`

There are therefore two addresses for the same Express application.

### Kiosk itself

```text
http://127.0.0.1:3000
```

### Devices connected to PrintBit Wi-Fi

```text
http://10.77.0.2:3000
```

So later your QR code could contain something like:

```text
http://10.77.0.2:3000/upload
```

or preferably:

```text
http://10.77.0.2:3000/upload?t=<temporary-token>
```

The customer:

```text
Scan QR
    ↓
Connect to PrintBit Wi-Fi
    ↓
Open upload URL
    ↓
10.77.0.2:3000
    ↓
Express
```

You do **not** need a captive portal for this architecture.

A captive portal can be added later as a UX improvement.

---

# 7. Keep critical ESP32 hardware events off Wi-Fi

For PrintBit specifically, I would make this an architectural rule:

> **Wi-Fi failure should never cause coin accounting, hopper control, or printing state to fail.**

For example:

```text
Coin acceptor
      ↓
    ESP32
      ↓
USB Serial
      ↓
C# Worker
      ↓
TransactionStateMachine
      ↓
Express / WebSocket
      ↓
UI
```

Instead of:

```text
Coin acceptor
      ↓
ESP32
      ↓
Wi-Fi
      ↓
Express
```

The first design is much safer for a payment-related kiosk.

Your ESP32 can continue handling:

```text
CoinInserted
HopperCompleted
Heartbeat
hardware commands
sensor state
```

through the dedicated local hardware channel.

Wi-Fi then becomes responsible for things like:

```text
customer uploads
admin phone
device discovery
maintenance UI
```

rather than controlling the transaction itself.

---

# 8. C# Worker should also use localhost

The same principle applies between Node.js and the C# Worker.

For example:

```text
Express
   │
   │ http://127.0.0.1:xxxx
   │ WebSocket
   │ Named Pipe
   ▼
C# Worker
```

Do not use:

```text
10.77.0.2
```

for communication between applications running on the same Windows machine.

You want the system to behave like:

```text
                   Windows Tablet
             ┌─────────────────────────┐

 Browser ─── localhost ─── Express

                         │
                      localhost
                         │
                         ▼

                      Worker
                         │
                ┌────────┴─────────┐
                ▼                  ▼
             ESP32              Printer
             Serial             Windows

             └─────────────────────────┘
```

The network is therefore no longer part of the critical processing path.

---

# 9. Set the Windows tablet to `10.77.0.2`

If that Wi-Fi adapter is dedicated to PrintBit, you can statically configure it.

For example, first identify it:

```powershell
Get-NetAdapter
```

Then:

```powershell
Set-NetIPInterface `
    -InterfaceAlias "Wi-Fi" `
    -AddressFamily IPv4 `
    -Dhcp Disabled
```

Then:

```powershell
New-NetIPAddress `
    -InterfaceAlias "Wi-Fi" `
    -IPAddress 10.77.0.2 `
    -PrefixLength 24
```

You technically do not need a default gateway for communication inside:

```text
10.77.0.0/24
```

because all devices are local.

If later you use the ESP32 for NAT/Internet routing, that architecture changes.

One warning: Windows static IP configuration applies to the network adapter, so this is appropriate when the adapter is essentially dedicated to the PrintBit network.

---

# 10. Recommended startup sequence

I would make the kiosk startup independent and fault tolerant:

```text
Windows starts
   ↓
PrintBit Worker Service starts
   ↓
Express starts on 0.0.0.0:3000
   ↓
Edge kiosk starts
   ↓
http://127.0.0.1:3000
```

Separately:

```text
ESP32 boots
   ↓
Creates PrintBit Wi-Fi
   ↓
10.77.0.1
   ↓
Windows connects
   ↓
Windows = 10.77.0.2
```

Then:

```text
Worker detects ESP32
   ↓
hardwareReady = true
```

If the ESP32 is unavailable:

```text
UI still loads

Printer status still loads

Admin UI still loads

But:

Payments unavailable
Hardware unavailable
```

That is graceful degradation.

It is much better than:

```text
ESP32 unavailable
      ↓
IP unavailable
      ↓
Express cannot start
      ↓
Entire kiosk unavailable
```

---

# 11. Add health states instead of assuming everything is connected

Your backend can expose something like:

```http
GET /api/health
```

Returning:

```json
{
  "server": "online",
  "worker": "online",
  "esp32": "online",
  "printer": "online",
  "network": "online",
  "ready": true
}
```

Your startup screen can then determine whether PrintBit is actually ready.

For example:

```text
Initializing PrintBit...

✓ Server
✓ Worker
✓ ESP32
✓ Coin acceptor
✓ Hopper
✓ Printer

Ready
```

If ESP32 disappears:

```text
✓ Server
✓ Worker
✗ ESP32
- Coin acceptor
- Hopper
✓ Printer

Hardware unavailable
```

This is much more production-oriented than coupling application startup to one IP.

---

# 12. What I would deploy for PrintBit now

My recommended configuration is:

| Component        | Configuration           |
| ---------------- | ----------------------- |
| ESP32 Wi-Fi mode | SoftAP                  |
| ESP32 IP         | `10.77.0.1`             |
| Subnet           | `255.255.255.0`         |
| Tablet           | `10.77.0.2`             |
| DHCP clients     | `10.77.0.100-199`       |
| SSID             | `PrintBit`              |
| Express binding  | `0.0.0.0:3000`          |
| Kiosk URL        | `http://127.0.0.1:3000` |
| Phone upload URL | `http://10.77.0.2:3000` |
| Node ↔ C#        | localhost               |
| C# ↔ ESP32       | USB/serial              |
| C# ↔ printer     | Windows/USB             |
| Captive portal   | Not required yet        |

Espressif explicitly supports SoftAP operation and static SoftAP addressing, and the AP mode includes DHCP support for connected stations. ([Espressif Systems][1])

## Longer-term production architecture

There is one further improvement I would consider after PrintBit is stable:

```text
               Dedicated router/AP
                   10.77.0.1
                 /     |      \
                /      |       \
           Tablet    ESP32    Phones
          .2        .10       DHCP
```

Then the ESP32 stops being responsible for being the network infrastructure.

That is the stronger production architecture if PrintBit eventually has many customer phones connecting simultaneously.

But **I would not add that complexity right now**. With the current architecture, a carefully configured ESP32 SoftAP is adequate for a small number of connected clients. Arduino's SoftAP API also allows configuring the maximum number of clients. ([Espressif Systems][1])

The immediate refactor I would prioritize is:

```text
1. ESP32 → 10.77.0.1 static
2. Tablet → 10.77.0.2 static
3. DHCP → .100+
4. Express → 0.0.0.0
5. Edge → localhost:3000
6. Node ↔ Worker → localhost
7. Critical hardware → serial, not Wi-Fi
```

That removes the IP-change problem from PrintBit's core architecture instead of merely replacing `192.168.4.2` with another hard-coded address.

[1]: https://docs.espressif.com/projects/arduino-esp32/en/latest/api/wifi.html?utm_source=chatgpt.com "Wi-Fi API - - — Arduino ESP32 latest documentation"
[2]: https://github.com/espressif/arduino-esp32/blob/master/libraries/WiFi/src/WiFiAP.h?utm_source=chatgpt.com "arduino-esp32/libraries/WiFi/src/WiFiAP.h at master · espressif/arduino-esp32 · GitHub"
