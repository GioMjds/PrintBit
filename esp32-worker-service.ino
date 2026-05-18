/**
 * PrintBit Hardware Controller Firmware
 * ESP32 USB Serial Version
 *
 * Responsibilities:
 * - Coin pulse counting
 * - Hopper pulse counting
 * - SSR relay control
 * - Serial event protocol
 * - Minimal deterministic firmware
 *
 * DO NOT place:
 * - business logic
 * - payment validation
 * - retry orchestration
 * - admin logic
 *
 * inside this firmware.
 */

#include <Arduino.h>

// =====================================================
// PIN CONFIGURATION
// =====================================================

static const uint8_t COIN_ACCEPTOR_PIN = 4;
static const uint8_t HOPPER_SENSOR_PIN = 18;
static const uint8_t SSR_RELAY_PIN = 33;

// =====================================================
// SERIAL CONFIG
// =====================================================

static const uint32_t SERIAL_BAUD = 115200;

// =====================================================
// COIN ACCEPTOR CONFIG
// =====================================================

volatile uint32_t coinPulseCount = 0;
volatile uint32_t lastCoinInterrupt = 0;

static const uint32_t COIN_DEBOUNCE_MS = 30;
static const uint32_t COIN_COMPLETE_TIMEOUT_MS = 350;

uint32_t lastCoinPulseTime = 0;
bool coinSequenceActive = false;

// =====================================================
// HOPPER CONFIG
// =====================================================

volatile uint32_t hopperPulseCount = 0;
volatile uint32_t lastHopperInterrupt = 0;

static const uint32_t HOPPER_DEBOUNCE_MS = 5;

bool hopperDispensing = false;
bool stopDispenseRequested = false;

uint32_t hopperTarget = 0;
uint32_t dispenseStartTime = 0;

static const uint32_t DISPENSE_TIMEOUT_MS = 15000;

// =====================================================
// WATCHDOG / HEARTBEAT
// =====================================================

uint32_t lastHeartbeat = 0;
static const uint32_t HEARTBEAT_INTERVAL_MS = 5000;

// =====================================================
// ISR: COIN ACCEPTOR
// =====================================================

void IRAM_ATTR onCoinPulse() {
    uint32_t now = millis();

    if ((now - lastCoinInterrupt) > COIN_DEBOUNCE_MS) {
        coinPulseCount++;
        lastCoinPulseTime = now;
        coinSequenceActive = true;
    }

    lastCoinInterrupt = now;
}

// =====================================================
// ISR: HOPPER SENSOR
// =====================================================

void IRAM_ATTR onHopperPulse() {
    uint32_t now = millis();

    if ((now - lastHopperInterrupt) > HOPPER_DEBOUNCE_MS) {
        hopperPulseCount++;

        if (hopperDispensing && hopperPulseCount >= hopperTarget) {
            stopDispenseRequested = true;
        }
    }

    lastHopperInterrupt = now;
}

// =====================================================
// SERIAL UTILITIES
// =====================================================

void sendEvent(const String& type, const String& payload) {
    Serial.print("{\"event\":\"");
    Serial.print(type);
    Serial.print("\",");
    Serial.print(payload);
    Serial.println("}");
}

// =====================================================
// COIN PROCESSING
// =====================================================

void processCoinSequence() {
    if (!coinSequenceActive) {
        return;
    }

    uint32_t now = millis();

    if ((now - lastCoinPulseTime) >= COIN_COMPLETE_TIMEOUT_MS) {

        uint32_t pulses = coinPulseCount;

        sendEvent(
            "coin_inserted",
            "\"pulses\":" + String(pulses)
        );

        coinPulseCount = 0;
        coinSequenceActive = false;
    }
}

// =====================================================
// HOPPER CONTROL
// =====================================================

void startDispense(uint32_t amount) {

    if (hopperDispensing) {
        sendEvent(
            "error",
            "\"message\":\"hopper_busy\""
        );
        return;
    }

    hopperTarget = amount;
    hopperPulseCount = 0;

    hopperDispensing = true;
    stopDispenseRequested = false;

    dispenseStartTime = millis();

    digitalWrite(SSR_RELAY_PIN, HIGH);

    sendEvent(
        "hopper_started",
        "\"target\":" + String(amount)
    );
}

void stopDispense() {

    digitalWrite(SSR_RELAY_PIN, LOW);

    hopperDispensing = false;

    sendEvent(
        "hopper_done",
        "\"dispensed\":" + String(hopperPulseCount)
    );
}

void processHopper() {

    if (!hopperDispensing) {
        return;
    }

    if (stopDispenseRequested) {
        stopDispenseRequested = false;
        stopDispense();
        return;
    }

    uint32_t now = millis();

    if ((now - dispenseStartTime) >= DISPENSE_TIMEOUT_MS) {

        digitalWrite(SSR_RELAY_PIN, LOW);

        hopperDispensing = false;

        sendEvent(
            "hopper_timeout",
            "\"dispensed\":" + String(hopperPulseCount)
        );
    }
}

// =====================================================
// SERIAL COMMANDS
// =====================================================

void handleCommand(String line) {

    line.trim();

    // -------------------------
    // PING
    // -------------------------

    if (line == "PING") {

        sendEvent(
            "pong",
            "\"status\":\"ok\""
        );

        return;
    }

    // -------------------------
    // DISPENSE:<amount>
    // -------------------------

    if (line.startsWith("DISPENSE:")) {

        String value = line.substring(10);

        uint32_t amount = value.toInt();

        if (amount <= 0) {

            sendEvent(
                "error",
                "\"message\":\"invalid_dispense_amount\""
            );

            return;
        }

        startDispense(amount);
        return;
    }

    // -------------------------
    // STOP
    // -------------------------

    if (line == "STOP") {

        stopDispenseRequested = true;

        sendEvent(
            "hopper_stopping",
            "\"status\":\"requested\""
        );

        return;
    }

    // -------------------------
    // STATUS
    // -------------------------

    if (line == "STATUS") {

        sendEvent(
            "status",
            "\"hopperDispensing\":" + String(hopperDispensing ? "true" : "false") +
            ",\"hopperCount\":" + String(hopperPulseCount)
        );

        return;
    }

    // -------------------------
    // UNKNOWN COMMAND
    // -------------------------

    sendEvent(
        "error",
        "\"message\":\"unknown_command\""
    );
}

// =====================================================
// SERIAL PROCESSING
// =====================================================

String serialBuffer = "";

void processSerial() {

    while (Serial.available()) {

        char c = Serial.read();

        if (c == '\n') {

            handleCommand(serialBuffer);
            serialBuffer = "";

        } else {

            serialBuffer += c;

            if (serialBuffer.length() > 128) {
                serialBuffer = "";
            }
        }
    }
}

// =====================================================
// HEARTBEAT
// =====================================================

void processHeartbeat() {

    uint32_t now = millis();

    if ((now - lastHeartbeat) >= HEARTBEAT_INTERVAL_MS) {

        lastHeartbeat = now;

        sendEvent(
            "heartbeat",
            "\"uptime\":" + String(millis())
        );
    }
}

// =====================================================
// SETUP
// =====================================================

void setup() {

    Serial.begin(SERIAL_BAUD);

    pinMode(COIN_ACCEPTOR_PIN, INPUT_PULLUP);
    pinMode(HOPPER_SENSOR_PIN, INPUT_PULLUP);

    pinMode(SSR_RELAY_PIN, OUTPUT);

    digitalWrite(SSR_RELAY_PIN, LOW);

    attachInterrupt(
        digitalPinToInterrupt(COIN_ACCEPTOR_PIN),
        onCoinPulse,
        FALLING
    );

    attachInterrupt(
        digitalPinToInterrupt(HOPPER_SENSOR_PIN),
        onHopperPulse,
        FALLING
    );

    sendEvent(
        "boot",
        "\"status\":\"ready\""
    );
}

// =====================================================
// LOOP
// =====================================================

void loop() {

    processSerial();

    processCoinSequence();

    processHopper();

    processHeartbeat();
}