import os from "os";
import express from "express";
import type { Request, Response } from "express";
import http from "http";
import path from "path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Server } from "socket.io";
import multer from "multer";
import { initDB, db } from "./services/db";
import { initSerial } from "./services/serial";
import { printFile } from "./services/printer";
import {
  SessionStore,
  renderUploadPortal,
  resolvePublicBaseUrl,
} from "./services/session";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const execFileAsync = promisify(execFile);

function getLocalIPv4(): string | null {
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }

  return null;
}

const upload = multer({ dest: "uploads/" });
const wirelessUpload = multer({
  dest: "uploads/",
  limits: { fileSize: 25 * 1024 * 1024 },
});

const sessionStore = new SessionStore("uploads/");
const PORTAL_ASSETS = new Set(["styles.css", "app.js"]);
const PORTAL_DIR = path.resolve("src/public/upload");
const PUBLIC_DIR = path.resolve("src/public");
const PREVIEW_CACHE_DIR = path.join(os.tmpdir(), "printbit-preview-cache");

const publicPageRoutes: Array<{ route: string; filePath: string }> = [
  { route: "/", filePath: path.join(PUBLIC_DIR, "index.html") },
  { route: "/print", filePath: path.join(PUBLIC_DIR, "print", "index.html") },
  { route: "/copy", filePath: path.join(PUBLIC_DIR, "copy", "index.html") },
  { route: "/config", filePath: path.join(PUBLIC_DIR, "config", "index.html") },
  { route: "/confirm", filePath: path.join(PUBLIC_DIR, "confirm", "index.html") },
  { route: "/scan", filePath: path.join(PUBLIC_DIR, "scan", "index.html") },
];

app.use(express.json());

app.get("/favicon.ico", (_req: Request, res: Response) => {
  res.sendStatus(204);
});

app.get("/upload", (req: Request, res: Response) => {
  const session = sessionStore.createSession(resolvePublicBaseUrl(req));
  res.redirect(`/upload/${encodeURIComponent(session.token)}`);
});

for (const page of publicPageRoutes) {
  app.get(page.route, (_req: Request, res: Response) => {
    res.sendFile(page.filePath);
  });
}

app.use(express.static("src/public"));
app.use(express.static("dist/public"));

app.get("/api/balance", (_req: Request, res: Response) => {
  res.json({
    balance: db.data?.balance ?? 0,
    earnings: db.data?.earnings ?? 0,
  });
});

app.post("/upload", upload.single("file"), (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  res.status(200).json({ filename: req.file.filename });
});

app.post("/print", async (req: Request, res: Response) => {
  const { filename } = req.body as { filename?: string };

  if (!filename) {
    return res.status(400).json({ error: "Filename is required" });
  }

  if ((db.data?.balance ?? 0) < 5) {
    return res.status(400).json({ error: "Insufficient balance" });
  }

  printFile(filename);

  db.data!.earnings += db.data!.balance;
  db.data!.balance = 0;
  await db.write();

  io.emit("balance", 0);
  res.sendStatus(200);
});

app.post("/api/confirm-payment", async (req: Request, res: Response) => {
  const { amount, mode, sessionId } = req.body as {
    amount?: number;
    mode?: "print" | "copy";
    sessionId?: string;
  };

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  if (mode !== "print" && mode !== "copy") {
    return res.status(400).json({ error: "Invalid mode" });
  }

  if ((db.data?.balance ?? 0) < amount) {
    return res.status(400).json({ error: "Insufficient balance", balance: db.data?.balance ?? 0 });
  }

  if (mode === "print") {
    if (!sessionId) {
      return res.status(400).json({ error: "Print session is required" });
    }

    const session = sessionStore.tryGetSession(sessionId, resolvePublicBaseUrl(req));
    if (!session?.document) {
      return res.status(400).json({ error: "No uploaded document found for this session" });
    }

    const serverFilename = path.basename(session.document.filePath);
    printFile(serverFilename);
  }

  db.data!.balance -= amount;
  db.data!.earnings += amount;
  await db.write();

  io.emit("balance", db.data!.balance);
  res.json({
    ok: true,
    balance: db.data!.balance,
    earnings: db.data!.earnings,
  });
});

app.get("/upload/:token", (req: Request, res: Response) => {
  try {
    const { token } = req.params as { token: string };
    const html = renderUploadPortal(token, path.join(PORTAL_DIR, "index.html"));
    res.send(html);
  } catch (error) {
    console.error("Error rendering upload portal:", error);
    res.status(404).send("Error loading upload portal");
  }
});

app.get("/upload/:token/:asset", (req: Request, res: Response) => {
  const { asset } = req.params as { asset: string };

  if (!PORTAL_ASSETS.has(asset)) {
    return res.status(404).send("Not found.");
  }

  const filePath = path.join(PORTAL_DIR, asset);
  res.sendFile(filePath, (err) => {
    if (err) res.status(404).send("Asset not found.");
  });
});

app.get("/api/wireless/sessions", (req: Request, res: Response) => {
  const publicBaseUrl = resolvePublicBaseUrl(req);
  const session = sessionStore.createSession(publicBaseUrl);
  res.status(201).json(session);
});

app.get("/api/wireless/sessions/:sessionId", (req: Request, res: Response) => {
  const publicBaseUrl = resolvePublicBaseUrl(req);
  const session = sessionStore.tryGetSession(req.params.sessionId as string, publicBaseUrl);

  if (!session) {
    return res.status(404).json({ error: "Session not found." });
  }

  res.json(session);
});

function resolveLibreOfficePath(): string | null {
  const configured = process.env.PRINTBIT_LIBREOFFICE_PATH;
  if (configured && fs.existsSync(configured)) {
    return configured;
  }

  const candidates = [
    path.join(process.env.ProgramFiles ?? "", "LibreOffice", "program", "soffice.exe"),
    path.join(process.env["ProgramFiles(x86)"] ?? "", "LibreOffice", "program", "soffice.exe"),
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  return null;
}

async function convertWordToPdfPreview(sourcePath: string): Promise<string> {
  fs.mkdirSync(PREVIEW_CACHE_DIR, { recursive: true });

  const stats = await fs.promises.stat(sourcePath);
  const ext = path.extname(sourcePath).toLowerCase();
  const key = createHash("sha256")
    .update(`${sourcePath}|${stats.mtimeMs}`)
    .digest("hex");

  const cacheSource = path.join(PREVIEW_CACHE_DIR, `${key}${ext}`);
  const cachePdf = path.join(PREVIEW_CACHE_DIR, `${key}.pdf`);
  if (fs.existsSync(cachePdf)) return cachePdf;

  await fs.promises.copyFile(sourcePath, cacheSource);

  const sofficePath = resolveLibreOfficePath();
  if (!sofficePath) {
    throw new Error("LibreOffice not found for DOC/DOCX preview.");
  }

  await execFileAsync(
    sofficePath,
    [
      "--headless",
      "--nologo",
      "--nodefault",
      "--norestore",
      "--nolockcheck",
      "--convert-to",
      "pdf",
      "--outdir",
      PREVIEW_CACHE_DIR,
      cacheSource,
    ],
    { timeout: 60000 },
  );

  const convertedPdf = path.join(
    PREVIEW_CACHE_DIR,
    `${path.basename(cacheSource, ext)}.pdf`,
  );
  if (!fs.existsSync(convertedPdf)) {
    throw new Error("DOC/DOCX preview conversion failed.");
  }

  if (convertedPdf !== cachePdf) {
    await fs.promises.copyFile(convertedPdf, cachePdf);
  }

  return cachePdf;
}

app.get("/api/wireless/sessions/:sessionId/preview", async (req: Request, res: Response) => {
  const publicBaseUrl = resolvePublicBaseUrl(req);
  const session = sessionStore.tryGetSession(req.params.sessionId as string, publicBaseUrl);

  if (!session?.document) {
    return res.status(404).send("No uploaded file available for preview.");
  }

  const absolutePath = path.resolve(session.document.filePath);
  const extension = path.extname(absolutePath).toLowerCase();

  try {
    if (extension === ".pdf") {
      return res.sendFile(absolutePath);
    }

    if (extension === ".doc" || extension === ".docx") {
      const pdfPreviewPath = await convertWordToPdfPreview(absolutePath);
      return res.sendFile(pdfPreviewPath);
    }

    return res.status(400).send("Unsupported preview format.");
  } catch (error) {
    console.error("Preview error:", error);
    return res
      .status(500)
      .send("Preview unavailable. Ensure LibreOffice is installed for DOC/DOCX preview.");
  }
});

app.get("/api/wireless/sessions/by-token/:token", (req: Request, res: Response) => {
  const publicBaseUrl = resolvePublicBaseUrl(req);
  const session = sessionStore.tryGetSessionByToken(req.params.token as string, publicBaseUrl);

  if (!session) {
    return res.status(404).json({ error: "Session not found." });
  }

  res.json(session);
});

app.post(
  "/api/wireless/sessions/:sessionId/upload",
  wirelessUpload.single("file"),
  async (req: Request, res: Response) => {
    const { sessionId } = req.params as { sessionId: string };
    const token = (req.query.token as string) ?? "";
    const file = req.file;

    if (!file) {
      return res.status(400).json({ code: "no_file", error: "No file provided." });
    }

    io.to(`session:${sessionId}`).emit("UploadStarted", file.originalname);

    const result = await sessionStore.storeUpload(
      sessionId,
      token,
      file,
    );

    if (!result.isSuccess || !result.document) {
      io.to(`session:${sessionId}`).emit("UploadFailed");
      return res.status(400).json({
        code: result.errorCode ?? "UPLOAD_FAILED",
        error: result.errorMsg ?? "Upload failed.",
      });
    }

    const doc = result.document;
    io.to(`session:${sessionId}`).emit("UploadCompleted", doc);

    res.status(200).json({
      documentId: doc.documentId,
      sessionId: doc.sessionId,
      fileName: doc.filename,
      contentType: doc.contentType,
      sizeBytes: doc.sizeBytes,
      uploadedAt: doc.uploadedAt,
    });
  },
);

io.on("connection", (socket) => {
  socket.on("joinSession", (sessionId: string) => {
    socket.join(`session:${sessionId}`);
  });
});

async function start() {
  const PORT = 3000;

  await initDB();
  initSerial(io);

  server.listen(PORT, "0.0.0.0", () => {
    const localIP = getLocalIPv4();
    if (localIP) {
      console.log(`→ Network: http://${localIP}:${PORT}`);
    } else {
      console.log("→ Network IP not detected");
    }
  });
}

start();
