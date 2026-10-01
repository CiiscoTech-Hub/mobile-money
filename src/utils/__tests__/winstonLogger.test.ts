import fs from "fs";
import path from "path";
import os from "os";
import DailyRotateFile from "winston-daily-rotate-file";
import defaultWinstonLogger, {
  createDailyRotateTransport,
  createWinstonRotateLogger,
} from "../winstonLogger";

function createTempLogDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "winston-rotate-test-"));
}

describe("Winston Daily Rotate File Helper", () => {
  it("exports default winston logger instance and helper functions", () => {
    expect(defaultWinstonLogger).toBeDefined();
    expect(typeof defaultWinstonLogger.info).toBe("function");
    expect(typeof createDailyRotateTransport).toBe("function");
    expect(typeof createWinstonRotateLogger).toBe("function");
  });

  it("creates a DailyRotateFile transport with default 14-day retention and YYYY-MM-DD date pattern", () => {
    const tempDir = createTempLogDir();
    const transport = createDailyRotateTransport({ dirname: tempDir });

    expect(transport).toBeInstanceOf(DailyRotateFile);
    expect(transport.options.maxFiles).toBe("14d");
    expect(transport.options.datePattern).toBe("YYYY-MM-DD");
    expect(transport.options.filename).toBe("app-%DATE%.log");
    expect(transport.options.dirname).toBe(tempDir);
    expect(transport.options.zippedArchive).toBe(true);
  });

  it("allows custom retention limits and date patterns", () => {
    const tempDir = createTempLogDir();
    const transport = createDailyRotateTransport({
      dirname: tempDir,
      filename: "custom-%DATE%.log",
      datePattern: "YYYY-MM-DD-HH",
      maxFiles: "7d",
      maxSize: "10m",
      level: "warn",
    });

    expect(transport.options.maxFiles).toBe("7d");
    expect(transport.options.datePattern).toBe("YYYY-MM-DD-HH");
    expect(transport.options.filename).toBe("custom-%DATE%.log");
    expect(transport.options.maxSize).toBe("10m");
    expect(transport.level).toBe("warn");
  });

  it("creates a Winston logger instance with daily rotate transports for app and error logs", () => {
    const tempDir = createTempLogDir();
    const logger = createWinstonRotateLogger({
      logDir: tempDir,
      logLevel: "debug",
      maxFiles: "14d",
    });

    expect(logger.level).toBe("debug");
    expect(logger.transports).toHaveLength(2); // app and error daily rotate transports in test mode

    const appTransport = logger.transports[0] as DailyRotateFile;
    const errorTransport = logger.transports[1] as DailyRotateFile;

    expect(appTransport.options.maxFiles).toBe("14d");
    expect(appTransport.options.filename).toBe("app-%DATE%.log");

    expect(errorTransport.options.maxFiles).toBe("14d");
    expect(errorTransport.options.filename).toBe("error-%DATE%.log");
    expect(errorTransport.level).toBe("error");
  });

  it("writes logs into date-stamped log files", (done) => {
    const tempDir = createTempLogDir();
    const logger = createWinstonRotateLogger({
      logDir: tempDir,
      logLevel: "info",
    });

    logger.info("Test log message for daily rotate file");
    logger.error("Test error message for daily rotate file");

    setTimeout(() => {
      const files = fs.readdirSync(tempDir);
      const logFiles = files.filter((f) => f.endsWith(".log"));
      expect(logFiles.length).toBeGreaterThan(0);

      const dateStr = new Date().toISOString().slice(0, 10);
      const appLogFile = files.find((f) => f.includes(`app-${dateStr}`));
      const errorLogFile = files.find((f) => f.includes(`error-${dateStr}`));

      expect(appLogFile).toBeDefined();
      expect(errorLogFile).toBeDefined();

      const appContent = fs.readFileSync(path.join(tempDir, appLogFile!), "utf8");
      expect(appContent).toContain("Test log message for daily rotate file");

      done();
    }, 500);
  });
});
