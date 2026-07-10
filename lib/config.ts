import path from "node:path";

/** Public display name (also exposed to the client via NEXT_PUBLIC_APP_NAME). */
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Engram";

/**
 * Absolute path to the markdown vault (the knowledge, source of truth).
 * Defaults to the bundled `sample-vault/` for local dev / OSS demo.
 * In production set VAULT_DIR to the mounted volume (e.g. /data) that holds the
 * real, remote vault repo (cloned + git-synced by the app).
 */
export const VAULT_DIR = process.env.VAULT_DIR
  ? path.resolve(process.env.VAULT_DIR)
  : path.resolve(process.cwd(), "sample-vault");

/**
 * Fixed data dir for app state + managed vault clones (repos.json, tokens.json,
 * vaults/<id>/). Separate from any vault's content. On Railway set to the volume, e.g. /data.
 */
export const DATA_ROOT = process.env.ENGRAM_DATA_DIR
  ? path.resolve(process.env.ENGRAM_DATA_DIR)
  : path.resolve(process.cwd(), ".engram-data");

/** Directory names never treated as vault content (app code, git internals, build output). */
export const VAULT_IGNORE = new Set(
  (process.env.VAULT_IGNORE ?? "app,.git,node_modules,.next,.github,infra")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

/**
 * Top-level folders whose notes are historical: demoted in search and excluded by default.
 * Purely a ranking hint — the notes stay readable, and nothing is hidden from brain_read.
 */
export const ARCHIVE_FOLDERS = new Set(
  (process.env.ARCHIVE_FOLDERS ?? "archive,archives,_archive,trash")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

/** Bearer token required to call the MCP endpoint. */
export const MCP_TOKEN = process.env.MCP_TOKEN ?? "";

/** Google-auth email allowlist for the dashboard. Empty + AUTH_DISABLED=true => open local mode. */
export const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/** GitHub usernames allowed to sign in (dashboard auth is GitHub-only). */
export const ALLOWED_GITHUB_LOGINS = (process.env.ALLOWED_GITHUB_LOGINS ?? "")
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

/** GitHub OAuth app — for connecting vault repos from the dashboard. */
export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? "";
export const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? "";

export const SESSION_COOKIE = "engram_session";

/**
 * The values below are ENV FALLBACKS/DEFAULTS. Most are now also configurable at
 * runtime in the dashboard Settings page (persisted under ENGRAM_DATA_DIR). When a
 * setting is saved in the UI it WINS; the env value here is only the default.
 * Resolve them through `lib/settings.ts` (gitSyncEnabled(), gitAuthor(),
 * harnessEnabled(), anthropicApiKey(), captureModel(), appName(), github*()),
 * never by importing these consts directly into feature code.
 */

/**
 * Env default for the git-sync loop (commit + push the active vault). ON by default —
 * it's a headline feature; set GIT_SYNC_ENABLED="false" to opt out. Only ever acts on a
 * connected workspace repo (guarded by getActive() in lib/git.ts), never the sample vault.
 */
export const GIT_SYNC_ENABLED = process.env.GIT_SYNC_ENABLED !== "false";
/** Env default commit identity for git-sync. */
export const GIT_AUTHOR_NAME = process.env.GIT_AUTHOR_NAME || "Engram";
export const GIT_AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL || "engram@localhost";

/** Env default Anthropic key for the brain_capture harness (rough dump -> filed note). */
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
/** Optional env seed for the brain_capture model. Must be a supported id (see lib/models.ts)
 *  to take effect; otherwise captureModel() falls back to DEFAULT_CAPTURE_MODEL. */
export const CAPTURE_MODEL = process.env.CAPTURE_MODEL ?? "";

/**
 * Env default for the server-side auto-filing harness (brain_capture). OFF by default:
 * a capable coding agent can do the filing itself over the plain MCP tools with no extra
 * server tokens. The effective flag also requires an Anthropic key — see harnessEnabled().
 */
export const HARNESS_ENABLED_ENV = process.env.HARNESS_ENABLED === "true";
