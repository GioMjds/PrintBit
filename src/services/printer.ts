import { exec } from "node:child_process";
import path from "node:path";

export function printFile(filename: string) {
  const filePath = path.resolve("uploads", filename);
  exec(`print "${filePath}"`);
}
