# PrintBit ESP32 Wi-Fi & Firmware Setup Guide

This guide covers flashing, initial boot, dynamic network configuration, and over-the-air administration for the updated [`esp32-captive-portal.ino`](file:///C:/Users/printbit/printbit/esp32-captive-portal.ino) firmware.

---

## 1. Network Architecture Overview

The PrintBit firmware operates in **Dual AP + STA Mode** (`WIFI_AP_STA`):

```diagram
                                ESP32 Dual Mode
                                ┌──────────────┐
                                │    ESP32     │
                                └───────┬──────┘
                   ┌────────────────────┴────────────────────┐
                   ▼                                         ▼
            STA Mode (Background)                     AP Mode (PrintBit)
                   │                                         │
        External Router / Campus Wi-Fi             Dedicated Kiosk Subnet
        (Optional internet/telemetry)              SSID: PrintBit (192.168.4.1)
                   │                                         │
        • Configured via /setup portal             • Windows Kiosk (192.168.4.x)
        • Non-blocking reconnect loop              • Customer Mobile Uploads
        • Never interrupts printing/coins          • Direct mDNS Admin Gateway
```

### Key Features

- **Zero Hardcoded Credentials:** Network credentials and IP endpoints are persisted in ESP32 Flash Memory (NVS via `<Preferences.h>`).
- **mDNS Admin Gateway (`http://printbit.local/admin`):** Admins can open the dashboard from any phone without knowing the kiosk's dynamic IP address.
- **OTA Wi-Fi Setup Portal (`http://printbit.local/setup`):** Change router credentials or update AP passwords over the air without reflashing firmware.
- **Serial-First Concurrency:** Coin pulses and hopper dispense signals execute with microsecond accuracy independently of Wi-Fi state.

---

## 2. Flashing the Firmware

### Hardware Requirements

- **Microcontroller:** ESP32 Dev Module (ESP32-WROOM-32 or ESP32-WROVER)
- **Connection:** Micro-USB / USB-C data cable connected to the Kiosk PC

### Arduino IDE Configuration

1. Open [`esp32-captive-portal.ino`](file:///C:/Users/printbit/printbit/esp32-captive-portal.ino) in Arduino IDE 2.x.
2. In **Tools** menu, configure the following:
   - **Board:** `ESP32 Dev Module` (from `esp32` board package by Espressif, version 2.0.x or 3.0.x)
   - **Upload Speed:** `921600` (or `115200` if connection is unstable)
   - **CPU Frequency:** `240MHz (WiFi/BT)`
   - **Flash Frequency:** `80MHz`
   - **Flash Mode:** `QIO`
   - **Flash Size:** `4MB (32Mb)`
   - **Partition Scheme:** `Default 4MB with spiffs (1.2MB APP/1.5MB SPIFFS)`
   - **Core Debug Level:** `None` (or `Info` during development)
   - **Port:** Select your ESP32 COM port (e.g. `COM3`, `COM4`)
3. Click **Upload** (Ctrl + U).
4. After upload completes, open the **Serial Monitor** at **`115200 baud`**.

> [!NOTE]
> All required libraries (`WiFi.h`, `Preferences.h`, `ESPmDNS.h`, `DNSServer.h`, `NetworkServer.h`) are built into the standard official ESP32 Arduino Core — no extra third-party libraries needed!

---

## 3. Initial Boot & Factory Defaults

On first boot (or after clearing NVS flash), the firmware automatically initializes with these defaults:

| Parameter             | Factory Default | Description                               |
| --------------------- | --------------- | ----------------------------------------- |
| **AP SSID**           | `PrintBit`      | Customer upload & admin Wi-Fi network     |
| **AP Password**       | `printbit123`   | WPA2-PSK password for kiosk Wi-Fi         |
| **AP Gateway IP**     | `192.168.4.1`   | Static IP of the ESP32 Access Point       |
| **Kiosk IP**          | `192.168.4.2`   | Kiosk server IP (auto-updated by Node.js) |
| **Kiosk Port**        | `3000`          | Node.js Express server port               |
| **Kiosk Portal Path** | `/portal`       | Captive portal landing page               |
| **STA SSID / Pass**   | _(empty)_       | Unset until configured via `/setup`       |

---

## 4. Setting Up the Kiosk PC / Windows Tablet

1. **Connect Kiosk PC to ESP32:**
   - Plug the ESP32 into a USB port on the Kiosk PC.
   - Connect the Kiosk PC's Wi-Fi adapter to the SSID **`PrintBit`** (password: **`printbit123`**).
2. **Start the PrintBit Node.js Server:**

   ```bash
   pnpm dev
   ```

   Or in production:

   ```bash
   pnpm start
   ```

3. **Automatic Synchronization:**
   - Node.js detects the serial port and automatically sends:
     `KIOSK_IP <your-local-ip> 3000 /portal`
   - The ESP32 saves this IP into flash memory and responds:
     `KIOSK_IP_UPDATED:<your-local-ip>`
   - The kiosk QR code and customer captive portal redirects will automatically target your active IP!

---

## 5. Accessing the Admin Dashboard from Phone / Tablet

Admins no longer need to know the kiosk's internal IP address or port:

1. Connect your smartphone to the **`PrintBit`** Wi-Fi.
2. Open your mobile browser (Safari, Chrome, Firefox, etc.).
3. Navigate to either:
   - **`http://printbit.local/admin`** (recommended)
   - **`http://192.168.4.1/admin`**
4. The ESP32 will automatically issue a 302 redirect directly to the active Kiosk Admin Dashboard (`/admin/dashboard`)!

---

## 6. Configuring External Router Wi-Fi (Over-the-Air Setup Portal)

To give the ESP32 access to campus/venue Wi-Fi for time synchronization, remote admin, or telemetry without touching Arduino code:

1. Connect your phone or laptop to **`PrintBit`** Wi-Fi.
2. Navigate to:
   - **`http://printbit.local/setup`** (or `http://192.168.4.1/setup`)
3. The Setup Portal page will load:
   - **Nearby Wi-Fi Networks:** Pick your venue/home Wi-Fi SSID from the dropdown.
   - **Wi-Fi Password:** Enter the network password.
   - **PrintBit AP Password (Optional):** Enter a new password if you wish to change the `PrintBit` AP password.
4. Tap **"Save & Connect"**.
5. The ESP32 will:
   - Save the credentials to NVS flash memory.
   - Initiate background connection to the router in STA mode.
   - Keep the `PrintBit` AP active (no customer disruption).
   - Announce `STA_IP:<router-assigned-ip>` over Serial once connected.

---

## 7. Serial Management & Diagnostics Reference

When connected via USB Serial at **`115200 baud`**, you can issue manual ASCII commands or monitor real-time telemetry:

### Available Inbound Commands (PC -> ESP32)

- `KIOSK_IP <ip> [port] [path]` — Update the registered kiosk endpoint in NVS flash.
- `WIFI_STATUS` — Print current AP and STA status, MAC addresses, and IP assignments.
- `WIFI_DISCONNECT` — Disconnect from external router and clear STA state.
- `HOPPER_DISPENSE:<count>[:<reqId>]` — Dispense coins from the physical hopper.
- `HOPPER_STATUS` — Check hopper readiness, motor state, and optical sensor.

### Telemetry Events Output by ESP32 (ESP32 -> PC)

- `AP_IP:<ip>` — ESP32 Access Point IP (e.g. `192.168.4.1`).
- `STA_IP:<ip>` — External router LAN IP assigned to ESP32.
- `KIOSK_IP:<ip>` — Active kiosk server IP confirmed by ESP32.
- `WIFI_STA_CONNECTING:<ssid>` — ESP32 started connecting to router.
- `WIFI_STA_CONNECTED` — ESP32 successfully connected to router.
- `WIFI_STA_DISCONNECTED` — ESP32 lost or closed router connection.
- `coin_pulse:<val>` — Instant coin insertion pulse for real-time payment credit.

---

## 8. Troubleshooting Checklist

| Symptom                                                   | Cause                                                                   | Solution                                                                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `http://printbit.local/admin` does not resolve on Android | Some older Android versions do not support local mDNS queries in Chrome | Use `http://192.168.4.1/admin` instead.                                                                                                |
| Port access denied during `pnpm dev`                      | Arduino IDE Serial Monitor is open on the same COM port                 | Close Arduino IDE Serial Monitor before starting Node.js.                                                                              |
| External Wi-Fi does not connect                           | 5GHz network selected                                                   | ESP32 only supports 2.4GHz Wi-Fi networks (802.11 b/g/n). Select a 2.4GHz SSID in `/setup`.                                            |
| Kiosk IP mismatch                                         | Kiosk PC joined on a different subnet adapter                           | Node.js automatically detects the `192.168.4.x` adapter and re-announces over Serial on boot. Verify Wi-Fi is connected to `PrintBit`. |
