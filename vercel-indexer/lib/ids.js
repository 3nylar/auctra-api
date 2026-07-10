import { randomBytes } from "node:crypto";
const ALPHABET = "0123456789abcdefghijkmnpqrstvwxyz";
export function generateId(prefix, length = 12) {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${prefix}_${out}`;
}
export const newBidRef = () => generateId("bid");
export const newRefundRef = () => generateId("ref");
export const newEventRef = () => generateId("evt");
