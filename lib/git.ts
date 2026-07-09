import fs from "node:fs";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { VAULT_DIR, GIT_SYNC_ENABLED } from "@/lib/config";

/**
 * On boot: if GIT_SYNC is on and VAULT_DIR isn't yet a git repo, clone GIT_REMOTE
 * into it. This is how the deployed app populates its volume from the remote vault
 * repo — so no machine keeps a local copy, the server just checks one out.
 */
export async function ensureVaultRepo(): Promise<void> {
  if (!GIT_SYNC_ENABLED) return;
  const remote = process.env.GIT_REMOTE;
  if (!remote) return;
  if (fs.existsSync(path.join(VAULT_DIR, ".git"))) return;
  const token = process.env.GIT_TOKEN;
  const url = token && remote.startsWith("https://")
    ? remote.replace("https://", `https://x-access-token:${token}@`)
    : remote;
  try {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
    await simpleGit().clone(url, VAULT_DIR);
    console.log(`[git] cloned vault repo into ${VAULT_DIR}`);
  } catch (e) {
    console.error("[git] vault clone failed", e);
  }
}

let git: SimpleGit | null = null;
function getGit(): SimpleGit {
  if (!git) git = simpleGit(VAULT_DIR);
  return git;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: string[] = [];
let running = false;

/** Debounced commit + pull --rebase + push of vault changes. No-op unless GIT_SYNC_ENABLED. */
export function requestSync(reason: string): void {
  if (!GIT_SYNC_ENABLED) return;
  pending.push(reason);
  if (timer) clearTimeout(timer);
  timer = setTimeout(runSync, 2500);
}

async function runSync(): Promise<void> {
  if (running) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(runSync, 2500);
    return;
  }
  running = true;
  const reasons = pending;
  pending = [];
  try {
    const g = getGit();
    await g.add(["-A"]);
    const status = await g.status();
    if (status.files.length === 0) {
      running = false;
      return;
    }
    const name = process.env.GIT_AUTHOR_NAME || "Cortex";
    const email = process.env.GIT_AUTHOR_EMAIL || "cortex@localhost";
    await g
      .env({
        ...process.env,
        GIT_AUTHOR_NAME: name,
        GIT_AUTHOR_EMAIL: email,
        GIT_COMMITTER_NAME: name,
        GIT_COMMITTER_EMAIL: email,
      })
      .commit(`brain: ${reasons.length} change(s) — ${reasons.slice(0, 3).join("; ")}`);
    try {
      await g.pull(["--rebase", "--autostash"]);
    } catch (e) {
      console.error("[git] pull failed", e);
    }
    try {
      await g.push();
    } catch (e) {
      console.error("[git] push failed", e);
    }
  } catch (e) {
    console.error("[git] sync failed", e);
  } finally {
    running = false;
  }
}

export async function syncStatus() {
  if (!GIT_SYNC_ENABLED) return { enabled: false as const };
  try {
    const s = await getGit().status();
    return { enabled: true as const, dirty: s.files.length, ahead: s.ahead, behind: s.behind, branch: s.current };
  } catch {
    return { enabled: true as const, error: true };
  }
}
