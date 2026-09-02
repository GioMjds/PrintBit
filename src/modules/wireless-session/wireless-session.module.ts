import type { Express } from 'express';
import type { ModuleContext } from '../module.types';
import type { Request } from 'express';
import type { Namespace } from 'socket.io';
import type { SessionStore } from '@/services/session';
import type { PowerSafetyService } from '@/services/power-safety';
import { WirelessSessionService } from './wireless-session.service';
import { WirelessSessionController } from './wireless-session.controller';

export interface WirelessSessionModuleDeps extends ModuleContext {
  sessionIo: Namespace;
  sessionStore: SessionStore;
  resolvePublicBaseUrl: (req: Request) => URL;
  convertToPdfArtifact: (
    sourcePath: string,
    artifactPath: string,
  ) => Promise<string>;
  powerSafetyService?: PowerSafetyService;
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
    convertToPdfArtifact: deps.convertToPdfArtifact,
    powerSafetyService: deps.powerSafetyService,
  });
  const controller = new WirelessSessionController(
    service,
    deps.powerSafetyService,
  );
  app.use(controller.router);
}
