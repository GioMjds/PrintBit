import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectPdfColorContent } from '@/services/color-detection';

const mockDestroy = jest.fn(async () => undefined);

jest.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  OPS: {},
  getDocument: jest.fn(() => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
        cleanup: jest.fn(),
      }),
    }),
    destroy: mockDestroy,
  })),
}));

describe('PDF.js v6 document cleanup', () => {
  let tempDirectory: string;
  let grayscalePdfPath: string;

  beforeAll(async () => {
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'printbit-pdfjs-'));
    grayscalePdfPath = path.join(tempDirectory, 'grayscale.pdf');
    await fs.writeFile(grayscalePdfPath, '%PDF-1.7');
  });

  afterAll(async () => {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  });

  it('classifies a grayscale PDF when the PDF.js document has no destroy method', async () => {
    await expect(detectPdfColorContent(grayscalePdfPath)).resolves.toEqual({
      hasColor: false,
      isGrayscale: true,
      sampledPages: 1,
    });
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
