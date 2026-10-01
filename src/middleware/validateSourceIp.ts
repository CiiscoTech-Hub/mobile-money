import { Request, Response, NextFunction } from "express";
import ipaddr from "ipaddr.js";
import { getConfigValue } from "../config/appConfig";
import logger from "../utils/logger";

export function validateSourceIp(provider: "mtn" | "airtel" | "orange" | "orangeMadagascar") {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const providersConfig = getConfigValue("providers");
      const providerConfig = providersConfig[provider];
      
      if (!providerConfig || typeof providerConfig.allowedIps !== "string") {
        logger.warn({ provider }, "No allowed IP configuration found for provider. Skipping IP validation.");
        return next();
      }
      
      const allowedIpsStr = providerConfig.allowedIps.trim();
      if (!allowedIpsStr) {
        // Empty configuration means no IP restrictions
        return next();
      }

      const allowedBlocks = allowedIpsStr.split(",").map(ip => ip.trim()).filter(Boolean);
      
      let reqIp = req.ip || req.socket.remoteAddress;
      
      if (!reqIp) {
        logger.warn({ provider }, "Could not determine request IP");
        return res.status(403).json({ status: "error", message: "Forbidden: Cannot determine source IP" });
      }

      // ipaddr.js process() helps with IPv4-mapped IPv6 addresses (e.g. ::ffff:192.168.1.1)
      let parsedReqIp;
      try {
        parsedReqIp = ipaddr.process(reqIp);
      } catch (err) {
        logger.warn({ provider, ip: reqIp }, "Failed to parse request IP");
        return res.status(403).json({ status: "error", message: "Forbidden: Invalid IP format" });
      }

      let isAllowed = false;
      
      for (const block of allowedBlocks) {
        try {
          if (block.includes("/")) {
            const parsedCidr = ipaddr.parseCIDR(block);
            if (parsedReqIp.kind() === parsedCidr[0].kind() && parsedReqIp.match(parsedCidr)) {
              isAllowed = true;
              break;
            }
          } else {
            const parsedAllowedIp = ipaddr.parse(block);
            if (parsedReqIp.kind() === parsedAllowedIp.kind() && parsedReqIp.toString() === parsedAllowedIp.toString()) {
              isAllowed = true;
              break;
            }
          }
        } catch (err) {
          logger.error({ provider, block, error: err }, "Invalid allowed IP/CIDR configured");
        }
      }

      if (!isAllowed) {
        logger.warn({ provider, ip: reqIp }, "Request from unauthorized IP");
        return res.status(403).json({ status: "error", message: "Forbidden: Unauthorized source IP" });
      }

      next();
    } catch (error) {
      logger.error({ provider, error }, "Error validating source IP");
      return res.status(500).json({ status: "error", message: "Internal server error" });
    }
  };
}
