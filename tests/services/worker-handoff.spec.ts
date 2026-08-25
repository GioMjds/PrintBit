import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { handoffToWorker } from '@/services/worker-handoff';

describe('worker-handoff', () => {
	it('copies a PDF into the worker queue dir', async () => {
		const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pb-worker-'));
		const queueDir = path.join(baseDir, 'queue');
		await fs.mkdir(queueDir, { recursive: true });
		const sourcePath = path.join(baseDir, 'sample.pdf');
		await fs.writeFile(sourcePath, 'PDFDATA');

		const result = await handoffToWorker({
			sourcePath,
			queueDir,
			transactionId: 'tx-123',
			spoolerCorrelationKey: 'spool-456',
		});

		const targetContent = await fs.readFile(result.targetPath, 'utf-8');
		expect(targetContent).toBe('PDFDATA');
		expect(result.fileName.endsWith('.pdf')).toBe(true);
	});

	it('writes legacy print settings and v2 correlation IDs in the JSON sidecar', async () => {
		const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pb-worker-'));
		const queueDir = path.join(baseDir, 'queue');
		await fs.mkdir(queueDir, { recursive: true });
		const sourcePath = path.join(baseDir, 'sample.pdf');
		await fs.writeFile(sourcePath, 'PDFDATA');

		const result = await handoffToWorker({
			sourcePath,
			queueDir,
			transactionId: 'tx-123',
			spoolerCorrelationKey: 'spool-456',
			printSettings: {
				copies: 2,
				color: true,
				pageRange: '3-7',
				orientation: 'landscape',
			},
		});

		const sidecarPath = path.join(queueDir, result.fileName.replace(/\.pdf$/, '.json'));
		const sidecar = JSON.parse(await fs.readFile(sidecarPath, 'utf-8'));
		expect(sidecar).toEqual({
			copies: 2,
			color: true,
			pageRange: '3-7',
			orientation: 'landscape',
			quality: 'standard',
			schemaVersion: 2,
			transactionId: 'tx-123',
			spoolerCorrelationKey: 'spool-456',
		});
	});

	it('writes quality in the JSON sidecar', async () => {
		const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pb-worker-'));
		const queueDir = path.join(baseDir, 'queue');
		await fs.mkdir(queueDir, { recursive: true });
		const sourcePath = path.join(baseDir, 'sample.pdf');
		await fs.writeFile(sourcePath, 'PDFDATA');

		const result = await handoffToWorker({
			sourcePath,
			queueDir,
			transactionId: 'tx-123',
			spoolerCorrelationKey: 'spool-456',
			printSettings: {
				copies: 1,
				color: false,
				quality: 'high',
			},
		});

		const sidecarPath = path.join(queueDir, result.fileName.replace(/\.pdf$/, '.json'));
		const sidecar = JSON.parse(await fs.readFile(sidecarPath, 'utf-8'));
		expect(sidecar.quality).toBe('high');
	});

	it('throws when queue directory is missing', async () => {
		const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pb-worker-'));
		const sourcePath = path.join(baseDir, 'sample.pdf');
		await fs.writeFile(sourcePath, 'PDFDATA');

		await expect(
			handoffToWorker({
				sourcePath,
				queueDir: path.join(baseDir, 'missing'),
				transactionId: 'tx-123',
				spoolerCorrelationKey: 'spool-456',
			}),
		).rejects.toMatchObject({
			code: 'WORKER_QUEUE_UNAVAILABLE',
		});
	});
});
