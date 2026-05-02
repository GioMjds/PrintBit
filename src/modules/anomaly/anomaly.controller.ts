import { Router } from 'express';

export class AnomalyController {
  public readonly router: Router;

  constructor() {
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    // TODO: Define routes
  }
}
