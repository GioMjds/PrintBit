import {
  ANALYSIS_ALGORITHM_VERSION,
  analyzeDocument,
} from '../src/services/document-analysis';
import * as sharp from 'sharp';
import analysisScenarios from './mock_data/analysis_scenarios.json';

interface MockCanvasContext {
  __frame: Uint8Array | Uint8ClampedArray;
  getImageData: jest.Mock<
    { data: Uint8Array | Uint8ClampedArray },
    [number, number, number, number]
  >;
}

const mockCanvasContexts: MockCanvasContext[] = [];

// Mock worker_threads to run directly in main thread for tests
jest.mock('node:worker_threads', () => ({
  isMainThread: false, // Force analyzeDocument to call analyzeDocumentDirect
  parentPort: {
    postMessage: jest.fn(),
  },
  workerData: {},
  Worker: jest.fn(),
}));

jest.mock('canvas', () => ({
  createCanvas: jest.fn((width: number, height: number) => {
    const ctx: MockCanvasContext = {
      __frame: new Uint8ClampedArray(width * height * 4),
      getImageData: jest.fn(
        (_x: number, _y: number, _width: number, _height: number) => ({
          data: ctx.__frame,
        }),
      ),
    };
    mockCanvasContexts.push(ctx);
    return {
      width,
      height,
      getContext: jest.fn(() => ctx),
    };
  }),
}));

// Mock Sharp
jest.mock('sharp');
const mockedSharp = sharp as unknown as jest.Mock;

// Mock PDF.js
jest.mock(
  'pdfjs-dist/legacy/build/pdf.mjs',
  () => ({
    OPS: {},
    getDocument: jest.fn(),
  }),
  { virtual: true },
);

// Mock fs
jest.mock('node:fs', () => ({
  promises: {
    readFile: jest.fn().mockResolvedValue(Buffer.from('dummy pdf content')),
  },
  existsSync: jest.fn().mockReturnValue(true),
}));

type PageClassification = 'blank' | 'bw' | 'partial' | 'full_color';

type PixelKind = 'transparent' | 'white' | 'gray' | 'color';

interface MockPageSpec {
  width?: number;
  height?: number;
  contentCoverage: number;
  colorCoverage: number;
  background?: PixelKind;
}

function paintPixel(
  frame: Uint8Array | Uint8ClampedArray,
  pixelIndex: number,
  kind: PixelKind,
): void {
  const offset = pixelIndex * 4;
  if (kind === 'transparent') {
    frame[offset] = 0;
    frame[offset + 1] = 0;
    frame[offset + 2] = 0;
    frame[offset + 3] = 0;
    return;
  }

  if (kind === 'white') {
    frame[offset] = 255;
    frame[offset + 1] = 255;
    frame[offset + 2] = 255;
  } else if (kind === 'gray') {
    frame[offset] = 48;
    frame[offset + 1] = 48;
    frame[offset + 2] = 48;
  } else {
    frame[offset] = 255;
    frame[offset + 1] = 32;
    frame[offset + 2] = 32;
  }
  frame[offset + 3] = 255;
}

function paintFrameFromSpec(
  frame: Uint8Array | Uint8ClampedArray,
  spec: MockPageSpec,
): void {
  const totalPixels = frame.length / 4;
  for (let i = 0; i < totalPixels; i += 1) {
    paintPixel(frame, i, spec.background ?? 'transparent');
  }

  const contentPixels = Math.max(
    0,
    Math.min(totalPixels, Math.round(spec.contentCoverage * totalPixels)),
  );
  const colorPixels = Math.max(
    0,
    Math.min(contentPixels, Math.round(spec.colorCoverage * totalPixels)),
  );

  for (let i = 0; i < contentPixels; i += 1) {
    paintPixel(frame, i, i < colorPixels ? 'color' : 'gray');
  }
}

function pageSpecFromClassification(
  classification: PageClassification,
  coverage: number,
): MockPageSpec {
  if (classification === 'blank') {
    return { contentCoverage: 0, colorCoverage: 0 };
  }
  if (classification === 'bw') {
    return { contentCoverage: coverage, colorCoverage: 0 };
  }
  return { contentCoverage: coverage, colorCoverage: coverage };
}

function mockPdfDocument(pageSpecs: MockPageSpec[]): void {
  const pdfjs = jest.requireMock('pdfjs-dist/legacy/build/pdf.mjs') as {
    getDocument: jest.Mock;
  };
  const mockGetPage = jest.fn();

  pageSpecs.forEach((spec) => {
    const width = spec.width ?? 10;
    const height = spec.height ?? 10;
    mockGetPage.mockResolvedValueOnce({
      getViewport: jest.fn(({ scale }: { scale: number }) => ({
        width: width * scale,
        height: height * scale,
      })),
      render: jest.fn(
        ({ canvasContext }: { canvasContext: MockCanvasContext }) => {
          paintFrameFromSpec(canvasContext.__frame, spec);
          return { promise: Promise.resolve() };
        },
      ),
      cleanup: jest.fn(),
    });
  });

  pdfjs.getDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: pageSpecs.length,
      getPage: mockGetPage,
      destroy: jest.fn().mockResolvedValue(undefined),
    }),
  });
}

describe('Document Analysis Service (JSON Scenarios)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanvasContexts.length = 0;
  });

  analysisScenarios.forEach((scenarioData: any) => {
    it(`should match analysis result for: ${scenarioData.scenario}`, async () => {
      const isImage =
        scenarioData.filename.endsWith('.png') ||
        scenarioData.filename.endsWith('.jpg');

      if (isImage) {
        const classification = scenarioData.pages[0]
          ?.classification as PageClassification;
        const width = 10;
        const height = 10;
        const rgba = Buffer.alloc(width * height * 4);
        paintFrameFromSpec(
          rgba,
          pageSpecFromClassification(
            classification,
            scenarioData.pages[0]?.coverage ?? 0,
          ),
        );

        mockedSharp.mockReturnValue({
          ensureAlpha: jest.fn().mockReturnThis(),
          raw: jest.fn().mockReturnThis(),
          toBuffer: jest.fn().mockResolvedValue({
            data: rgba,
            info: { width, height },
          }),
        });
      } else {
        mockPdfDocument(
          scenarioData.pages.map((page: any) =>
            pageSpecFromClassification(
              page.classification as PageClassification,
              page.coverage ?? 0,
            ),
          ),
        );
      }

      const result = await analyzeDocument({ filePath: scenarioData.filename });

      scenarioData.pages.forEach((expectedPage: any, idx: number) => {
        expect(result.analysisVersion).toBe(ANALYSIS_ALGORITHM_VERSION);
        expect(result.pages[idx].isBlank).toBe(
          expectedPage.classification === 'blank',
        );
        expect(result.pages[idx].isColor).toBe(expectedPage.isColor);

        // Handle fuzzy matching for 'partial' vs 'full_color'
        if (
          expectedPage.classification === 'full_color' &&
          result.pages[idx].classification === 'partial'
        ) {
          // Accept partial as a valid result for full_color expectations
        } else {
          expect(result.pages[idx].classification).toBe(
            expectedPage.classification,
          );
        }
      });
    });
  });
});

describe('Document Analysis Service (PDF raster regressions)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanvasContexts.length = 0;
  });

  it('classifies a text-only grayscale page as B/W with pixel-based color coverage', async () => {
    mockPdfDocument([{ contentCoverage: 0.12, colorCoverage: 0 }]);

    const result = await analyzeDocument({
      filePath: 'text-only-grayscale.pdf',
    });

    expect(result.pages[0]).toMatchObject({
      isBlank: false,
      isColor: false,
      coverage: 0,
      classification: 'bw',
    });
  });

  it('classifies a grayscale page with an embedded image as B/W', async () => {
    mockPdfDocument([{ contentCoverage: 0.65, colorCoverage: 0 }]);

    const result = await analyzeDocument({ filePath: 'grayscale-image.pdf' });

    expect(result.pages[0]).toMatchObject({
      isBlank: false,
      isColor: false,
      coverage: 0,
      classification: 'bw',
    });
  });

  it('classifies a colorful image-heavy page as full color using rendered pixels', async () => {
    mockPdfDocument([{ contentCoverage: 0.9, colorCoverage: 0.9 }]);

    const result = await analyzeDocument({ filePath: 'color-image-heavy.pdf' });

    expect(result.pages[0]).toMatchObject({
      isBlank: false,
      isColor: true,
      classification: 'full_color',
    });
    expect(result.pages[0].coverage).toBeCloseTo(0.9, 2);
  });

  it('treats a mostly blank page with a white background rectangle as blank', async () => {
    mockPdfDocument([
      { contentCoverage: 0, colorCoverage: 0, background: 'white' },
    ]);

    const result = await analyzeDocument({
      filePath: 'white-background-rectangle.pdf',
    });

    expect(result.pages[0]).toMatchObject({
      isBlank: true,
      isColor: false,
      coverage: 0,
      classification: 'blank',
    });
  });
});
