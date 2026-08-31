import path from 'node:path';
import type { Request, Response } from 'express';
import type { Namespace, Server } from 'socket.io';
import type { SessionStore } from '@/services/session';
import { WirelessSessionService } from '@/modules/wireless-session/wireless-session.service';

function createPreviewService(convertToPdfPreview = jest.fn()): WirelessSessionService {
  const sessionStore = {
    tryGetSession: jest.fn(() => ({
      document: {
        documentId: 'document-1',
        filename: 'proposal.docx',
        filePath: 'uploads/proposal.docx',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: 1024,
      },
      documents: [],
    })),
    touchSession: jest.fn(() => true),
  } as unknown as SessionStore;

  return new WirelessSessionService({
    io: {} as Server,
    sessionIo: {} as Namespace,
    sessionStore,
    resolvePublicBaseUrl: () => new URL('http://127.0.0.1:3000'),
    convertToPdfPreview,
  });
}

test('serves authenticated DOCX source bytes without waiting for PDF conversion', async () => {
  const convertToPdfPreview = jest.fn();
  const service = createPreviewService(convertToPdfPreview);
  const req = {
    params: { sessionId: 'session-1' },
    query: { filename: 'proposal.docx', source: '1' },
  } as unknown as Request<{ sessionId: string }>;
  const res = {
    setHeader: jest.fn(),
    sendFile: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as Response;

  await service.getSessionPreview(req, res, jest.fn());

  expect(convertToPdfPreview).not.toHaveBeenCalled();
  expect(res.setHeader).toHaveBeenCalledWith(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  expect(res.sendFile).toHaveBeenCalledWith(
    path.resolve('uploads/proposal.docx'),
  );
});
