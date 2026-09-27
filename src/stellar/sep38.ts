/**
 * SEP-38 entry point.
 *
 * index.ts imports the router from this file:
 *   import sep38Router from "./stellar/sep38";
 *   app.use("/sep38", sep38Router);
 *
 * The actual route handlers and rate-limiting middleware live in
 * src/routes/sep38.ts to keep this directory focused on Stellar protocol
 * logic and service abstractions.
 */
export { default } from "../routes/sep38";
