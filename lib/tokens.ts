import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { VAULT_DIR } from "@/lib/config";

// App state (token hashes) lives beside the vault but is kept OUT of the vault's
// git history — so per-teammate keys never land in the knowledge repo.
const STATE_DIR = process.env.CORTEX_STATE_DIR || path.join(VAULT_DIR, ".cortex");
const TOKENS_FILE = path.join(STATE_DIR, "tokens.json");

interface StoredToken {
  id: string;
  name: string;
  hash: string;
  created: string;
}

export interface TokenMeta {
  id: string;
  name: string;
  created: string;
}

const hash = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  // Make sure git-sync never commits the state dir into the vault repo.
  try {
    const gi = path.join(VAULT_DIR, ".gitignore");
    let content = "";
    try {
      content = fs.readFileSync(gi, "utf8");
    } catch {
      /* none yet */
    }
    if (!content.split(/\r?\n/).some((l) => l.trim() === ".cortex/")) {
      fs.writeFileSync(gi, `${content && !content.endsWith("\n") ? `${content}\n` : content}.cortex/\n`);
    }
  } catch {
    /* best effort */
  }
}

function load(): StoredToken[] {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function save(tokens: StoredToken[]) {
  ensureStateDir();
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

export function listTokens(): TokenMeta[] {
  return load().map(({ id, name, created }) => ({ id, name, created }));
}

/** Create a token. Returns the plaintext value ONCE — only the hash is stored. */
export function createToken(name: string): { id: string; name: string; token: string } {
  const token = crypto.randomBytes(32).toString("hex");
  const rec: StoredToken = {
    id: crypto.randomUUID(),
    name: name?.trim() || "token",
    hash: hash(token),
    created: new Date().toISOString(),
  };
  const all = load();
  all.push(rec);
  save(all);
  return { id: rec.id, name: rec.name, token };
}

export function revokeToken(id: string): void {
  save(load().filter((t) => t.id !== id));
}

export function verifyToken(bearer: string): boolean {
  if (!bearer) return false;
  const h = hash(bearer);
  return load().some((t) => t.hash === h);
}

export function hasAnyToken(): boolean {
  return load().length > 0;
}
