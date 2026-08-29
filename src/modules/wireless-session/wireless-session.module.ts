import type { Express } from 'express';
import type { ModuleContext } from '../module.types';
import type { Request } from 'express';
import type { Namespace } from 'socket.io';
import type { SessionStore } from '@/services/session';
import { WirelessSessionService } from './wireless-session.service';
import { WirelessSessionController } from './wireless-session.controller';

export interface WirelessSessionModuleDeps extends ModuleContext {
  sessionIo: Namespace;
  sessionStore: SessionStore;
  resolvePublicBaseUrl: (req: Request) => URL;
  convertToPdfPreview: (sourcePath: string) => Promise<string>;
}

export function registerWirelessSessionModule(
  app: Express,
  deps: WirelessSessionModuleDeps,
): void {
  const service = new WirelessSessionService({
    io: deps.io,
    sessionIo: deps.sessionIo,
    sessionStore: deps.sessionStore,
    resolvePublicBaseUrl: deps.resolvePublicBaseUrl,
    convertToPdfPreview: deps.convertToPdfPreview,
  });
  const controller = new WirelessSessionController(service);
  app.use(controller.router);
}

