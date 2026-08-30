import { evaluateJobProgress, PrinterService, type JobProgressEvaluation } from './printer.service';
import {
  queryActiveJobProgressViaEdge,
  type EdgeJobProgress,
} from '@/services/windows-printer-edge';
import * as powershellRunspace from '@/services/powershell-runspace';

describe('evaluateJobProgress & PrinterService.evaluateJobProgress', () => {
  let printerService: PrinterService;

  beforeEach(() => {
    printerService = new PrinterService();
  });

  describe('Mid-job paper-out detection', () => {
    it('detects mid-job paper-out flag and reports confirmed and unprinted pages', () => {
      const progress = {
        jobId: 101,
        pagesPrinted: 2,
        totalPages: 3,
        isOutOfPaper: true,
        isPaused: true,
        status: 'PaperOut',
      };

      const result: JobProgressEvaluation = evaluateJobProgress(progress);
      expect(result.interrupted).toBe(true);
      expect(result.reason).toBe('out_of_paper');
      expect(result.confirmedPagesPrinted).toBe(2);
      expect(result.unprintedPages).toBe(1);

      // Verify PrinterService instance method behaves identically
      const serviceResult = printerService.evaluateJobProgress(progress);
      expect(serviceResult).toEqual(result);
    });

    it('detects paper-out from status string when isOutOfPaper boolean is false', () => {
      const progress = {
        jobId: 102,
        pagesPrinted: 1,
        totalPages: 5,
        isOutOfPaper: false,
        isPaused: true,
        status: 'Error, PaperOut, UserIntervention',
      };

      const result = evaluateJobProgress(progress);
      expect(result.interrupted).toBe(true);
      expect(result.reason).toBe('out_of_paper');
      expect(result.confirmedPagesPrinted).toBe(1);
      expect(result.unprintedPages).toBe(4);
    });

    it('detects paper-out with case-insensitivity in status string', () => {
      const progress = {
        jobId: 103,
        pagesPrinted: 0,
        totalPages: 2,
        status: 'printer status: paperout',
      };

      const result = evaluateJobProgress(progress);
      expect(result.interrupted).toBe(true);
      expect(result.reason).toBe('out_of_paper');
      expect(result.confirmedPagesPrinted).toBe(0);
      expect(result.unprintedPages).toBe(2);
    });
  });

  describe('Fully completed job evaluation', () => {
    it('evaluates fully completed job without interruption', () => {
      const progress = {
        jobId: 201,
        pagesPrinted: 3,
        totalPages: 3,
        isOutOfPaper: false,
        isPaused: false,
        isCompleted: true,
        status: 'Printed',
      };

      const result = evaluateJobProgress(progress);
      expect(result.interrupted).toBe(false);
      expect(result.reason).toBe('none');
      expect(result.confirmedPagesPrinted).toBe(3);
      expect(result.unprintedPages).toBe(0);
    });

    it('evaluates job where pagesPrinted equals totalPages even if paused', () => {
      const progress = {
        jobId: 202,
        pagesPrinted: 4,
        totalPages: 4,
        isOutOfPaper: false,
        isPaused: true,
        status: 'Paused',
      };

      const result = evaluateJobProgress(progress);
      // All pages are printed, so job is not interrupted
      expect(result.interrupted).toBe(false);
      expect(result.reason).toBe('paused_error');
      expect(result.confirmedPagesPrinted).toBe(4);
      expect(result.unprintedPages).toBe(0);
    });
  });

  describe('Mid-job paused error', () => {
    it('detects mid-job paused state when pages printed is less than total', () => {
      const progress = {
        jobId: 301,
        pagesPrinted: 1,
        totalPages: 3,
        isOutOfPaper: false,
        isPaused: true,
        status: 'Paused',
      };

      const result = evaluateJobProgress(progress);
      expect(result.interrupted).toBe(true);
      expect(result.reason).toBe('paused_error');
      expect(result.confirmedPagesPrinted).toBe(1);
      expect(result.unprintedPages).toBe(2);
    });

    it('detects paused state when 0 pages have been printed', () => {
      const progress = {
        jobId: 302,
        pagesPrinted: 0,
        totalPages: 5,
        isOutOfPaper: false,
        isPaused: true,
        status: 'Paused, UserIntervention',
      };

      const result = evaluateJobProgress(progress);
      expect(result.interrupted).toBe(true);
      expect(result.reason).toBe('paused_error');
      expect(result.confirmedPagesPrinted).toBe(0);
      expect(result.unprintedPages).toBe(5);
    });
  });

  describe('Normal active printing (uninterrupted)', () => {
    it('evaluates active printing in-flight without pause or error', () => {
      const progress = {
        jobId: 401,
        pagesPrinted: 1,
        totalPages: 3,
        isOutOfPaper: false,
        isPaused: false,
        status: 'Printing',
      };

      const result = evaluateJobProgress(progress);
      expect(result.interrupted).toBe(false);
      expect(result.reason).toBe('none');
      expect(result.confirmedPagesPrinted).toBe(1);
      expect(result.unprintedPages).toBe(2);
    });
  });

  describe('Clamping of pages printed', () => {
    it('clamps negative pagesPrinted to 0', () => {
      const progress = {
        jobId: 501,
        pagesPrinted: -3,
        totalPages: 5,
        isOutOfPaper: false,
        isPaused: false,
      };

      const result = evaluateJobProgress(progress);
      expect(result.confirmedPagesPrinted).toBe(0);
      expect(result.unprintedPages).toBe(5);
    });

    it('clamps pagesPrinted exceeding totalPages to totalPages', () => {
      const progress = {
        jobId: 502,
        pagesPrinted: 12,
        totalPages: 5,
        isOutOfPaper: false,
        isPaused: false,
      };

      const result = evaluateJobProgress(progress);
      expect(result.confirmedPagesPrinted).toBe(5);
      expect(result.unprintedPages).toBe(0);
    });

    it('handles zero totalPages correctly', () => {
      const progress = {
        jobId: 503,
        pagesPrinted: 0,
        totalPages: 0,
        isOutOfPaper: false,
        isPaused: false,
      };

      const result = evaluateJobProgress(progress);
      expect(result.confirmedPagesPrinted).toBe(0);
      expect(result.unprintedPages).toBe(0);
      expect(result.interrupted).toBe(false);
    });
  });
});

describe('queryActiveJobProgressViaEdge', () => {
  let mockRun: jest.Mock;

  beforeAll(() => {
    jest.spyOn(powershellRunspace, 'createPersistentPS').mockImplementation(() => ({
      run: (...args: any[]) => mockRun(...args),
      dispose: jest.fn(),
      get disposed() {
        return false;
      },
    }));
  });

  beforeEach(() => {
    mockRun = jest.fn();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('rejects invalid printer names with error', async () => {
    const result = await queryActiveJobProgressViaEdge('Invalid;Printer|Name', 123);
    expect(result).toEqual({ error: 'Invalid printerName format' });
  });

  it('returns parsed EdgeJobProgress when job is found in spooler', async () => {
    const mockOutput = JSON.stringify({
      jobId: 101,
      pagesPrinted: 2,
      totalPages: 3,
      isOutOfPaper: true,
      isPaused: true,
      isCompleted: false,
      isDeleting: false,
      status: 'PaperOut',
    });

    mockRun.mockResolvedValue(mockOutput);

    const result = await queryActiveJobProgressViaEdge('EPSON_L3210', 101);
    expect(result).toEqual({
      jobId: 101,
      pagesPrinted: 2,
      totalPages: 3,
      isOutOfPaper: true,
      isPaused: true,
      isCompleted: false,
      isDeleting: false,
      status: 'PaperOut',
    });
  });

  it('returns error object when job is not found in queue', async () => {
    const mockOutput = JSON.stringify({
      error: 'Job not found in queue',
    });

    mockRun.mockResolvedValue(mockOutput);

    const result = await queryActiveJobProgressViaEdge('EPSON_L3210', 999);
    expect(result).toEqual({ error: 'Job not found in queue' });
  });

  it('handles runspace execution errors gracefully', async () => {
    mockRun.mockRejectedValue(new Error('PowerShell crashed'));

    const result = await queryActiveJobProgressViaEdge('EPSON_L3210', 101);
    expect(result).toEqual({ error: 'PowerShell crashed' });
  });

  it('handles empty response from runspace script', async () => {
    mockRun.mockResolvedValue('');

    const result = await queryActiveJobProgressViaEdge('EPSON_L3210', 101);
    expect(result).toEqual({ error: 'Empty response from job progress query' });
  });
});
