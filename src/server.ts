import express, { Application } from "express";
import {
  setupServerConfig,
  validateServerEnvironment,
  ServerConfigOptions,
} from "./config/serverConfig";
import { createError, errorHandler } from "./middleware/errorHandler";
import { timeoutErrorHandler } from "./middleware/timeout";

/**
 * Creates and configures a fully setup Express Application instance.
 */
export function createConfiguredServer(
  options?: ServerConfigOptions,
): Application {
  const app = express();
  setupServerConfig(app, options);
  return app;
}

/**
 * Attaches global error handlers to Express Application.
 */
export function registerErrorHandlers(app: Application): void {
  app.use(timeoutErrorHandler);
  app.use(errorHandler);
}

export { setupServerConfig, validateServerEnvironment };
