import { randomBytes } from "node:crypto";

export function generateRequestId() {
  return `reqid_${randomBytes(16).toString("base64url")}`;
}
