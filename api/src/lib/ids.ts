import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijkmnpqrstvwxyz"; // no i, l, o, u

/** Prefixed, URL-safe, copy-pasteable ids. `auc_3f9a2c7b1d4e` */
export function generateId(prefix: string, length = 12): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `${prefix}_${out}`;
}

export const newAuctionRef = () => generateId("auc");
export const newBidRef = () => generateId("bid");
export const newRefundRef = () => generateId("ref");
export const newEventRef = () => generateId("evt");
export const newEndpointRef = () => generateId("whe");
export const newRequestId = () => generateId("req", 16);
