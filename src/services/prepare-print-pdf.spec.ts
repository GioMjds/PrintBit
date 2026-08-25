import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import {
  preparePrintPdf,
  getPaperSizePoints,
  PAPER_DIMENSIONS_PT,
} from "./prepare-print-pdf";

describe("preparePrintPdf Image Layout & Orientation", () => {
  const TEST_DIR = path.resolve("uploads", "test-images");
  const landscapeImgPath = path.join(TEST_DIR, "landscape-sample.png");
  const portraitImgPath = path.join(TEST_DIR, "portrait-sample.png");

  beforeAll(async () => {
    await fs.promises.mkdir(TEST_DIR, { recursive: true });

    await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 3,
        background: { r: 50, g: 150, b: 250 },
      },
    })
      .png()
      .toFile(landscapeImgPath);

    await sharp({
      create: {
        width: 800,
        height: 1200,
        channels: 3,
        background: { r: 250, g: 100, b: 50 },
      },
    })
      .png()
      .toFile(portraitImgPath);
  });

  afterAll(async () => {
    try {
      await fs.promises.unlink(landscapeImgPath);
      await fs.promises.unlink(portraitImgPath);
      await fs.promises.rmdir(TEST_DIR);
    } catch {
      // Best-effort cleanup
    }
  });

  describe("getPaperSizePoints", () => {
    it("returns portrait dimensions for A4, Letter, Legal", () => {
      const a4 = getPaperSizePoints("A4", "portrait");
      expect(a4[0]).toBeCloseTo(595.28, 1);
      expect(a4[1]).toBeCloseTo(841.89, 1);
      expect(a4[0]).toBeLessThan(a4[1]);

      const letter = getPaperSizePoints("Letter", "portrait");
      expect(letter[0]).toBeCloseTo(612.0, 1);
      expect(letter[1]).toBeCloseTo(792.0, 1);
      expect(letter[0]).toBeLessThan(letter[1]);

      const legal = getPaperSizePoints("Legal", "portrait");
      expect(legal[0]).toBeCloseTo(612.0, 1);
      expect(legal[1]).toBeCloseTo(1008.0, 1);
      expect(legal[0]).toBeLessThan(legal[1]);
    });

    it("returns landscape dimensions for A4, Letter, Legal", () => {
      const a4 = getPaperSizePoints("A4", "landscape");
      expect(a4[0]).toBeCloseTo(841.89, 1);
      expect(a4[1]).toBeCloseTo(595.28, 1);
      expect(a4[0]).toBeGreaterThan(a4[1]);

      const letter = getPaperSizePoints("Letter", "landscape");
      expect(letter[0]).toBeCloseTo(792.0, 1);
      expect(letter[1]).toBeCloseTo(612.0, 1);
      expect(letter[0]).toBeGreaterThan(letter[1]);

      const legal = getPaperSizePoints("Legal", "landscape");
      expect(legal[0]).toBeCloseTo(1008.0, 1);
      expect(legal[1]).toBeCloseTo(612.0, 1);
      expect(legal[0]).toBeGreaterThan(legal[1]);
    });
  });

  describe("Landscape image conversion", () => {
    it("creates an A4 landscape PDF page for a landscape image with landscape orientation", async () => {
      const result = await preparePrintPdf({
        sourcePath: landscapeImgPath,
        colorMode: "colored",
        orientation: "landscape",
        paperSize: "A4",
        rotationDeg: 0,
      });

      try {
        expect(result.pageCount).toBe(1);
        expect(fs.existsSync(result.pdfPath)).toBe(true);

        const pdfBytes = await fs.promises.readFile(result.pdfPath);
        const pdf = await PDFDocument.load(pdfBytes);
        expect(pdf.getPageCount()).toBe(1);

        const page = pdf.getPage(0);
        const { width, height } = page.getSize();
        expect(width).toBeCloseTo(841.89, 1);
        expect(height).toBeCloseTo(595.28, 1);
        expect(width).toBeGreaterThan(height);
      } finally {
        for (const cleanup of result.cleanupPaths) {
          await fs.promises.unlink(cleanup).catch(() => {});
        }
      }
    });

    it("creates an A4 portrait PDF page for a landscape image in portrait orientation", async () => {
      const result = await preparePrintPdf({
        sourcePath: landscapeImgPath,
        colorMode: "colored",
        orientation: "portrait",
        paperSize: "A4",
        rotationDeg: 0,
      });

      try {
        expect(result.pageCount).toBe(1);
        const pdfBytes = await fs.promises.readFile(result.pdfPath);
        const pdf = await PDFDocument.load(pdfBytes);
        const page = pdf.getPage(0);
        const { width, height } = page.getSize();
        expect(width).toBeCloseTo(595.28, 1);
        expect(height).toBeCloseTo(841.89, 1);
        expect(width).toBeLessThan(height);
      } finally {
        for (const cleanup of result.cleanupPaths) {
          await fs.promises.unlink(cleanup).catch(() => {});
        }
      }
    });

    it("creates Letter and Legal landscape PDF pages correctly", async () => {
      const letterResult = await preparePrintPdf({
        sourcePath: landscapeImgPath,
        colorMode: "colored",
        orientation: "landscape",
        paperSize: "Letter",
      });
      const legalResult = await preparePrintPdf({
        sourcePath: landscapeImgPath,
        colorMode: "colored",
        orientation: "landscape",
        paperSize: "Legal",
      });

      try {
        const letterDoc = await PDFDocument.load(
          await fs.promises.readFile(letterResult.pdfPath),
        );
        const letterPage = letterDoc.getPage(0);
        expect(letterPage.getWidth()).toBeCloseTo(792.0, 1);
        expect(letterPage.getHeight()).toBeCloseTo(612.0, 1);

        const legalDoc = await PDFDocument.load(
          await fs.promises.readFile(legalResult.pdfPath),
        );
        const legalPage = legalDoc.getPage(0);
        expect(legalPage.getWidth()).toBeCloseTo(1008.0, 1);
        expect(legalPage.getHeight()).toBeCloseTo(612.0, 1);
      } finally {
        for (const c of letterResult.cleanupPaths.concat(legalResult.cleanupPaths)) {
          await fs.promises.unlink(c).catch(() => {});
        }
      }
    });
  });

  describe("Portrait image conversion", () => {
    it("creates an A4 portrait PDF page for a portrait image in portrait orientation", async () => {
      const result = await preparePrintPdf({
        sourcePath: portraitImgPath,
        colorMode: "colored",
        orientation: "portrait",
        paperSize: "A4",
        rotationDeg: 0,
      });

      try {
        expect(result.pageCount).toBe(1);
        const pdfBytes = await fs.promises.readFile(result.pdfPath);
        const pdf = await PDFDocument.load(pdfBytes);
        const page = pdf.getPage(0);
        const { width, height } = page.getSize();
        expect(width).toBeCloseTo(595.28, 1);
        expect(height).toBeCloseTo(841.89, 1);
        expect(width).toBeLessThan(height);
      } finally {
        for (const cleanup of result.cleanupPaths) {
          await fs.promises.unlink(cleanup).catch(() => {});
        }
      }
    });

    it("creates an A4 landscape PDF page for a portrait image in landscape orientation", async () => {
      const result = await preparePrintPdf({
        sourcePath: portraitImgPath,
        colorMode: "colored",
        orientation: "landscape",
        paperSize: "A4",
        rotationDeg: 0,
      });

      try {
        expect(result.pageCount).toBe(1);
        const pdfBytes = await fs.promises.readFile(result.pdfPath);
        const pdf = await PDFDocument.load(pdfBytes);
        const page = pdf.getPage(0);
        const { width, height } = page.getSize();
        expect(width).toBeCloseTo(841.89, 1);
        expect(height).toBeCloseTo(595.28, 1);
        expect(width).toBeGreaterThan(height);
      } finally {
        for (const cleanup of result.cleanupPaths) {
          await fs.promises.unlink(cleanup).catch(() => {});
        }
      }
    });
  });

  describe("Rotation and Grayscale support", () => {
    it("applies 90 degree rotation correctly to a portrait image on A4 portrait", async () => {
      const result = await preparePrintPdf({
        sourcePath: portraitImgPath,
        colorMode: "colored",
        orientation: "portrait",
        paperSize: "A4",
        rotationDeg: 90,
      });

      try {
        expect(result.pageCount).toBe(1);
        const pdfBytes = await fs.promises.readFile(result.pdfPath);
        const pdf = await PDFDocument.load(pdfBytes);
        const page = pdf.getPage(0);
        const { width, height } = page.getSize();
        expect(width).toBeCloseTo(595.28, 1);
        expect(height).toBeCloseTo(841.89, 1);
      } finally {
        for (const cleanup of result.cleanupPaths) {
          await fs.promises.unlink(cleanup).catch(() => {});
        }
      }
    });

    it("generates grayscale image PDF correctly when colorMode is grayscale", async () => {
      const result = await preparePrintPdf({
        sourcePath: landscapeImgPath,
        colorMode: "grayscale",
        orientation: "landscape",
        paperSize: "A4",
      });

      try {
        expect(result.pageCount).toBe(1);
        expect(fs.existsSync(result.pdfPath)).toBe(true);
      } finally {
        for (const cleanup of result.cleanupPaths) {
          await fs.promises.unlink(cleanup).catch(() => {});
        }
      }
    });
  });
});
