import path from "node:path";
import type { Express, Request, Response } from "express";

interface RegisterUploadPortalRoutesDeps {
  portalDir: string;
  portalAssets: Set<string>;
  renderUploadPortal: (token: string, portalHtmlPath: string) => string;
}

export function registerUploadPortalRoutes(
  app: Express,
  deps: RegisterUploadPortalRoutesDeps,
) {
  app.get("/upload/:token", (req: Request, res: Response) => {
    try {
      const { token } = req.params as { token: string };
      const html = deps.renderUploadPortal(
        token,
        path.join(deps.portalDir, "index.html"),
      );
      res.send(html);
    } catch (error) {
      console.error("Error rendering upload portal:", error);
      res.status(404).send("Error loading upload portal");
    }
  });

  app.get("/upload/:token/:asset", (req: Request, res: Response) => {
    const { asset } = req.params as { asset: string };

    if (!deps.portalAssets.has(asset)) {
      return res.status(404).send("Not found.");
    }

    const filePath = path.join(deps.portalDir, asset);
    res.sendFile(filePath, (err) => {
      if (err) res.status(404).send("Asset not found.");
    });
  });
}
