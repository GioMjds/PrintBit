import type { Express, Request, Response } from "express";
import type { SessionStore } from "../services/session";

type PageRoute = { route: string; filePath: string };

interface RegisterPageRoutesDeps {
  sessionStore: SessionStore;
  publicPageRoutes: PageRoute[];
  resolvePublicBaseUrl: (req: Request) => URL;
}

export function registerPageRoutes(app: Express, deps: RegisterPageRoutesDeps) {
  app.get("/favicon.ico", (_req: Request, res: Response) => {
    res.sendStatus(204);
  });

  app.get("/upload", (req: Request, res: Response) => {
    const session = deps.sessionStore.createSession(deps.resolvePublicBaseUrl(req));
    res.redirect(`/upload/${encodeURIComponent(session.token)}`);
  });

  for (const page of deps.publicPageRoutes) {
    app.get(page.route, (_req: Request, res: Response) => {
      res.sendFile(page.filePath);
    });
  }
}
