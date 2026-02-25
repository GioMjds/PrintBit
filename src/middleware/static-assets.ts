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
  app.use(express.static("src/public"));
  app.use(express.static("dist/public"));
}
