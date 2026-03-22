import { Router, Request, Response, NextFunction } from 'express';

export class HopperController {
  public readonly router: Router;

  constructor() {
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    // TODO: Define routes
  }
}
