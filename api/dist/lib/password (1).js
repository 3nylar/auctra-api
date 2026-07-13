import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCb);
const KEY_LENGTH = 64;
/**
 * Password hashing via Node's built-in scrypt — deliberately not bcrypt or
 * argon2. Both are excellent choices, but both are native addons: a compiled
 * binary that has to match the exact OS and Node version of wherever this
 * runs. This project has already lost real hours to exactly that class of
 * mismatch (see the Prisma engine saga in the deploy history). scrypt is
 * built into Node itself — nothing to compile, nothing to mismatch.
 *
 * Stored format: "salt:hash", both hex. The salt travels with the hash, so
 * verifying never needs a second lookup.
 */
export async function hashPassword(password) {
    const salt = randomBytes(16).toString("hex");
    const derived = (await scrypt(password, salt, KEY_LENGTH));
    return `${salt}:${derived.toString("hex")}`;
}
export async function verifyPassword(password, stored) {
    const [salt, hashHex] = stored.split(":");
    if (!salt || !hashHex)
        return false;
    const derived = (await scrypt(password, salt, KEY_LENGTH));
    const expected = Buffer.from(hashHex, "hex");
    // Constant-time comparison, same reasoning as everywhere else in this
    // codebase that compares a secret: an early-exit `===` leaks, byte by
    // byte, how much of a guess was correct.
    return expected.length === derived.length && timingSafeEqual(expected, derived);
}
