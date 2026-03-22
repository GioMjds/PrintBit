/**
 * Module registration pattern types.
 * Each module implements this interface for consistent registration.
 */
import type { Express } from 'express';
import type { Server as SocketIOServer } from 'socket.io';

/**
 * Common dependencies available to all modules.
 */
export interface ModuleContext {
  io: SocketIOServer;
}

/**
 * Module registration function signature.
 * Each module exports a function matching this type.
 */
export type ModuleRegisterFn<TDeps extends ModuleContext = ModuleContext> = (
  app: Express,
  deps: TDeps,
) => void;

/**
 * Module definition with metadata.
 */
export interface ModuleDefinition<TDeps extends ModuleContext = ModuleContext> {
  name: string;
  register: ModuleRegisterFn<TDeps>;
}
