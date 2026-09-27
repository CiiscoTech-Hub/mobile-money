import logger from "./logger";
import bcrypt from "bcrypt";

const DEFAULT_BCRYPT_ROUNDS = 12;
const MIN_BCRYPT_ROUNDS = 12;

export function getBcryptRounds(): number {
  const envRounds = Number(process.env.BCRYPT_ROUNDS);
  if (!isNaN(envRounds) && envRounds >= MIN_BCRYPT_ROUNDS) {
    return envRounds;
  }
  return DEFAULT_BCRYPT_ROUNDS;
}

/**
 * Hash a plain text password
 * @param password Plain password to hash
 * @returns Promise<string> hashed password
 */
export async function hashPassword(password: string): Promise<string> {
  try {
    const rounds = getBcryptRounds();
    const hash = await bcrypt.hash(password, rounds);
    return hash;
  } catch (error) {
    logger.error(error, "Error hashing password:");
    throw new Error("Could not hash password");
  }
}

/**
 * Compare a plain text password with a hashed password
 * @param password Plain password
 * @param hash Hashed password
 * @returns Promise<boolean> true if match, false otherwise
 */
export async function comparePassword(
  password: string,
  hash: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    logger.error(error, "Error comparing password:");
    throw new Error("Could not compare password");
  }
}
