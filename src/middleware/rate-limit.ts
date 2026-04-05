import type { Request, RequestHandler } from 'express';

type RateLimitMessage = string | { error: string };

export interface RateLimitOptions {
  keyPrefix: string;
  windowMs: number;
  max: number;
  message?: RateLimitMessage;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const DEFAULT_MESSAGE = { error: 'Too many requests. Please try again later.' };
const buckets = new Map<string, RateLimitBucket>();

function getClientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown-client';
}

function purgeExpiredBuckets(now: number): void {
  if (buckets.size < 10_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function createRateLimit(options: RateLimitOptions): RequestHandler {
  const { keyPrefix, windowMs, max, message = DEFAULT_MESSAGE } = options;

  return (req, res, next) => {
    const now = Date.now();
    purgeExpiredBuckets(now);

    const bucketKey = `${keyPrefix}:${getClientKey(req)}`;
    const bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (bucket.count >= max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((bucket.resetAt - now) / 1000),
      );
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429);
      if (typeof message === 'string') {
        res.type('text/plain').send(message);
        return;
      }
      res.json(message);
      return;
    }

    bucket.count += 1;
    next();
  };
}
