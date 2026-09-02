import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

jest.mock('@/core/database/sqlite-storage', () => ({
  wirelessSessionStore: {
    listSessionSnapshots: jest.fn(() => []),
    saveSessionSnapshot: jest.fn(),
    touchSession: jest.fn(),
    deleteSession: jest.fn(),
  },
}));

import { SessionStore } from '@/services/session';

function uploadFile(name: string, content: string): Express.Multer.File {
  return {
    originalname: name,
    mimetype: 'application/pdf',
    size: Buffer.byteLength(content),
    buffer: Buffer.from(content),
  } as Express.Multer.File;
}

test('rejects identical upload content under a different filename in one session', async () => {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printbit-duplicate-upload-'));
  const store = new SessionStore(uploadDir, { expiryEnabled: false });
  const session = store.createSession(new URL('http://127.0.0.1:3000'));

  try {
    const first = await store.storeUpload(
      session.sessionId,
      session.token,
      uploadFile('assessment.pdf', 'identical document bytes'),
    );
    const duplicate = await store.storeUpload(
      session.sessionId,
      session.token,
      uploadFile('assessment-copy.pdf', 'identical document bytes'),
    );

    expect(first.isSuccess).toBe(true);
    expect(duplicate).toEqual(
      expect.objectContaining({
        isSuccess: false,
        errorCode: 'DUPLICATE_FILE',
      }),
    );
  } finally {
    store.dispose();
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
});
