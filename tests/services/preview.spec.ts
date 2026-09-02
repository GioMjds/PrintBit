import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { PreviewService } from '@/services/preview';
import { convertDocumentViaWorker } from '@/services/document-conversion-pipe';
import { PREVIEW_CACHE_DIR } from '@/config/http.config';

jest.mock('@/services/document-conversion-pipe', () => ({
  convertDocumentViaWorker: jest.fn(),
}));

const mockedConvertDocumentViaWorker =
  convertDocumentViaWorker as jest.MockedFunction<typeof convertDocumentViaWorker>;

function createSourceFile(filename = 'document.docx'): {
  directory: string;
  sourcePath: string;
} {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'printbit-preview-test-'),
  );
  const sourcePath = path.join(directory, filename);
  fs.writeFileSync(sourcePath, 'test document content');
  return { directory, sourcePath };
}

describe('PreviewService', () => {
  let testDirs: string[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    fs.mkdirSync(PREVIEW_CACHE_DIR, { recursive: true });
  });

  afterEach(() => {
    for (const dir of testDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    testDirs = [];
  });

  test('delegates convertToPdfPreview to convertDocumentViaWorker and returns cachePdf', async () => {
    const { directory, sourcePath } = createSourceFile();
    testDirs.push(directory);

    const tempWorkerPdf = path.join(directory, 'worker-output.pdf');
    fs.writeFileSync(tempWorkerPdf, '%PDF-1.4 mock worker pdf');

    mockedConvertDocumentViaWorker.mockImplementation(async () => ({
      requestId: 'req-1',
      success: true,
      outputPath: tempWorkerPdf,
      pageCount: 3,
      sourceFormat: 'docx',
      durationMs: 150,
      errorMessage: null,
    }));

    const service = new PreviewService();
    const pdfPath = await service.convertToPdfPreview(sourcePath);

    expect(mockedConvertDocumentViaWorker).toHaveBeenCalledTimes(1);
    expect(mockedConvertDocumentViaWorker).toHaveBeenCalledWith(
      sourcePath,
      expect.objectContaining({
        outputDirectory: PREVIEW_CACHE_DIR,
      }),
    );
    expect(pdfPath).toMatch(/\.pdf$/);
    expect(fs.existsSync(pdfPath)).toBe(true);
    expect(fs.readFileSync(pdfPath, 'utf8')).toBe('%PDF-1.4 mock worker pdf');

    // Clean up cached PDF
    if (fs.existsSync(pdfPath)) {
      fs.unlinkSync(pdfPath);
    }
  });

  test('shares one worker conversion when concurrent requests ask for the same file', async () => {
    const { directory, sourcePath } = createSourceFile();
    testDirs.push(directory);

    const tempWorkerPdf = path.join(directory, 'worker-output.pdf');
    fs.writeFileSync(tempWorkerPdf, '%PDF-1.4 mock concurrent pdf');

    mockedConvertDocumentViaWorker.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        requestId: 'req-2',
        success: true,
        outputPath: tempWorkerPdf,
        pageCount: 1,
        sourceFormat: 'docx',
        durationMs: 50,
        errorMessage: null,
      };
    });

    const service = new PreviewService();
    const first = service.convertToPdfPreview(sourcePath);
    const second = service.convertToPdfPreview(sourcePath);

    const [pdf1, pdf2] = await Promise.all([first, second]);

    expect(mockedConvertDocumentViaWorker).toHaveBeenCalledTimes(1);
    expect(pdf1).toBe(pdf2);
    expect(fs.existsSync(pdf1)).toBe(true);

    if (fs.existsSync(pdf1)) {
      fs.unlinkSync(pdf1);
    }
  });

  test('returns existing cached PDF on disk without invoking worker', async () => {
    const { directory, sourcePath } = createSourceFile();
    testDirs.push(directory);

    const tempWorkerPdf = path.join(directory, 'worker-output.pdf');
    fs.writeFileSync(tempWorkerPdf, '%PDF-1.4 cached test');

    mockedConvertDocumentViaWorker.mockImplementation(async () => ({
      requestId: 'req-3',
      success: true,
      outputPath: tempWorkerPdf,
      pageCount: 1,
      sourceFormat: 'docx',
      durationMs: 10,
      errorMessage: null,
    }));

    const service = new PreviewService();
    const pdfPath1 = await service.convertToPdfPreview(sourcePath);
    expect(mockedConvertDocumentViaWorker).toHaveBeenCalledTimes(1);

    // Second call should hit the cache on disk
    const pdfPath2 = await service.convertToPdfPreview(sourcePath);
    expect(mockedConvertDocumentViaWorker).toHaveBeenCalledTimes(1);
    expect(pdfPath2).toBe(pdfPath1);

    if (fs.existsSync(pdfPath1)) {
      fs.unlinkSync(pdfPath1);
    }
  });

  test('throws error if convertDocumentViaWorker fails or reports failure', async () => {
    const { directory, sourcePath } = createSourceFile('failed.docx');
    testDirs.push(directory);

    mockedConvertDocumentViaWorker.mockResolvedValue({
      requestId: 'req-err',
      success: false,
      outputPath: null,
      pageCount: null,
      sourceFormat: 'docx',
      durationMs: 20,
      errorMessage: 'Conversion engine crashed',
    });

    const service = new PreviewService();
    await expect(service.convertToPdfPreview(sourcePath)).rejects.toThrow(
      'Conversion engine crashed',
    );
  });

  test('supports and generates HTML preview for spreadsheet files', async () => {
    const service = new PreviewService();
    expect(service.supportsHtmlPreview('.xlsx')).toBe(true);
    expect(service.supportsHtmlPreview('.xls')).toBe(true);
    expect(service.supportsHtmlPreview('.docx')).toBe(false);

    const { directory, sourcePath } = createSourceFile('test.xlsx');
    testDirs.push(directory);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Header 1', 'Header 2'],
      ['Value A', 'Value B'],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, sourcePath);

    const html = await service.generateHtmlPreview(sourcePath);
    expect(html).toContain('Header 1');
    expect(html).toContain('Value A');
    expect(html).toContain('<!DOCTYPE html>');
  });
});
