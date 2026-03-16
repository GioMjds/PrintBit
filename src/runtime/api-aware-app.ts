import type { Express } from 'express';

type RoutableMethod =
  | 'get'
  | 'post'
  | 'put'
  | 'patch'
  | 'delete'
  | 'use'
  | 'all'
  | 'head'
  | 'options';

const ROUTABLE_METHODS: RoutableMethod[] = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'use',
  'all',
  'head',
  'options',
];

function remapApiPath(path: string, apiBasePath: string): string {
  if (path === apiBasePath) return '/';
  return path.slice(apiBasePath.length) || '/';
}

function shouldUseApiRouter(path: string, apiBasePath: string): boolean {
  return path === apiBasePath || path.startsWith(`${apiBasePath}/`);
}

export function createApiAwareApp(
  app: Express,
  apiRouter: unknown,
  apiBasePath: string,
): Express {
  const routed = Object.create(app) as Express;
  const routerMethods = apiRouter as Record<string, Function>;

  for (const method of ROUTABLE_METHODS) {
    const appMethod = (app as unknown as Record<string, Function>)[method].bind(
      app,
    );
    const routerMethod = routerMethods[method].bind(apiRouter);

    (routed as unknown as Record<string, Function>)[method] = (
      ...args: unknown[]
    ) => {
      const [firstArg, ...rest] = args;
      if (
        typeof firstArg === 'string' &&
        shouldUseApiRouter(firstArg, apiBasePath)
      ) {
        const remappedPath = remapApiPath(firstArg, apiBasePath);
        return routerMethod(remappedPath, ...rest);
      }

      return appMethod(...args);
    };
  }

  return routed;
}
