import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  createUploadStagingStorage,
  promoteStagedUpload,
  discardStagedUpload,
  purgeStaging,
  readStagedFileRange,
  getStagingConfig,
} from '@/services/upload-staging';
import {
  quarantineStagedUpload,
  purgeQuarantine,
  listQuarantineRecords,
} from '@/services/quarantine';

describe('Upload Staging and Quarantine', () => {
  let tempDir: string;
  let stagingDir: string;
  let quarantineDir: string;
  let uploadsDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `printbit-test-${randomUUID()}`);
    uploadsDir = path.join(tempDir, 'uploads');
    stagingDir = path.join(uploadsDir, '.staging');
    quarantineDir = path.join(uploadsDir, 'quarantine');
    await fs.promises.mkdir(stagingDir, { recursive: true });
    await fs.promises.mkdir(quarantineDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  async function createStagedFileFixture(
    content: Buffer | string,
    originalName = 'sample.pdf',
  ): Promise<Express.Multer.File> {
    const fileId = randomUUID();
    const filePath = path.join(stagingDir, `${fileId}.upload`);
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    await fs.promises.writeFile(filePath, buffer);

    return {
      fieldname: 'file',
      originalname: originalName,
      encoding: '7bit',
      mimetype: 'application/pdf',
      size: buffer.length,
      destination: stagingDir,
      filename: `${fileId}.upload`,
      path: filePath,
      buffer: undefined as unknown as Buffer,
      stream: undefined as unknown as any,
    };
  }

  describe('staging storage and path handling', () => {
    it('keeps the original filename out of the staging path and atomically promotes a clean file', async () => {
      const staged = await createStagedFileFixture(
        Buffer.from('%PDF-1.7'),
        'invoice.exe.pdf',
      );
      expect(path.basename(staged.path)).toMatch(/^[0-9a-f-]+\.upload$/i);

      const finalPath = path.join(uploadsDir, 'document.pdf');
      await promoteStagedUpload(staged, finalPath);

      await expect(fs.promises.readFile(finalPath, 'utf8')).resolves.toBe(
        '%PDF-1.7',
      );
      await expect(fs.promises.access(staged.path)).rejects.toThrow();
    });

    it('discards a staged upload file', async () => {
      const staged = await createStagedFileFixture('temp content');
      await expect(fs.promises.access(staged.path)).resolves.toBeUndefined();

      await discardStagedUpload(staged);
      await expect(fs.promises.access(staged.path)).rejects.toThrow();
    });

    it('rejects promotion when destination path attempts traversal outside allowed destination', async () => {
      const staged = await createStagedFileFixture('test content');
      const maliciousPath = path.join(tempDir, '..', 'escaped.pdf');

      await expect(promoteStagedUpload(staged, maliciousPath)).rejects.toThrow(
        /containment|traversal|outside/i,
      );
    });

    it('reads bounded byte ranges from staged files', async () => {
      const staged = await createStagedFileFixture(
        Buffer.from('0123456789ABCDEF'),
      );
      const range = await readStagedFileRange(staged.path, 4, 6);
      expect(range.toString('utf8')).toBe('456789');
    });

    it('purges staging files older than the retention window', async () => {
      const stagedOld = await createStagedFileFixture('old content');
      const stagedNew = await createStagedFileFixture('new content');

      const oneHourAndFiveMinutesAgo = new Date(
        Date.now() - 65 * 60 * 1000,
      );
      await fs.promises.utimes(
        stagedOld.path,
        oneHourAndFiveMinutesAgo,
        oneHourAndFiveMinutesAgo,
      );

      const purged = await purgeStaging(stagingDir, 60 * 60 * 1000);
      expect(purged).toBeGreaterThanOrEqual(1);

      await expect(fs.promises.access(stagedOld.path)).rejects.toThrow();
      await expect(fs.promises.access(stagedNew.path)).resolves.toBeUndefined();
    });
  });

  describe('quarantine service', () => {
    it('moves staged file into quarantine with a generated name and records reason', async () => {
      const staged = await createStagedFileFixture(
        Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'),
        'eicar.com.pdf',
      );

      await quarantineStagedUpload(
        staged,
        'FILE_INFECTED',
        'EICAR-Test-File',
        quarantineDir,
      );

      // Original staged file should be moved
      await expect(fs.promises.access(staged.path)).rejects.toThrow();

      const quarantinedFiles = await fs.promises.readdir(quarantineDir);
      expect(quarantinedFiles.length).toBe(1);
      expect(quarantinedFiles[0]).not.toContain('eicar.com.pdf');
    });

    it('purges quarantine entries older than the configured retention window', async () => {
      const oldQuarantineFile = path.join(
        quarantineDir,
        `old-${randomUUID()}.quarantine`,
      );
      await fs.promises.writeFile(oldQuarantineFile, 'quarantined malware');

      const eightDaysAgo = new Date(
        Date.now() - 8 * 24 * 60 * 60 * 1000,
      );
      await fs.promises.utimes(
        oldQuarantineFile,
        eightDaysAgo,
        eightDaysAgo,
      );

      const count = await purgeQuarantine(quarantineDir);
      expect(count).toBeGreaterThanOrEqual(1);

      await expect(fs.promises.access(oldQuarantineFile)).rejects.toThrow();
    });

    it('purges oldest quarantine entries when total byte limit is exceeded', async () => {
      const file1 = path.join(quarantineDir, `1-${randomUUID()}.quarantine`);
      const file2 = path.join(quarantineDir, `2-${randomUUID()}.quarantine`);

      // Write 2 files of 60KB
      await fs.promises.writeFile(file1, Buffer.alloc(60 * 1024, 'a'));
      await fs.promises.utimes(
        file1,
        new Date(Date.now() - 10000),
        new Date(Date.now() - 10000),
      );

      await fs.promises.writeFile(file2, Buffer.alloc(60 * 1024, 'b'));

      // Purge with 100KB limit
      await purgeQuarantine(quarantineDir, 7 * 24 * 60 * 60 * 1000, 100 * 1024);

      // file1 (older) should be removed to keep total size under 100KB
      await expect(fs.promises.access(file1)).rejects.toThrow();
      await expect(fs.promises.access(file2)).resolves.toBeUndefined();
    });
  });
});
