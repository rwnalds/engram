import path from "node:path";

/** Public display name (also exposed to the client via NEXT_PUBLIC_APP_NAME). */
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Cortex";

/**
 * Absolute path to the markdown vault (the knowledge, source of truth).
 * Defaults to the bundled `sample-vault/` for local dev / OSS demo.
 * In production set VAULT_DIR to the mounted volume (e.g. /data) that holds the
 * real, remote vault repo (cloned + git-synced by the app).
 */
export const VAULT_DIR = process.env.VAULT_DIR
  ? path.resolve(process.env.VAULT_DIR)
  : path.resolve(process.cwd(), "sample-vault");

/** Directory names never treated as vault content (app code, git internals, build output). */
export const VAULT_IGNORE = new Set(
  (process.env.VAULT_IGNORE ?? "app,.git,node_modules,.next,.github,infra")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

/** Bearer token required to call the MCP endpoint. */
export const MCP_TOKEN = process.env.MCP_TOKEN ?? "";

/** Google-auth email allowlist for the dashboard. Empty + AUTH_DISABLED=true => open local mode. */
export const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/** Single-user / local mode: no Google auth, MCP open. For OSS local dev only. */
export const AUTH_DISABLED = process.env.AUTH_DISABLED === "true";

/** Session-cookie signing secret. When empty, dashboard auth is OFF (local dev). */
export const AUTH_SECRET = process.env.AUTH_SECRET ?? "";
/** Public base URL (for the Google OAuth redirect_uri). */
export const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";

export const SESSION_COOKIE = "cortex_session";

/** When true, the git-sync loop commits + pushes vault changes to the remote. */
export const GIT_SYNC_ENABLED = process.env.GIT_SYNC_ENABLED === "true";

/** Anthropic key for the brain_capture harness (rough dump -> filed note). Optional. */
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
export const CAPTURE_MODEL = process.env.CAPTURE_MODEL ?? "claude-haiku-4-5-20251001";
