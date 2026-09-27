import express from "express";
import request from "supertest";
import { loadConfigFiles } from "../../config/appConfig";
import { createCorsMiddleware } from "../cors";

describe("CORS middleware", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "development";
    loadConfigFiles("development");
  });

  test("allows origins configured in the application config files", async () => {
    const app = express();
    app.use(createCorsMiddleware());
    app.get("/test", (_req, res) => res.status(200).json({ ok: true }));

    const response = await request(app)
      .get("/test")
      .set("Origin", "http://localhost:3000");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
  });

  test("blocks origins not present in the configured allowlist", async () => {
    const app = express();
    app.use(createCorsMiddleware());
    app.get("/test", (_req, res) => res.status(200).json({ ok: true }));

    const response = await request(app)
      .get("/test")
      .set("Origin", "https://evil.example.com");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
