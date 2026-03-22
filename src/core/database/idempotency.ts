/**
 * Idempotency key store for preventing duplicate request processing.
 * Keys are namespaced by route to avoid cross-endpoint collisions.
 */

const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface IdempotencyEntry {
  response: unknown;
  statusCode: number;
  expiresAt: number;
}

interface InFlightEntry {
  promise: Promise<IdempotencyEntry | null>;
  resolve: (entry: IdempotencyEntry | null) => void;
}

const idempotencyStore = new Map<string, IdempotencyEntry>();
const idempotencyInFlight = new Map<string, InFlightEntry>();

function namespacedKey(key: string, namespace: string): string {
  return `${namespace}\x00${key}`;
}

/** Creates a Promise together with its resolve function. */
function makeDeferred(): {
  promise: Promise<IdempotencyEntry | null>;
  resolve: (entry: IdempotencyEntry | null) => void;
} {
  let resolve!: (entry: IdempotencyEntry | null) => void;
  const promise = new Promise<IdempotencyEntry | null>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Try to claim an idempotency key for the given namespace.
 *
 * Returns:
 *  - `{ type: "hit", entry }` — a completed response is cached; replay it.
 *  - `{ type: "inflight", promise }` — another request is processing this key;
 *    await the promise and replay (or 503 if it resolves to null).
 *  - `{ type: "claimed" }` — this call has reserved the key; proceed with the
 *    request and then call `storeIdempotencyKey` or `releaseIdempotencyKey`.
 */
export function acquireIdempotencyKey(
  key: string,
  namespace: string,
):
  | { type: 'hit'; entry: IdempotencyEntry }
  | { type: 'inflight'; promise: Promise<IdempotencyEntry | null> }
  | { type: 'claimed' } {
  const nk = namespacedKey(key, namespace);

  const completed = idempotencyStore.get(nk);
  if (completed) {
    if (Date.now() <= completed.expiresAt)
      return { type: 'hit', entry: completed };
    idempotencyStore.delete(nk);
  }

  const inFlight = idempotencyInFlight.get(nk);
  if (inFlight) return { type: 'inflight', promise: inFlight.promise };

  // Reserve the slot with a deferred promise so concurrent duplicates wait.
  const deferred = makeDeferred();
  idempotencyInFlight.set(nk, deferred);
  return { type: 'claimed' };
}

/** Finalise a claimed slot with the actual response. */
export function storeIdempotencyKey(
  key: string,
  namespace: string,
  statusCode: number,
  response: unknown,
): void {
  const nk = namespacedKey(key, namespace);
  const entry: IdempotencyEntry = {
    response,
    statusCode,
    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
  };
  idempotencyStore.set(nk, entry);
  const inFlight = idempotencyInFlight.get(nk);
  if (inFlight) {
    inFlight.resolve(entry);
    idempotencyInFlight.delete(nk);
  }
}

/**
 * Release a claimed slot without caching a response (e.g. on server error).
 * Waiting duplicates will receive `null` and should return 503.
 */
export function releaseIdempotencyKey(key: string, namespace: string): void {
  const nk = namespacedKey(key, namespace);
  const inFlight = idempotencyInFlight.get(nk);
  if (inFlight) {
    inFlight.resolve(null);
    idempotencyInFlight.delete(nk);
  }
}

// Periodic cleanup of expired idempotency keys
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of idempotencyStore) {
    if (now > entry.expiresAt) idempotencyStore.delete(key);
  }
}, IDEMPOTENCY_TTL_MS);
