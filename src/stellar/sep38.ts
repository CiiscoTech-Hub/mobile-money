import { Router } from "express";
import { slidingRateLimiter } from "../middleware/slidingRateLimiter";

const sep38Router = Router();

const quoteRateLimiter = slidingRateLimiter({
  windowMs: 60 * 1000,
  anonymousLimit: 60,
  authenticatedLimit: 600,
});

sep38Router.use("/prices", quoteRateLimiter);
sep38Router.use("/quote", quoteRateLimiter);

export default sep38Router;
