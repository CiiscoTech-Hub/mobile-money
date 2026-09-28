import request from "supertest";
import fs from "fs";
import app from "../../index";
import { OUTAGE_LOG_FILE, ALERT_LOG_FILE } from "../adminController";

describe("Admin Monitoring Controller & Dashboard API", () => {
  describe("GET /api/monitoring/dashboard (or /api/monitoring/circuit-breaker-status)", () => {
    it("should display circuit breaker status cleanly and return system summary", async () => {
      const res = await request(app).get("/api/monitoring/dashboard");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.circuitBreakers).toBeDefined();
      expect(Array.isArray(res.body.circuitBreakers)).toBe(true);

      const breakers = res.body.circuitBreakers;
      expect(breakers.length).toBeGreaterThan(0);

      const mtnBreaker = breakers.find((b: any) => b.provider === "mtn");
      expect(mtnBreaker).toBeDefined();
      expect(mtnBreaker.state).toMatch(/CLOSED|OPEN|HALF-OPEN/);
      expect(mtnBreaker.stats).toBeDefined();
    });
  });

  describe("POST /api/monitoring/outages", () => {
    it("should log outage status updates to Winston log files and trip circuit breaker on outage", async () => {
      const payload = {
        provider: "airtel",
        status: "OUTAGE",
        errorRate: 90,
        errorThreshold: 50,
        message: "Telco network disruption detected on Airtel gateway.",
      };

      const res = await request(app)
        .post("/api/monitoring/outages")
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.logEntry.provider).toBe("airtel");
      expect(res.body.logEntry.circuitBreakerState).toBe("OPEN");
      expect(res.body.alert).toBeDefined();
      expect(res.body.alert.engineeringTeamNotified).toBe(true);

      // Verify Winston log file exists and contains the outage record
      expect(fs.existsSync(OUTAGE_LOG_FILE)).toBe(true);
      const logContent = fs.readFileSync(OUTAGE_LOG_FILE, "utf-8");
      expect(logContent).toContain("airtel");
      expect(logContent).toContain("OUTAGE_STATUS_UPDATE");
    });
  });

  describe("POST /api/monitoring/alerts/test", () => {
    it("should confirm alert warnings function correctly for engineering teams", async () => {
      const payload = {
        provider: "orange",
        severity: "CRITICAL",
        message: "TEST ALERT: High error threshold exceeded on Orange Money",
        errorRate: 80,
        threshold: 50,
      };

      const res = await request(app)
        .post("/api/monitoring/alerts/test")
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.alert).toBeDefined();
      expect(res.body.alert.provider).toBe("orange");
      expect(res.body.alert.engineeringTeamNotified).toBe(true);
      expect(res.body.alert.message).toContain("TEST ALERT");

      // Verify alert log file contains warning
      expect(fs.existsSync(ALERT_LOG_FILE)).toBe(true);
      const alertLogContent = fs.readFileSync(ALERT_LOG_FILE, "utf-8");
      expect(alertLogContent).toContain("orange");
    });
  });

  describe("POST /api/monitoring/circuit-breaker/reset", () => {
    it("should reset circuit breaker status back to CLOSED", async () => {
      const res = await request(app)
        .post("/api/monitoring/circuit-breaker/reset")
        .send({ provider: "airtel" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const statusRes = await request(app).get("/api/monitoring/dashboard");
      const airtelBreaker = statusRes.body.circuitBreakers.find(
        (b: any) => b.provider === "airtel"
      );
      expect(airtelBreaker.state).toBe("CLOSED");
    });
  });

  describe("GET /api/monitoring/logs", () => {
    it("should retrieve Winston log records", async () => {
      const res = await request(app).get("/api/monitoring/logs");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.logs)).toBe(true);
      expect(res.body.logs.length).toBeGreaterThan(0);
    });
  });

  describe("GET /api/monitoring/provider-maintenance", () => {
    it("should list manual failover state for providers (#1550)", async () => {
      const res = await request(app).get(
        "/api/monitoring/provider-maintenance",
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.providers)).toBe(true);
    });
  });

  describe("POST /api/monitoring/provider-maintenance/:provider/toggle", () => {
    it("should reject the toggle when the caller is not an authenticated admin (#1550)", async () => {
      const res = await request(app)
        .post("/api/monitoring/provider-maintenance/airtel/toggle")
        .send({ enabled: false, reason: "Unplanned maintenance" });

      expect(res.status).toBe(403);
    });
  });
});
