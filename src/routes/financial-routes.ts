import type { Express, Request, RequestHandler, Response } from "express";
import path from "node:path";
import type { Server } from "socket.io";
import { db } from "../services/db";
import { printFile } from "../services/printer";
import type { SessionStore } from "../services/session";

interface RegisterFinancialRoutesDeps {
  io: Server;
  sessionStore: SessionStore;
  uploadSingle: RequestHandler;
  resolvePublicBaseUrl: (req: Request) => URL;
}

export function registerFinancialRoutes(
  app: Express,
  deps: RegisterFinancialRoutesDeps,
) {
  app.get("/api/balance", (_req: Request, res: Response) => {
    res.json({
      balance: db.data?.balance ?? 0,
      earnings: db.data?.earnings ?? 0,
    });
  });

  app.post("/api/balance/reset", async (_req: Request, res: Response) => {
    db.data!.balance = 0;
    await db.write();
    deps.io.emit("balance", 0);

    res.json({
      ok: true,
      balance: db.data!.balance,
      earnings: db.data!.earnings,
    });
  });

  app.post("/upload", deps.uploadSingle, (req: Request, res: Response) => {
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

    deps.io.emit("balance", 0);
    res.sendStatus(200);
  });

  app.post("/api/confirm-payment", async (req: Request, res: Response) => {
    const { amount, mode, sessionId, filename } = req.body as {
      amount?: number;
      mode?: "print" | "copy";
      sessionId?: string;
      filename?: string;
    };

    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    if (mode !== "print" && mode !== "copy") {
      return res.status(400).json({ error: "Invalid mode" });
    }

    if ((db.data?.balance ?? 0) < amount) {
      return res
        .status(400)
        .json({ error: "Insufficient balance", balance: db.data?.balance ?? 0 });
    }

    if (mode === "print") {
      if (!sessionId) {
        return res.status(400).json({ error: "Print session is required" });
      }

      const session = deps.sessionStore.tryGetSession(
        sessionId,
        deps.resolvePublicBaseUrl(req),
      );
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const allDocs =
        session.documents && session.documents.length > 0
          ? session.documents
          : session.document
            ? [session.document]
            : [];

      if (allDocs.length === 0) {
        return res
          .status(400)
          .json({ error: "No uploaded document found for this session" });
      }

      const target = filename
        ? allDocs.find((d) => d.filename === filename)
        : allDocs[allDocs.length - 1];

      if (!target) {
        return res
          .status(400)
          .json({ error: `Document "${filename}" not found in session` });
      }

      const serverFilename = path.basename(target.filePath);
      printFile(serverFilename);
    }

    db.data!.balance -= amount;
    db.data!.earnings += amount;
    await db.write();

    deps.io.emit("balance", db.data!.balance);
    res.json({
      ok: true,
      balance: db.data!.balance,
      earnings: db.data!.earnings,
    });
  });
}
