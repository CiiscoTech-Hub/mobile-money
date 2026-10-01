/**
 * Express Application with Swagger UI Documentation Middleware
 */

import app from "./index";
import { docsRouter } from "./routes/docs";
import { compressionMiddleware } from "./middleware/compression";

// Configure HTTP response compression middleware (Gzip & Brotli support, 1KB threshold)
if (process.env.COMPRESSION_ENABLED !== "false") {
  app.use(compressionMiddleware);
}

// Ensure Swagger UI is mounted at /api/docs
app.use("/api/docs", docsRouter);

export { app, compressionMiddleware };
export default app;
