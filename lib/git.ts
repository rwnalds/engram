import fs from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { activeVaultDir, getActive } from "@/lib/repos";
import { gitAuthor, gitSyncEnabled } from "@/lib/settings";
import { rebuildIndex } from "@/lib/vault/store";

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: string[] = [];

/**
 * A single in-flight guard shared by BOTH the write-sync (runSync) and the pull loop (pullActive),
 * so at most one git operation ever touches the vault repo at a time. Two concurrent git ops on one
 * repo mean index.lock contention and half-finished rebases; worse, under load the piled-up child
 * processes exhaust the container's fork()/thread budget, which makes libuv abort the whole process
 * (the SIGABRT + "getaddrinfo() thread failed to start" crash loop). Serializing pins the live git
 * subprocess count at one. If the lock is held, the caller skips (pull loop) or reschedules
 * (write-sync) instead of stacking more work on top.
 */
let gitBusy = false;
async function withGitLock<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (gitBusy) return undefined;
  gitBusy = true;
  try {
    return await fn();
  } finally {
    gitBusy = false;
  }
}

/**
 * The vault dir ONLY when it's safe to run git there: it must be its OWN repo root (a `.git`
 * directly inside it). This covers connected workspaces (their clone is a repo root) and a
 * self-hosted VAULT_DIR that is a real repo, while excluding the bundled sample vault — which
 * has no `.git` of its own and would otherwise resolve to Engram's own repo. Returns null if
 * unsafe, so we never commit the app itself or surface its history.
 */
export function gitVaultDir(): string | null {
  const dir = activeVaultDir();
  return fs.existsSync(path.join(dir, ".git")) ? dir : null;
}

/**
 * The environment for a git child process.
 *
 * simple-git refuses to run when an editor variable is inherited from the host
 * ("Use of GIT_EDITOR is not permitted without enabling allowUnsafeEditor"), because a
 * hostile value would execute arbitrary code. Plenty of shells and CI images export one, and
 * the only symptom was a console.error while the vault quietly stopped syncing — so strip
 * them rather than re-permitting them. `-m` commits need no editor anyway.
 *
 * GIT_TERMINAL_PROMPT=0 stops a missing credential from hanging the push forever.
 */
function commitEnv(name: string, email: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === "GIT_EDITOR" || k === "GIT_SEQUENCE_EDITOR") continue;
    env[k] = v;
  }
  return {
    ...env,
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_TERMINAL_PROMPT: "0",
  };
}

/**
 * Debounced commit + pull --rebase + push of the active vault. No-op unless git-sync is on
 * AND the vault is its own git repo (see gitVaultDir).
 */
export function requestSync(reason: string): void {
  if (!gitSyncEnabled() || !gitVaultDir()) return;
  pending.push(reason);
  if (timer) clearTimeout(timer);
  timer = setTimeout(runSync, 2500);
}

async function runSync(): Promise<void> {
  const reasons = pending;
  pending = [];
  const ran = await withGitLock(async () => {
    try {
      const dir = gitVaultDir(); // may have changed since the debounce fired
      if (!dir) return;
      const g = simpleGit(dir);
      await g.add(["-A"]);
      const status = await g.status();
      if (status.files.length === 0) return;
      const { name, email } = gitAuthor();
      await g.env(commitEnv(name, email)).commit(`brain: ${reasons.length} change(s) — ${reasons.slice(0, 3).join("; ")}`);
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
    }
  });
  if (ran === undefined) {
    // The lock was held by a pull. The changed files are still dirty on disk, so don't drop them:
    // re-queue the reasons and retry once the repo is free.
    pending.unshift(...reasons);
    if (timer) clearTimeout(timer);
    timer = setTimeout(runSync, 2500);
  }
}

export async function syncStatus() {
  const dir = gitVaultDir();
  if (!dir || !gitSyncEnabled()) return { enabled: false as const };
  try {
    const s = await simpleGit(dir).status();
    return { enabled: true as const, dirty: s.files.length, ahead: s.ahead, behind: s.behind, branch: s.current };
  } catch {
    return { enabled: true as const, error: true };
  }
}

/**
 * Pull remote commits into the ACTIVE vault clone (rebase, autostash). This is how changes
 * pushed to the repo from OUTSIDE Engram (an agent, a teammate, a direct git push) show up —
 * the chokidar watcher then rebuilds the index. Independent of the push side; a fresh
 * connected workspace should always reflect its remote. No-op for the sample/local vault.
 */
export async function pullActive(): Promise<{ ok: boolean; changed: boolean; error?: string }> {
  const active = getActive();
  if (!active) return { ok: true, changed: false };
  const result = await withGitLock(async () => {
    const dir = activeVaultDir();
    try {
      const g = simpleGit(dir);
      const before = await g.revparse(["HEAD"]).catch(() => "");
      await g.pull(["--rebase", "--autostash"]); // pull already fetches — a separate g.fetch() only doubles the child processes
      const after = await g.revparse(["HEAD"]).catch(() => "");
      const changed = before !== after;
      if (changed) rebuildIndex();
      return { ok: true, changed };
    } catch (e) {
      console.error("[git] pull failed", e);
      return { ok: false, changed: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  // undefined = a sync was already in flight; a skipped tick is not an error.
  return result ?? { ok: true, changed: false };
}

export interface ActivityEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
}

/**
 * Recent commits to the active vault — the "who did what to the brain" feed (agents + humans;
 * git-sync commits look like `brain: N change(s) — …`), most-recent first. Read-only. Empty
 * unless the vault is its own git repo (see gitVaultDir), so we never surface Engram's own
 * history via the sample vault.
 */
export async function vaultActivity(maxCount = 50): Promise<ActivityEntry[]> {
  const dir = gitVaultDir();
  if (!dir) return [];
  try {
    const log = await simpleGit(dir).log({ maxCount });
    return log.all.map((c) => ({
      hash: c.hash.slice(0, 7),
      message: c.message,
      author: c.author_name,
      date: c.date,
    }));
  } catch {
    return [];
  }
}

export interface CommitFile {
  /** Single-letter git status: A(dded) M(odified) D(eleted) R(enamed) C(opied) T(ypechange). */
  status: string;
  /** Vault-relative path of the file after the change (the new path for renames). */
  path: string;
  /** Previous path, for renames/copies. */
  oldPath?: string;
  /** The per-file patch body (starts with `diff --git`). Empty if none/binary. */
  diff: string;
  additions: number;
  deletions: number;
  binary: boolean;
}
export interface CommitDetail {
  hash: string;
  message: string;
  author: string;
  date: string;
  files: CommitFile[];
  truncated: boolean;
}

const MAX_DIFF = 200_000; // cap the total patch we ship to the client

function parseNameStatus(raw: string): { status: string; path: string; oldPath?: string }[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const status = parts[0][0];
      if ((status === "R" || status === "C") && parts.length >= 3) {
        return { status, oldPath: parts[1], path: parts[2] };
      }
      return { status, path: parts[parts.length - 1] };
    });
}

/** Path a per-file diff block targets (new path for renames, original for deletes). */
function diffBlockPath(chunk: string): string | null {
  const plus = chunk.match(/^\+\+\+ b\/(.+)$/m);
  if (plus && plus[1] !== "/dev/null") return plus[1];
  const minus = chunk.match(/^--- a\/(.+)$/m);
  if (minus && minus[1] !== "/dev/null") return minus[1];
  const git = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m);
  return git ? git[2] : null;
}

/** Split a raw `git show` patch into per-file blocks keyed by path. */
function splitDiffByFile(diff: string): Map<string, string> {
  const map = new Map<string, string>();
  const idx = diff.indexOf("diff --git ");
  if (idx === -1) return map;
  const parts = diff.slice(idx).split(/\ndiff --git /);
  parts.forEach((p, i) => {
    const chunk = (i === 0 ? p : "diff --git " + p).trimEnd();
    const path = diffBlockPath(chunk);
    if (path) map.set(path, chunk);
  });
  return map;
}

/**
 * What a single commit changed: metadata + each touched file with its own patch, add/del counts,
 * and status. Guarded like the rest — only the active vault, only a valid hash. Null if unavailable.
 */
export async function commitChanges(hash: string): Promise<CommitDetail | null> {
  const dir = gitVaultDir();
  if (!dir) return null;
  if (!/^[0-9a-f]{4,40}$/i.test(hash)) return null; // avoid passing arbitrary args to git
  try {
    const g = simpleGit(dir);
    const meta = await g.raw(["show", "-s", "--no-color", "--format=%h%x1f%an%x1f%aI%x1f%s", hash]);
    const [shortHash, author, date, message] = meta.trim().split("\x1f");
    const nameStatus = await g.raw(["show", "--no-color", "--format=", "--name-status", hash]);
    const rawDiff = await g.raw(["show", "--no-color", "--format=", "--patch", hash]);
    const truncated = rawDiff.length > MAX_DIFF;
    const blocks = splitDiffByFile(truncated ? rawDiff.slice(0, MAX_DIFF) : rawDiff);

    const files: CommitFile[] = parseNameStatus(nameStatus).map((f) => {
      const body = blocks.get(f.path) ?? "";
      return {
        ...f,
        diff: body,
        additions: (body.match(/^\+(?!\+\+)/gm) || []).length,
        deletions: (body.match(/^-(?!--)/gm) || []).length,
        binary: /^Binary files /m.test(body),
      };
    });

    return { hash: shortHash || hash.slice(0, 7), message: message ?? "", author: author ?? "", date: date ?? "", files, truncated };
  } catch {
    return null;
  }
}

let pullTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Poll the remote for the active vault so the brain stays fresh without a redeploy. Self-reschedules
 * instead of using setInterval: the next tick is queued only after the current pull settles, so a
 * slow pull can never overlap the next one. On failure it backs off exponentially (30s healthy →
 * capped ~16min) so a network/DNS blip can't become a tight retry loop that spawns git processes
 * faster than they exit — the pile-up that aborted the process.
 */
export function startPullLoop(baseMs = 30_000): void {
  if (pullTimer) return;
  let failures = 0;
  const tick = async () => {
    const res = await pullActive().catch(() => ({ ok: false as const }));
    failures = res.ok ? 0 : Math.min(failures + 1, 5);
    pullTimer = setTimeout(tick, baseMs * 2 ** failures);
    pullTimer.unref?.();
  };
  pullTimer = setTimeout(tick, baseMs);
  pullTimer.unref?.();
}
