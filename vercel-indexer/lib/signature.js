import { createHmac } from "node:crypto";
export function signPayload(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signed = `${timestamp}.${payload}`;
  const v1 = createHmac("sha256", secret).update(signed).digest("hex");
  return { header: `t=${timestamp},v1=${v1}`, timestamp, v1 };
}
