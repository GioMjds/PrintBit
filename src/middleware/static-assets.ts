import express from "express";
import type { Express } from "express";
import path from "node:path";

export function registerStaticAssets(app: Express) {
  app.use(
    "/fonts",
    express.static(path.resolve("src/fonts"), {
      maxAge: "365d",
      immutable: true,
    }),
  );
  app.use(
    "/libs/pdfjs",
    express.static(path.resolve("node_modules/pdfjs-dist/build"), {
      maxAge: "7d",
      setHeaders(res, filePath) {
        if (filePath.endsWith(".mjs")) {
          res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        }
      },
    }),
  );
  app.use(express.static("src/public"));
  app.use(express.static("dist/public"));
}
