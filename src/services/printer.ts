import { exec } from "node:child_process";
import path from "node:path";
import {
  ThermalPrinter,
  PrinterTypes,
  CharacterSet,
  BreakLine,
} from "node-thermal-printer";

export function printFile(filename: string) {
  const filePath = path.resolve("uploads", filename);
  exec(`print "${filePath}"`);
}
