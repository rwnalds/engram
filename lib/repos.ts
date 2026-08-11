import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { DATA_ROOT, VAULT_DIR } from "@/lib/config";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
// The clones go through the same queue as every other git command (see lib/git-queue.ts). A clone
// is the heaviest git operation there is, and the boot path runs one at the moment Next.js is at
// peak memory — exactly when an unserialized second git process is what tips the container over.
import { runGit } from "@/lib/git-queue";

const REPOS_FILE = path.join(DATA_ROOT, "repos.json");
const VAULTS_DIR = path.join(DATA_ROOT, "vaults");

export interface Repo {
  id: string;
  name: string;
  fullName?: string;
  url: string;
  branch: string;
  active: boolean;
  addedAt: string;
}
interface StoredRepo extends Repo {
  tokenEnc?: string;
}

function ensureData() {
  fs.mkdirSync(VAULTS_DIR, { recursive: true });
}
function load(): StoredRepo[] {
  try {
    return JSON.parse(fs.readFileSync(REPOS_FILE, "utf8"));
  } catch {
    return [];
  }
}
function save(repos: StoredRepo[]) {
  ensureData();
  fs.writeFileSync(REPOS_FILE, JSON.stringify(repos, null, 2));
}
const strip = ({ tokenEnc, ...r }: StoredRepo): Repo => r;

export function vaultDirFor(id: string): string {
  return path.join(VAULTS_DIR, id);
}

/** The active vault dir — the active workspace's clone, or the fallback VAULT_DIR (sample/local). */
export function activeVaultDir(): string {
  const active = load().find((r) => r.active);
  return active ? vaultDirFor(active.id) : VAULT_DIR;
}

export function listRepos(): Repo[] {
  return load().map(strip);
}
export function getActive(): Repo | null {
  const a = load().find((r) => r.active);
  return a ? strip(a) : null;
}
export function repoToken(id: string): string | null {
  const r = load().find((x) => x.id === id);
  if (!r?.tokenEnc) return null;
  try {
    return decryptSecret(r.tokenEnc);
  } catch {
    return null;
  }
}
export function activeRepoToken(): string | null {
  const a = load().find((r) => r.active);
  return a ? repoToken(a.id) : null;
}

function authedUrl(url: string, token?: string): string {
  return token && url.startsWith("https://")
    ? url.replace("https://", `https://x-access-token:${token}@`)
    : url;
}

export async function addRepo(opts: {
  name: string;
  url: string;
  token?: string;
  branch?: string;
  fullName?: string;
  setActive?: boolean;
}): Promise<Repo> {
  ensureData();
  const id = crypto.randomUUID();
  const all = load();
  const makeActive = opts.setActive ?? all.length === 0;
  if (makeActive) all.forEach((r) => (r.active = false));

  const dir = vaultDirFor(id);
  fs.rmSync(dir, { recursive: true, force: true });
  await runGit(() => simpleGit().clone(authedUrl(opts.url, opts.token), dir));

  const rec: StoredRepo = {
    id,
    name: opts.name,
    fullName: opts.fullName,
    url: opts.url,
    branch: opts.branch || "main",
    active: makeActive,
    addedAt: new Date().toISOString(),
    tokenEnc: opts.token ? encryptSecret(opts.token) : undefined,
  };
  all.push(rec);
  save(all);
  return strip(rec);
}

export function setActive(id: string): void {
  const all = load();
  if (!all.some((r) => r.id === id)) return;
  all.forEach((r) => (r.active = r.id === id));
  save(all);
}

/** Rename a workspace (display name only — the clone + remote are untouched). */
export function renameRepo(id: string, name: string): Repo | null {
  const all = load();
  const rec = all.find((r) => r.id === id);
  if (!rec) return null;
  const trimmed = name.trim();
  if (trimmed) rec.name = trimmed;
  save(all);
  return strip(rec);
}

export function removeRepo(id: string): void {
  save(load().filter((r) => r.id !== id));
  try {
    fs.rmSync(vaultDirFor(id), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/** Re-clone the active repo if its working dir is missing (e.g. fresh volume). */
export async function ensureActiveCloned(): Promise<void> {
  const a = load().find((r) => r.active);
  if (!a) return;
  const dir = vaultDirFor(a.id);
  if (fs.existsSync(path.join(dir, ".git"))) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    await runGit(() => simpleGit().clone(authedUrl(a.url, a.tokenEnc ? decryptSecret(a.tokenEnc) : undefined), dir));
  } catch (e) {
    console.error("[repos] re-clone failed", e);
  }
}
