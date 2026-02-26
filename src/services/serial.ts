import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { db } from "./db";
import { Server } from "socket.io";
import { appendAdminLog, incrementCoinStats } from "./admin";

const ACCEPTED_COINS = new Set([1, 5, 10, 20]);
const FRAGMENT_WINDOW_MS = 140;

let serialConnected = false;
let serialPortPath: string | null = null;
let serialLastError: string | null = null;

export function getSerialStatus() {
  return {
    connected: serialConnected,
    portPath: serialPortPath,
    lastError: serialLastError,
  };
}

export async function initSerial(io: Server) {
  try {
    const ports = await SerialPort.list();

    if (!ports.length) {
      serialConnected = false;
      serialPortPath = null;
      serialLastError = "No serial ports found.";
      console.warn(
        "No serial ports found. Continuing without serial connection.",
      );
      return;
    }

    const portPath = ports[0].path;
    serialPortPath = portPath;
    const port = new SerialPort({
      path: portPath,
      baudRate: 9600,
    });
    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    port.on("open", () => {
      serialConnected = true;
      serialLastError = null;
      io.emit("serialStatus", getSerialStatus());
    });

    port.on("close", () => {
      serialConnected = false;
      io.emit("serialStatus", getSerialStatus());
    });

    port.on("error", (error) => {
      serialConnected = false;
      serialLastError = error.message;
      io.emit("serialStatus", getSerialStatus());
      console.error("Serial port runtime error:", error);
    });

    let pendingPrefix: "1" | "2" | null = null;
    let pendingTimer: NodeJS.Timeout | null = null;

    const clearPending = () => {
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingPrefix = null;
      pendingTimer = null;
    };

    const persistBalance = async (coinValue: number) => {
      db.data!.balance += coinValue;
      await incrementCoinStats(coinValue);
      await appendAdminLog("coin_accepted", `Accepted coin: ${coinValue}`, {
        coinValue,
        balance: db.data!.balance,
      });
      io.emit("balance", db.data!.balance);
      io.emit("coinAccepted", { value: coinValue, balance: db.data!.balance });
    };

    const flushPending = async (reason: "timeout" | "interrupted") => {
      if (!pendingPrefix) return;
      const prefix = pendingPrefix;
      clearPending();

      if (prefix === "1") {
        await persistBalance(1);
        return;
      }

      io.emit("coinParserWarning", {
        code: "INVALID_FRAGMENT",
        message: `Ignored fragment '${prefix}' (${reason}).`,
      });
      void appendAdminLog(
        "coin_parser_warning",
        `Ignored fragment '${prefix}' (${reason}).`,
        { reason },
      );
    };

    const armPending = (prefix: "1" | "2") => {
      clearPending();
      pendingPrefix = prefix;
      pendingTimer = setTimeout(() => {
        void flushPending("timeout");
      }, FRAGMENT_WINDOW_MS);
    };

    const processToken = async (token: string) => {
      if (pendingPrefix) {
        if (token === "0") {
          const combined = Number(`${pendingPrefix}${token}`);
          clearPending();
          if (ACCEPTED_COINS.has(combined)) {
            await persistBalance(combined);
          } else {
            io.emit("coinParserWarning", {
              code: "INVALID_COMBINATION",
              message: `Ignored invalid coin '${combined}'.`,
            });
            void appendAdminLog(
              "coin_parser_warning",
              `Ignored invalid coin '${combined}'.`,
              { combined },
            );
          }
          return;
        }

        await flushPending("interrupted");
      }

      if (token === "1" || token === "2") {
        armPending(token);
        return;
      }

      const value = Number(token);
      if (!Number.isInteger(value)) {
        io.emit("coinParserWarning", {
          code: "NON_NUMERIC",
          message: `Ignored serial token '${token}'.`,
        });
        void appendAdminLog(
          "coin_parser_warning",
          `Ignored non-numeric serial token '${token}'.`,
          { token },
        );
        return;
      }

      if (!ACCEPTED_COINS.has(value)) {
        io.emit("coinParserWarning", {
          code: "UNSUPPORTED_COIN",
          message: `Ignored unsupported coin '${value}'.`,
        });
        void appendAdminLog(
          "coin_parser_warning",
          `Ignored unsupported coin '${value}'.`,
          { value },
        );
        return;
      }

      await persistBalance(value);
    };

    parser.on("data", (rawLine: string) => {
      const token = rawLine.trim().replace(/[^0-9]/g, "");
      if (!token) return;
      void processToken(token);
    });

    console.log(`Serial port initialized on ${portPath}`);
    void appendAdminLog("serial_connected", `Serial port initialized on ${portPath}`, {
      portPath,
    });
  } catch (error) {
    serialConnected = false;
    serialLastError = error instanceof Error ? error.message : "Unknown serial error.";
    console.error(
      "Error initializing serial port. Continuing without serial connection.",
      error,
    );
    void appendAdminLog(
      "serial_init_error",
      "Error initializing serial port. Continuing without serial connection.",
      { message: serialLastError },
    );
  }
}
