// Print strong random secrets for the env (AUTH_SECRET, MCP_TOKEN).
// Usage: bun run gen:secrets
import { randomBytes } from "node:crypto";

const token = () => randomBytes(32).toString("hex");

console.log(`AUTH_SECRET="${randomBytes(32).toString("base64")}"`);
console.log(`MCP_TOKEN="${token()}"`);
