import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";

type Schema = {
  balance: number;
  earnings: number;
}

const adapter = new JSONFile<Schema>("db.json");
export const db = new Low(adapter, { balance: 0, earnings: 0 });

export async function initDB() {
  try {
    await db.read();
  } catch (err) {
    // If the file is empty or malformed, initialize with defaults
    db.data = { balance: 0, earnings: 0 };
    await db.write();
    return;
  }

  db.data ||= { balance: 0, earnings: 0 };
  await db.write();
}