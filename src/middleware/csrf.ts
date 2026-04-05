import type { Request, RequestHandler } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function getRequestOriginHost(req: Request): string | null {
  const originHeader = req.get('origin');
  if (originHeader) {
    try {
      return new URL(originHeader).host.toLowerCase();
    } catch {
      return null;
    }
  }

  const refererHeader = req.get('referer');
  if (!refererHeader) return null;
  try {
    return new URL(refererHeader).host.toLowerCase();
  } catch {
    return null;
  }
}

function getRequestHost(req: Request): string {
  const hostHeader = req.get('x-forwarded-host') ?? req.get('host') ?? '';
  return hostHeader.toLowerCase();
}

export function createCsrfProtectionMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    const adminToken =
      typeof req.cookies?.adminToken === 'string'
        ? req.cookies.adminToken.trim()
        : '';
    if (!adminToken) {
      next();
      return;
    }

    const requestOriginHost = getRequestOriginHost(req);
    const requestHost = getRequestHost(req);
    if (
      !requestOriginHost ||
      !requestHost ||
      requestOriginHost !== requestHost
    ) {
      res.status(403).json({ error: 'Blocked by CSRF protection.' });
      return;
    }

    next();
  };
}
