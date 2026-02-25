import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { PREVIEW_CACHE_DIR } from "../config/http";

const execFileAsync = promisify(execFile);

function resolveLibreOfficePath(): string | null {
  const configured = process.env.PRINTBIT_LIBREOFFICE_PATH;
  if (configured && fs.existsSync(configured)) {
    return configured;
  }

  const candidates = [
    path.join(
      process.env.ProgramFiles ?? "",
      "LibreOffice",
      "program",
      "soffice.exe",
    ),
    path.join(
      process.env["ProgramFiles(x86)"] ?? "",
      "LibreOffice",
      "program",
      "soffice.exe",
    ),
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  return null;
}

export async function convertToPdfPreview(sourcePath: string): Promise<string> {
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
    throw new Error(
      "LibreOffice not found. Install LibreOffice for document preview.",
    );
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
