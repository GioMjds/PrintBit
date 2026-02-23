import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { db } from "./db";
import { Server } from "socket.io";

const ACCEPTED_COINS = new Set([1, 5, 10, 20]);
const FRAGMENT_WINDOW_MS = 140;

export async function initSerial(io: Server) {
  try {
    const ports = await SerialPort.list();

    if (!ports.length) {
      console.warn(
        "No serial ports found. Continuing without serial connection.",
      );
      return;
    }

    const portPath = ports[0].path;
    const port = new SerialPort({
      path: portPath,
      baudRate: 9600,
    });
    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    let pendingPrefix: "1" | "2" | null = null;
    let pendingTimer: NodeJS.Timeout | null = null;

    const clearPending = () => {
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingPrefix = null;
      pendingTimer = null;
    };

    const persistBalance = async (coinValue: number) => {
      db.data!.balance += coinValue;
      await db.write();
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
        return;
      }

      if (!ACCEPTED_COINS.has(value)) {
        io.emit("coinParserWarning", {
          code: "UNSUPPORTED_COIN",
          message: `Ignored unsupported coin '${value}'.`,
        });
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
  } catch (error) {
    console.error(
      "Error initializing serial port. Continuing without serial connection.",
      error,
    );
  }
}
