import fs from "node:fs";
import path from "node:path";
import {
  ANTHROPIC_API_KEY,
  APP_NAME,
  CAPTURE_MODEL,
  DATA_ROOT,
  GIT_AUTHOR_EMAIL,
  GIT_AUTHOR_NAME,
  GIT_SYNC_ENABLED,
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  HARNESS_ENABLED_ENV,
} from "@/lib/config";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { DEFAULT_CAPTURE_MODEL, SUPPORTED_MODEL_IDS } from "@/lib/models";

/**
 * Runtime settings — the dashboard-editable half of the config.
 *
 * Instead of forcing every operator to set a dozen env vars on the host (and
 * redeploy to flip a toggle), Engram persists an overrides file next to the other
 * app state (tokens.json, repos.json) under ENGRAM_DATA_DIR. A saved override WINS
 * over the matching env var; when unset, the env default (see lib/config.ts) is used.
 * This keeps existing env-only deploys and OSS local dev working unchanged.
 *
 * Secrets (Anthropic key, GitHub client secret) are stored AES-encrypted at rest,
 * keyed off AUTH_SECRET — same as connected git tokens (lib/crypto.ts).
 */

// App state lives in the fixed data dir, separate from any vault content (matches lib/tokens.ts).
const STATE_DIR = process.env.ENGRAM_STATE_DIR || DATA_ROOT;
const SETTINGS_FILE = path.join(STATE_DIR, "settings.json");

/** On-disk shape — only keys the operator has overridden are present. */
interface StoredSettings {
  appName?: string;
  gitSyncEnabled?: boolean;
  gitAuthorName?: string;
  gitAuthorEmail?: string;
  /** Superseded by curatorMode; still read so existing deploys keep their behaviour. */
  harnessEnabled?: boolean;
  curatorMode?: CuratorMode;
  captureModel?: string;
  anthropicApiKeyEnc?: string;
  githubClientId?: string;
  githubClientSecretEnc?: string;
}

let cache: StoredSettings | null = null;

function load(): StoredSettings {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    cache = {};
  }
  return cache!;
}

function save(s: StoredSettings): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
  cache = s;
}

/** Decrypt a stored secret, falling back to "" if the key is missing/rotated. */
function safeDecrypt(enc?: string): string {
  if (!enc) return "";
  try {
    return decryptSecret(enc);
  } catch {
    return "";
  }
}

// ── Resolved getters (override ?? env default). Feature code uses THESE. ──────

export function appName(): string {
  return load().appName || APP_NAME;
}

export function gitSyncEnabled(): boolean {
  return load().gitSyncEnabled ?? GIT_SYNC_ENABLED;
}

export function gitAuthor(): { name: string; email: string } {
  const s = load();
  return {
    name: s.gitAuthorName || GIT_AUTHOR_NAME,
    email: s.gitAuthorEmail || GIT_AUTHOR_EMAIL,
  };
}

/** Model for brain_capture auto-filing. Always one of the supported ids (see lib/models.ts). */
export function captureModel(): string {
  const m = load().captureModel || CAPTURE_MODEL;
  return m && SUPPORTED_MODEL_IDS.has(m) ? m : DEFAULT_CAPTURE_MODEL;
}

export function anthropicApiKey(): string {
  return safeDecrypt(load().anthropicApiKeyEnc) || ANTHROPIC_API_KEY;
}

/**
 * What the Curator is allowed to be.
 *
 *  off  — Engram never calls a model. A deterministic MCP server + dashboard.
 *  chat — a grounded, read-only conversation with the vault, in the dashboard.
 *  full — chat may edit notes, and `brain_capture` is exposed over MCP so an agent can hand
 *         Engram a rough dump and let it choose the path. Neither surface can delete.
 *
 * Note this does NOT govern whether agents can mutate the vault: MCP write tools are
 * always available to a token with `write` scope (see lib/tokens.ts). The Curator only
 * governs whether *Engram itself* runs a model.
 */
export type CuratorMode = "off" | "chat" | "full";

/** The operator's chosen mode, migrating the old boolean harness flag. */
export function curatorModeFlag(): CuratorMode {
  const s = load();
  if (s.curatorMode) return s.curatorMode;
  return (s.harnessEnabled ?? HARNESS_ENABLED_ENV) ? "full" : "off";
}

/** Effective mode — a model needs a key, so without one the Curator is off however it's set. */
export function curatorMode(): CuratorMode {
  return anthropicApiKey() === "" ? "off" : curatorModeFlag();
}

/** Chat is available (read-only or better). */
export function curatorEnabled(): boolean {
  return curatorMode() !== "off";
}

/** The Curator may write: chat can edit notes, and brain_capture is exposed over MCP. */
export function harnessEnabled(): boolean {
  return curatorMode() === "full";
}

export function githubClientId(): string {
  return load().githubClientId || GITHUB_CLIENT_ID;
}

export function githubClientSecret(): string {
  return safeDecrypt(load().githubClientSecretEnc) || GITHUB_CLIENT_SECRET;
}

// ── Public (redacted) view for the Settings form ─────────────────────────────

export interface PublicSettings {
  appName: string;
  gitSyncEnabled: boolean;
  gitAuthorName: string;
  gitAuthorEmail: string;
  curatorModeFlag: CuratorMode; // the raw choice, independent of key presence
  curatorMode: CuratorMode; // effective: "off" unless a key is present
  captureModel: string;
  anthropicApiKeySet: boolean;
  githubClientId: string;
  githubClientSecretSet: boolean;
  /** Which fields are currently coming from env (shown as "inherited" hints in the UI). */
  envManaged: Record<string, boolean>;
}

export function publicSettings(): PublicSettings {
  const s = load();
  return {
    appName: appName(),
    gitSyncEnabled: gitSyncEnabled(),
    gitAuthorName: gitAuthor().name,
    gitAuthorEmail: gitAuthor().email,
    curatorModeFlag: curatorModeFlag(),
    curatorMode: curatorMode(),
    captureModel: captureModel(),
    anthropicApiKeySet: anthropicApiKey() !== "",
    githubClientId: githubClientId(),
    githubClientSecretSet: githubClientSecret() !== "",
    envManaged: {
      appName: s.appName === undefined && APP_NAME !== "Engram",
      gitSync: s.gitSyncEnabled === undefined && GIT_SYNC_ENABLED,
      anthropicApiKey: s.anthropicApiKeyEnc === undefined && ANTHROPIC_API_KEY !== "",
      githubClientId: s.githubClientId === undefined && GITHUB_CLIENT_ID !== "",
      githubClientSecret: s.githubClientSecretEnc === undefined && GITHUB_CLIENT_SECRET !== "",
    },
  };
}

// ── Update ───────────────────────────────────────────────────────────────────

/**
 * Patch semantics: a present key mutates that override. For text fields, "" clears
 * the override (revert to env/default). Secrets are only touched when a non-empty
 * value is sent, or explicitly cleared via the `clear*` flags. Booleans set an
 * explicit override.
 */
export interface SettingsPatch {
  appName?: string;
  gitSyncEnabled?: boolean;
  gitAuthorName?: string;
  gitAuthorEmail?: string;
  curatorMode?: CuratorMode;
  captureModel?: string;
  anthropicApiKey?: string;
  clearAnthropicApiKey?: boolean;
  githubClientId?: string;
  githubClientSecret?: string;
  clearGithubClientSecret?: boolean;
}

function setText(s: StoredSettings, key: keyof StoredSettings, value: string | undefined): void {
  if (value === undefined) return;
  const v = value.trim();
  if (v === "") delete s[key];
  else (s[key] as string) = v;
}

export function updateSettings(patch: SettingsPatch): PublicSettings {
  const s = { ...load() };

  setText(s, "appName", patch.appName);
  setText(s, "gitAuthorName", patch.gitAuthorName);
  setText(s, "gitAuthorEmail", patch.gitAuthorEmail);
  setText(s, "captureModel", patch.captureModel);
  setText(s, "githubClientId", patch.githubClientId);

  if (patch.gitSyncEnabled !== undefined) s.gitSyncEnabled = patch.gitSyncEnabled;
  if (patch.curatorMode !== undefined) {
    s.curatorMode = patch.curatorMode;
    delete s.harnessEnabled; // the old boolean is fully superseded once a mode is chosen
  }

  // Secrets: set only when a value is typed; clear only on explicit request.
  if (patch.clearAnthropicApiKey) delete s.anthropicApiKeyEnc;
  else if (patch.anthropicApiKey && patch.anthropicApiKey.trim() !== "")
    s.anthropicApiKeyEnc = encryptSecret(patch.anthropicApiKey.trim());

  if (patch.clearGithubClientSecret) delete s.githubClientSecretEnc;
  else if (patch.githubClientSecret && patch.githubClientSecret.trim() !== "")
    s.githubClientSecretEnc = encryptSecret(patch.githubClientSecret.trim());

  save(s);
  return publicSettings();
}
