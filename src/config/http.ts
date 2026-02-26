import os from "node:os";
import path from "node:path";

export const PORT = 3000;
export const UPLOAD_DIR = "uploads/";
export const PORTAL_ASSETS = new Set(["styles.css", "app.js"]);
export const PORTAL_DIR = path.resolve("src/public/upload");
export const PUBLIC_DIR = path.resolve("src/public");
export const PREVIEW_CACHE_DIR = path.join(os.tmpdir(), "printbit-preview-cache");

export const PUBLIC_PAGE_ROUTES: Array<{ route: string; filePath: string }> = [
  { route: "/", filePath: path.join(PUBLIC_DIR, "index.html") },
  { route: "/print", filePath: path.join(PUBLIC_DIR, "print", "index.html") },
  { route: "/copy", filePath: path.join(PUBLIC_DIR, "copy", "index.html") },
  { route: "/config", filePath: path.join(PUBLIC_DIR, "config", "index.html") },
  { route: "/confirm", filePath: path.join(PUBLIC_DIR, "confirm", "index.html") },
  { route: "/scan", filePath: path.join(PUBLIC_DIR, "scan", "index.html") },
  { route: "/admin", filePath: path.join(PUBLIC_DIR, "admin", "index.html") },
];
