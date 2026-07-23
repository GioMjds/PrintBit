import net from 'node:net';
import { sendWorkerCommand, WorkerCommandPayload } from '@/services/worker-command-pipe';

describe('worker-command-pipe', () => {
  const pipeName = 'test-printbit-worker-commands';
  const pipePath = `\\\\.\\pipe\\${pipeName}`;
  let mockServer: net.Server;
  let receivedData: string[] = [];

  beforeEach((done) => {
    receivedData = [];
    mockServer = net.createServer((socket) => {
      socket.on('data', (chunk) => {
        receivedData.push(chunk.toString());
      });
    });
    mockServer.listen(pipePath, () => done());
  });

  afterEach((done) => {
    mockServer.close(() => done());
  });

  it('sends JSON framed command payload over named pipe', async () => {
    const payload: WorkerCommandPayload = {
      type: 'cancel_job',
      transactionId: 'tx_20260723_190105_abc1',
      spoolerCorrelationKey: 'spooler_def2',
      reason: 'User cancelled remaining pages',
      timestampUtc: '2026-07-23T11:06:27.000Z',
    };

    const success = await sendWorkerCommand(payload, { pipeName, timeoutMs: 2000 });

    expect(success).toBe(true);
    expect(receivedData.length).toBeGreaterThan(0);
    const parsed = JSON.parse(receivedData.join('').trim());
    expect(parsed.type).toBe('cancel_job');
    expect(parsed.spoolerCorrelationKey).toBe('spooler_def2');
  });
});
