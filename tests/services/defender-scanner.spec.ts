import {
  createDefenderScanner,
  type CommandRunner,
} from '@/services/defender-scanner';
import { getDefenderConfig } from '@/config/defender.config';

describe('DefenderScanner', () => {
  let runner: { run: jest.Mock };

  beforeEach(() => {
    runner = {
      run: jest.fn(),
    };
  });

  describe('configuration', () => {
    it('returns defaults when env vars are absent', () => {
      const config = getDefenderConfig({});
      expect(config.maxSignatureAgeHours).toBe(168);
      expect(config.scanTimeoutMs).toBe(60_000);
    });

    it('parses valid positive integer env vars', () => {
      const config = getDefenderConfig({
        PRINTBIT_DEFENDER_MAX_SIGNATURE_AGE_HOURS: '72',
        PRINTBIT_DEFENDER_SCAN_TIMEOUT_MS: '30000',
      });
      expect(config.maxSignatureAgeHours).toBe(72);
      expect(config.scanTimeoutMs).toBe(30_000);
    });

    it('throws on invalid maxSignatureAgeHours', () => {
      expect(() =>
        getDefenderConfig({
          PRINTBIT_DEFENDER_MAX_SIGNATURE_AGE_HOURS: 'invalid',
        }),
      ).toThrow(/PRINTBIT_DEFENDER_MAX_SIGNATURE_AGE_HOURS/);

      expect(() =>
        getDefenderConfig({
          PRINTBIT_DEFENDER_MAX_SIGNATURE_AGE_HOURS: '-5',
        }),
      ).toThrow(/PRINTBIT_DEFENDER_MAX_SIGNATURE_AGE_HOURS/);

      expect(() =>
        getDefenderConfig({
          PRINTBIT_DEFENDER_MAX_SIGNATURE_AGE_HOURS: '0',
        }),
      ).toThrow(/PRINTBIT_DEFENDER_MAX_SIGNATURE_AGE_HOURS/);

      expect(() =>
        getDefenderConfig({
          PRINTBIT_DEFENDER_MAX_SIGNATURE_AGE_HOURS: '1000',
        }),
      ).toThrow(/PRINTBIT_DEFENDER_MAX_SIGNATURE_AGE_HOURS/);
    });

    it('throws on invalid scanTimeoutMs', () => {
      expect(() =>
        getDefenderConfig({
          PRINTBIT_DEFENDER_SCAN_TIMEOUT_MS: '0',
        }),
      ).toThrow(/PRINTBIT_DEFENDER_SCAN_TIMEOUT_MS/);

      expect(() =>
        getDefenderConfig({
          PRINTBIT_DEFENDER_SCAN_TIMEOUT_MS: '500',
        }),
      ).toThrow(/PRINTBIT_DEFENDER_SCAN_TIMEOUT_MS/);

      expect(() =>
        getDefenderConfig({
          PRINTBIT_DEFENDER_SCAN_TIMEOUT_MS: '600000',
        }),
      ).toThrow(/PRINTBIT_DEFENDER_SCAN_TIMEOUT_MS/);
    });
  });

  describe('getHealth', () => {
    it('reports clean when Defender is active and signatures are fresh', async () => {
      runner.run.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          AMRunningMode: 'Normal',
          AntivirusEnabled: true,
          AntivirusSignatureLastUpdated: new Date(
            Date.now() - 24 * 60 * 60 * 1000,
          ).toISOString(),
        }),
        stderr: '',
        timedOut: false,
      });

      const scanner = createDefenderScanner({ runner });
      const health = await scanner.getHealth();

      expect(health.status).toBe('clean');
      expect(health.signatureAgeHours).toBeCloseTo(24, 0);
      expect(health.detail).toBeNull();
    });

    it('fails closed when Defender is inactive or signatures are older than 168 hours', async () => {
      runner.run.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          AMRunningMode: 'Normal',
          AntivirusEnabled: true,
          AntivirusSignatureLastUpdated: new Date(
            Date.now() - 169 * 60 * 60 * 1000,
          ).toISOString(),
        }),
        stderr: '',
        timedOut: false,
      });

      await expect(
        createDefenderScanner({ runner }).getHealth(),
      ).resolves.toMatchObject({
        status: 'stale',
        signatureAgeHours: expect.any(Number),
      });
    });

    it('reports unavailable when Defender is disabled', async () => {
      runner.run.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          AMRunningMode: 'Normal',
          AntivirusEnabled: false,
          AntivirusSignatureLastUpdated: new Date().toISOString(),
        }),
        stderr: '',
        timedOut: false,
      });

      const health = await createDefenderScanner({ runner }).getHealth();
      expect(health.status).toBe('unavailable');
      expect(health.signatureAgeHours).toBeNull();
    });

    it('reports unavailable when AMRunningMode is not Normal', async () => {
      runner.run.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          AMRunningMode: 'Disabled',
          AntivirusEnabled: true,
          AntivirusSignatureLastUpdated: new Date().toISOString(),
        }),
        stderr: '',
        timedOut: false,
      });

      const health = await createDefenderScanner({ runner }).getHealth();
      expect(health.status).toBe('unavailable');
    });

    it('reports unavailable when status query times out', async () => {
      runner.run.mockResolvedValueOnce({
        exitCode: null,
        stdout: '',
        stderr: '',
        timedOut: true,
      });

      const health = await createDefenderScanner({ runner }).getHealth();
      expect(health.status).toBe('unavailable');
      expect(health.detail).toContain('timed out');
    });

    it('reports unavailable when status query throws an error', async () => {
      runner.run.mockRejectedValueOnce(new Error('PowerShell spawn failed'));

      const health = await createDefenderScanner({ runner }).getHealth();
      expect(health.status).toBe('unavailable');
      expect(health.detail).toContain('PowerShell spawn failed');
    });

    it('reports unavailable when JSON output is malformed', async () => {
      runner.run.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'not-json-output',
        stderr: '',
        timedOut: false,
      });

      const health = await createDefenderScanner({ runner }).getHealth();
      expect(health.status).toBe('unavailable');
    });
  });

  describe('scanFile', () => {
    const fakeStagedPath = 'C:\\staging\\test-uuid.upload';
    const fakeMpCmdRun = 'C:\\Program Files\\Windows Defender\\MpCmdRun.exe';
    const fakeFs = {
      existsSync: jest.fn((p: string) => p === fakeMpCmdRun),
      readdirSync: jest.fn(() => []),
    };

    it('returns clean when Defender exits 0 with no threats', async () => {
      runner.run.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Scan finished. No threats detected.',
        stderr: '',
        timedOut: false,
      });

      const scanner = createDefenderScanner({
        runner,
        fsAdapter: fakeFs,
      });
      const result = await scanner.scanFile(fakeStagedPath);

      expect(result).toEqual({
        status: 'clean',
        detectionName: null,
        detail: null,
      });
      expect(runner.run).toHaveBeenCalledWith(
        expect.stringMatching(/MpCmdRun\.exe$/i),
        ['-Scan', '-ScanType', '3', '-File', fakeStagedPath, '-DisableRemediation'],
        expect.any(Number),
      );
    });

    it('reports an EICAR-style Defender detection as infected and never as clean', async () => {
      runner.run.mockResolvedValueOnce({
        exitCode: 2,
        stdout: 'Threat detected: EICAR-Test-File',
        stderr: '',
        timedOut: false,
      });

      await expect(
        createDefenderScanner({ runner, fsAdapter: fakeFs }).scanFile(
          fakeStagedPath,
        ),
      ).resolves.toEqual({
        status: 'infected',
        detectionName: 'EICAR-Test-File',
        detail: null,
      });
    });

    it('reports infected when exit code is 2 even if threat name is in standard Defender format', async () => {
      runner.run.mockResolvedValueOnce({
        exitCode: 2,
        stdout: 'LISTING 1 THREATS:\nThreat: Virus:DOS/EICAR_Test_File\nResources: file: ' + fakeStagedPath,
        stderr: '',
        timedOut: false,
      });

      const result = await createDefenderScanner({
        runner,
        fsAdapter: fakeFs,
      }).scanFile(fakeStagedPath);

      expect(result.status).toBe('infected');
      expect(result.detectionName).toBe('Virus:DOS/EICAR_Test_File');
      expect(result.detail).toBeNull();
    });

    it('reports timeout when scanner times out', async () => {
      runner.run.mockResolvedValueOnce({
        exitCode: null,
        stdout: '',
        stderr: '',
        timedOut: true,
      });

      const result = await createDefenderScanner({
        runner,
        fsAdapter: fakeFs,
      }).scanFile(fakeStagedPath);

      expect(result.status).toBe('timeout');
      expect(result.detectionName).toBeNull();
      expect(result.detail).toContain('timed out');
    });

    it('reports failed when exit code is unexpected non-zero', async () => {
      runner.run.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'MpCmdRun: Command failed with error 0x80070002',
        timedOut: false,
      });

      const result = await createDefenderScanner({
        runner,
        fsAdapter: fakeFs,
      }).scanFile(fakeStagedPath);

      expect(result.status).toBe('failed');
      expect(result.detectionName).toBeNull();
      expect(result.detail).toContain('0x80070002');
    });

    it('reports unavailable when MpCmdRun executable cannot be found', async () => {
      const emptyFs = {
        existsSync: jest.fn(() => false),
        readdirSync: jest.fn(() => []),
      };

      const result = await createDefenderScanner({
        runner,
        fsAdapter: emptyFs,
      }).scanFile(fakeStagedPath);

      expect(result.status).toBe('unavailable');
      expect(result.detail).toContain('MpCmdRun.exe');
      expect(runner.run).not.toHaveBeenCalled();
    });

    it('truncates diagnostic detail to 500 characters', async () => {
      const longError = 'E'.repeat(1000);
      runner.run.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: longError,
        timedOut: false,
      });

      const result = await createDefenderScanner({
        runner,
        fsAdapter: fakeFs,
      }).scanFile(fakeStagedPath);

      expect(result.status).toBe('failed');
      expect(result.detail?.length).toBeLessThanOrEqual(500);
    });
  });
});
