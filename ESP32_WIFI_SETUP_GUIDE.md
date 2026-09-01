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

- **Zero Hardcoded Wi-Fi Credentials:** WiFiManager provisions the permanent AP password and optional upstream Wi-Fi through a captive portal. No reusable AP password ships in firmware.
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

> [!IMPORTANT]
> Install **WiFiManager by tzapu** from the Arduino Library Manager before compiling. The remaining networking libraries are supplied by the ESP32 Arduino Core.

---

## 3. Initial Boot and Required Provisioning

On first boot (or after a factory reset), normal kiosk and hardware operation is disabled until an administrator provisions the device:

1. Connect an admin phone or laptop to the open **`PrintBit-Setup`** network.
2. The WiFiManager captive portal opens automatically. If it does not, browse to `http://192.168.4.1`.
3. Enter a required permanent `PrintBit` AP password of 8–63 characters.
4. Optionally select an upstream 2.4 GHz Wi-Fi network and enter its password.
5. Save. The ESP32 stores the permanent AP password in NVS, lets WiFiManager persist optional upstream credentials, and restarts.
6. Reconnect the kiosk and customer devices to **`PrintBit`** using the administrator-defined password.

The open setup AP exists only while the device is unprovisioned. Coin and hopper operations remain disabled in that state.

| Parameter             | Factory Default | Description                               |
| --------------------- | --------------- | ----------------------------------------- |
| **AP SSID**           | `PrintBit`      | Customer upload & admin Wi-Fi network     |
| **AP Password**       | _(required setup)_ | Administrator-defined WPA2-PSK password |
| **AP Gateway IP**     | `192.168.4.1`   | Static IP of the ESP32 Access Point       |
| **Kiosk IP**          | `192.168.4.2`   | Kiosk server IP (auto-updated by Node.js) |
| **Kiosk Port**        | `3000`          | Node.js Express server port               |
| **Kiosk Portal Path** | `/portal`       | Captive portal landing page               |
| **STA SSID / Pass**   | _(optional)_    | Managed by WiFiManager                    |

---

## 4. Setting Up the Kiosk PC / Windows Tablet

1. **Connect Kiosk PC to ESP32:**
   - Plug the ESP32 into a USB port on the Kiosk PC.
   - Connect the Kiosk PC's Wi-Fi adapter to **`PrintBit`** using the password chosen during provisioning.
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

## 6. Reprovisioning Wi-Fi

Send `WIFI_FACTORY_RESET` over USB Serial at 115200 baud. The ESP32 clears both WiFiManager credentials and PrintBit configuration, then restarts with the open `PrintBit-Setup` portal. This is intentionally destructive and also clears the saved kiosk registration; Node.js registers itself again after provisioning.

---

## 7. Serial Management & Diagnostics Reference

When connected via USB Serial at **`115200 baud`**, you can issue manual ASCII commands or monitor real-time telemetry:

### Available Inbound Commands (PC -> ESP32)

- `KIOSK_IP <ip> [port] [path]` — Update the registered kiosk endpoint in NVS flash.
- `WIFI_STATUS` — Print current AP and STA status, MAC addresses, and IP assignments.
- `WIFI_DISCONNECT` — Disconnect from external router and clear STA state.
- `WIFI_FACTORY_RESET` — Clear Wi-Fi and PrintBit NVS configuration, then reboot into required setup mode.
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
| External Wi-Fi does not connect                           | 5GHz network selected                                                   | ESP32 only supports 2.4GHz Wi-Fi networks (802.11 b/g/n). Run `WIFI_FACTORY_RESET` and provision a 2.4GHz SSID.                         |
| Kiosk IP mismatch                                         | Kiosk PC joined on a different subnet adapter                           | Node.js automatically detects the `192.168.4.x` adapter and re-announces over Serial on boot. Verify Wi-Fi is connected to `PrintBit`. |
