import os from "os";
import express from "express";
import type { Request, Response } from "express";
import http from "http";
import path from "path";
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
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

const sessionStore = new SessionStore("uploads/");

const PORTAL_ASSETS = new Set(["styles.css", "app.js"]);
const PORTAL_DIR = path.resolve("src/public/upload");

app.use(express.static("src/public"));
app.use(express.static("dist/public"));
app.use(express.json());

app.post("/upload", upload.single("file"), (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  res.status(200).json({ filename: req.file.filename });
});

app.post("/print", async (req: Request, res: Response) => {
  const { filename } = req.body;

  if (db.data!.balance < 5) {
    return res.status(400).json({ error: "Insufficient balance" });
  }

  printFile(filename);

  db.data!.earnings += db.data!.balance;
  db.data!.balance = 0;
  await db.write();

  io.emit("balance", 0);
  res.sendStatus(200);
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
  const session = sessionStore.tryGetSession((req.params.sessionId as string), publicBaseUrl);

  if (!session) {
    return res.status(404).json({ error: "Session not found." });
  }

  res.json(session);
});

app.get("/api/wireless/sessions/by-token/:token", (req: Request, res: Response) => {
  const publicBaseUrl = resolvePublicBaseUrl(req);
  const session = sessionStore.tryGetSessionByToken((req.params.token as string), publicBaseUrl);

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

    const result = await sessionStore.storeUpload(sessionId, token, file, resolvePublicBaseUrl(req));

    if (!result.isSuccess || !result.document) {
      io.to(`session:${sessionId}`).emit("UploadFailed");
      return res.status(400).json({
        code: result.errorCode ?? "UPLOAD_FAILED",
        error: result.errorMsg ?? "Upload failed.",
      });
    }

    const doc = result.document;

    // Notify kiosk: upload complete
    io.to(`session:${sessionId}`).emit("UploadCompleted", doc);

    res.status(200).json({
      documentId: doc.documentId,
      sessionId: doc.sessionId,
      fileName: doc.filename,
      contentType: doc.contentType,
      sizeBytes: doc.sizeBytes,
      uploadedAt: doc.uploadedAt,
    });
  }
);

io.on("connection", (socket) => {
  socket.on("joinSession", (sessionId: string) => {
    socket.join(`session:${sessionId}`);
  });
})

async function start() {
  const PORT = 3000;

  await initDB();
  initSerial(io);

  server.listen(PORT, "0.0.0.0", () => {
    const localIP = getLocalIPv4();
    console.log(`→ Local:   http://localhost:${PORT}`);

    if (localIP) {
      console.log(`→ Network: http://${localIP}:${PORT}`);
    } else {
      console.log(`→ Network IP not detected`);
    }
  });
}

start();
