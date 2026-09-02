import {
  convertDocumentViaWorker,
  DocumentConversionResult,
} from '@/services/document-conversion-pipe';
import net from 'node:net';
import EventEmitter from 'node:events';

jest.mock('node:net');

describe('document-conversion-pipe', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('throws helpful error when worker pipe fails to connect', async () => {
    (net.connect as unknown as jest.Mock).mockImplementation(() => {
      const emitter = new EventEmitter() as any;
      emitter.setTimeout = jest.fn();
      emitter.destroy = jest.fn();
      setTimeout(() => emitter.emit('error', new Error('ENOENT pipe not found')), 5);
      return emitter;
    });

    await expect(convertDocumentViaWorker('C:\\docs\\sample.docx')).rejects.toThrow(
      /Document conversion service is offline/i,
    );
  });

  it('sends request and parses successful conversion response', async () => {
    const expectedResult: DocumentConversionResult = {
      requestId: 'test-req',
      success: true,
      outputPath: 'C:\\converted\\sample.pdf',
      pageCount: 3,
      sourceFormat: '.docx',
      durationMs: 850,
      errorMessage: null,
    };

    let sentData = '';
    (net.connect as unknown as jest.Mock).mockImplementation(() => {
      const emitter = new EventEmitter() as any;
      emitter.setTimeout = jest.fn();
      emitter.destroy = jest.fn();
      emitter.write = jest.fn((data: string, enc: string, cb?: () => void) => {
        sentData = data;
        if (cb) cb();
        setTimeout(() => {
          emitter.emit('data', Buffer.from(JSON.stringify(expectedResult) + '\n'));
        }, 5);
      });
      setTimeout(() => emitter.emit('connect'), 5);
      return emitter;
    });

    const result = await convertDocumentViaWorker('C:\\docs\\sample.docx', {
      outputDirectory: 'C:\\converted',
      timeoutSeconds: 30,
    });

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe('C:\\converted\\sample.pdf');
    expect(result.pageCount).toBe(3);

    const parsedSent = JSON.parse(sentData.trim());
    expect(parsedSent.sourcePath).toBe('C:\\docs\\sample.docx');
    expect(parsedSent.outputDirectory).toBe('C:\\converted');
    expect(parsedSent.timeoutSeconds).toBe(30);
    expect(parsedSent.requestId).toBeDefined();
  });

  it('throws error when conversion result reports failure', async () => {
    const failedResult: DocumentConversionResult = {
      requestId: 'test-req',
      success: false,
      outputPath: null,
      pageCount: null,
      sourceFormat: '.docx',
      durationMs: 120,
      errorMessage: 'Corrupted document format',
    };

    (net.connect as unknown as jest.Mock).mockImplementation(() => {
      const emitter = new EventEmitter() as any;
      emitter.setTimeout = jest.fn();
      emitter.destroy = jest.fn();
      emitter.write = jest.fn((data: string, enc: string, cb?: () => void) => {
        if (cb) cb();
        setTimeout(() => {
          emitter.emit('data', Buffer.from(JSON.stringify(failedResult) + '\n'));
        }, 5);
      });
      setTimeout(() => emitter.emit('connect'), 5);
      return emitter;
    });

    await expect(convertDocumentViaWorker('C:\\docs\\bad.docx')).rejects.toThrow(
      /Corrupted document format/,
    );
  });

  it('handles fragmented data chunks from socket', async () => {
    const expectedResult: DocumentConversionResult = {
      requestId: 'req-chunked',
      success: true,
      outputPath: 'C:\\converted\\chunked.pdf',
      pageCount: 1,
      sourceFormat: '.png',
      durationMs: 45,
      errorMessage: null,
    };

    const fullJson = JSON.stringify(expectedResult) + '\n';
    const chunk1 = fullJson.slice(0, 20);
    const chunk2 = fullJson.slice(20);

    (net.connect as unknown as jest.Mock).mockImplementation(() => {
      const emitter = new EventEmitter() as any;
      emitter.setTimeout = jest.fn();
      emitter.destroy = jest.fn();
      emitter.write = jest.fn((data: string, enc: string, cb?: () => void) => {
        if (cb) cb();
        setTimeout(() => {
          emitter.emit('data', Buffer.from(chunk1));
          setTimeout(() => {
            emitter.emit('data', Buffer.from(chunk2));
          }, 5);
        }, 5);
      });
      setTimeout(() => emitter.emit('connect'), 5);
      return emitter;
    });

    const result = await convertDocumentViaWorker('C:\\docs\\chunked.png');
    expect(result.success).toBe(true);
    expect(result.outputPath).toBe('C:\\converted\\chunked.pdf');
  });

  it('throws error on timeout', async () => {
    let timeoutHandler: (() => void) | undefined;
    (net.connect as unknown as jest.Mock).mockImplementation(() => {
      const emitter = new EventEmitter() as any;
      emitter.setTimeout = jest.fn((ms: number, cb?: () => void) => {
        timeoutHandler = cb;
      });
      emitter.destroy = jest.fn();
      setTimeout(() => {
        if (timeoutHandler) {
          timeoutHandler();
        }
      }, 10);
      return emitter;
    });

    await expect(convertDocumentViaWorker('C:\\docs\\timeout.docx')).rejects.toThrow(
      /Document conversion timed out|Document conversion service is offline/i,
    );
  });
});
