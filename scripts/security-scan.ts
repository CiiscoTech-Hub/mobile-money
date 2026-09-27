import { execSync } from "child_process";
import fs from "fs";
import path from "path";

export interface SecurityCheckResult {
  name: string;
  category: "dependency" | "secret" | "config" | "headers";
  status: "pass" | "warn" | "fail";
  message: string;
  details?: Record<string, unknown>;
}

export async function runSecurityScan(): Promise<{
  passed: boolean;
  results: SecurityCheckResult[];
}> {
  const results: SecurityCheckResult[] = [];
  const rootDir = process.cwd();

  // 1. Check for sensitive files checked into git
  const sensitivePatterns = [
    ".env.local",
    ".env.production",
    "id_rsa",
    "private_key.pem",
    "stellar_secret.txt",
  ];

  for (const pattern of sensitivePatterns) {
    const filePath = path.join(rootDir, pattern);
    if (fs.existsSync(filePath)) {
      results.push({
        name: `Sensitive File Check: ${pattern}`,
        category: "secret",
        status: "warn",
        message: `Found potentially sensitive file ${pattern} in workspace. Ensure it is excluded in .gitignore.`,
      });
    }
  }

  // 2. Check .gitignore contains essential security exclusions
  const gitignorePath = path.join(rootDir, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    const requiredPatterns = [".env", "node_modules", "dist", "*.pem", "*.key"];
    const missing = requiredPatterns.filter((p) => !content.includes(p));

    if (missing.length === 0) {
      results.push({
        name: "Gitignore Security Baseline",
        category: "config",
        status: "pass",
        message:
          "All baseline sensitive file patterns are excluded in .gitignore",
      });
    } else {
      results.push({
        name: "Gitignore Security Baseline",
        category: "config",
        status: "warn",
        message: `Missing recommended patterns in .gitignore: ${missing.join(", ")}`,
      });
    }
  }

  // 3. Check security configuration in package.json
  const packageJsonPath = path.join(rootDir, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const hasAuditScript = !!(
      pkg.scripts &&
      (pkg.scripts["audit:high"] || pkg.scripts["security:scan"])
    );
    const hasHelmet = !!(pkg.dependencies && pkg.dependencies["helmet"]);
    const hasRateLimit = !!(
      pkg.dependencies && pkg.dependencies["express-rate-limit"]
    );

    results.push({
      name: "Security Middleware & Dependencies",
      category: "config",
      status: hasHelmet && hasRateLimit ? "pass" : "warn",
      message: `Helmet: ${hasHelmet ? "installed" : "missing"}, Rate-Limit: ${hasRateLimit ? "installed" : "missing"}, Audit scripts: ${hasAuditScript ? "present" : "missing"}`,
    });
  }

  // 4. Run npm audit programmatically if possible
  try {
    const auditOutput = execSync("npm audit --json", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const parsedAudit = JSON.parse(auditOutput);
    const vulnerabilities = parsedAudit.metadata?.vulnerabilities || {};
    const criticalCount = vulnerabilities.critical || 0;
    const highCount = vulnerabilities.high || 0;

    results.push({
      name: "NPM Dependency Vulnerability Audit",
      category: "dependency",
      status: criticalCount > 0 ? "fail" : highCount > 0 ? "warn" : "pass",
      message: `Vulnerabilities found - Critical: ${criticalCount}, High: ${highCount}, Moderate: ${vulnerabilities.moderate || 0}, Low: ${vulnerabilities.low || 0}`,
      details: vulnerabilities,
    });
  } catch (err: any) {
    if (err.stdout) {
      try {
        const parsedAudit = JSON.parse(err.stdout);
        const vulnerabilities = parsedAudit.metadata?.vulnerabilities || {};
        const criticalCount = vulnerabilities.critical || 0;
        const highCount = vulnerabilities.high || 0;

        results.push({
          name: "NPM Dependency Vulnerability Audit",
          category: "dependency",
          status: criticalCount > 0 ? "fail" : highCount > 0 ? "warn" : "pass",
          message: `Vulnerabilities found - Critical: ${criticalCount}, High: ${highCount}, Moderate: ${vulnerabilities.moderate || 0}, Low: ${vulnerabilities.low || 0}`,
          details: vulnerabilities,
        });
      } catch {
        results.push({
          name: "NPM Dependency Vulnerability Audit",
          category: "dependency",
          status: "warn",
          message: "npm audit exited with non-zero status",
        });
      }
    } else {
      results.push({
        name: "NPM Dependency Vulnerability Audit",
        category: "dependency",
        status: "warn",
        message: `Could not run npm audit: ${err.message}`,
      });
    }
  }

  const passed = results.every((r) => r.status !== "fail");
  return { passed, results };
}

// CLI runner
if (require.main === module) {
  runSecurityScan()
    .then(({ passed, results }) => {
      console.log("\n🔒 Security Scanning Pipeline Report:\n" + "=".repeat(50));
      for (const res of results) {
        const icon =
          res.status === "pass" ? "✅" : res.status === "warn" ? "⚠️" : "❌";
        console.log(
          `${icon} [${res.category.toUpperCase()}] ${res.name}: ${res.message}`,
        );
      }
      console.log("=".repeat(50));
      if (!passed) {
        console.error("\n❌ Critical security check failed.");
        process.exit(1);
      }
      console.log("\n✅ Security scan completed successfully.\n");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Security scan error:", err);
      process.exit(1);
    });
}
