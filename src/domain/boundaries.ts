export type BackendLayer = 'state' | 'runtime' | 'domain' | 'controllers';

export interface BackendBoundary {
  owns: readonly string[];
  shouldAvoid: readonly string[];
}

export const BACKEND_BOUNDARIES: Record<BackendLayer, BackendBoundary> =
  Object.freeze({
    state: {
      owns: ['schema', 'normalization', 'persistence adapters', 'repositories'],
      shouldAvoid: ['express handlers', 'socket transport', 'request parsing'],
    },
    runtime: {
      owns: ['cross-cutting primitives', 'idempotency', 'locks', 'route helpers'],
      shouldAvoid: ['business rules', 'db schema ownership'],
    },
    domain: {
      owns: ['business rules', 'orchestration', 'invariants'],
      shouldAvoid: ['raw req/res handling', 'static file routing'],
    },
    controllers: {
      owns: ['http request parsing', 'response shaping', 'endpoint registration'],
      shouldAvoid: ['direct low-level db mutations', 'hardware orchestration logic'],
    },
  });
