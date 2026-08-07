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

/**
 * Returned when the lock was held and `fn` never ran.
 *
 * A Symbol, not `undefined`: the original guard returned `undefined` for "skipped", but a callback
 * typed `Promise<void>` also resolves to `undefined`, so "we skipped" and "we ran and finished"
 * were the same value. `runSync` therefore treated EVERY successful sync as a skip — it re-queued
 * its reasons and rescheduled itself, forever. The vault's git history shows it plainly: on
 * 2026-08-06 the commit subjects grew `1 change(s)` → `2` → `3` → `4` → `5`, each repeating every
 * earlier reason, because `pending` never drained. A sentinel that cannot be produced by `fn`
 * makes the two cases impossible to confuse.
 */
const SKIPPED = Symbol("git-busy");

async function withGitLock<T>(fn: () => Promise<T>): Promise<T | typeof SKIPPED> {
  if (gitBusy) return SKIPPED;
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
 * The environment for a git child process: the host environment with every `GIT_*` inherited
 * variable dropped, plus the identity and prompt settings this sync needs.
 *
 * simple-git refuses to spawn when certain variables are inherited from the host — `GIT_EDITOR`,
 * `GIT_ASKPASS`, `GIT_CONFIG_COUNT` and friends — because a hostile value would execute arbitrary
 * code or rewrite config. It throws, and the only symptom is a console.error while the vault
 * quietly stops syncing and the write tools keep answering `ok: true`.
 *
 * The previous version named two variables (`GIT_EDITOR`, `GIT_SEQUENCE_EDITOR`) and so had to be
 * right about a list that grows: `GIT_ASKPASS` alone is exported by both VS Code and the `gh` CLI.
 * Dropping the whole `GIT_*` namespace ends that game and is what we actually want — Engram sets
 * its own author, needs no editor, and must never inherit `GIT_DIR`, `GIT_WORK_TREE` or
 * `GIT_INDEX_FILE`, any of which would silently point the commit at the wrong repository.
 * `SSH_ASKPASS` is the one non-`GIT_` member of the same family.
 *
 * GIT_TERMINAL_PROMPT=0 stops a missing credential from hanging the push forever.
 */
function gitEnv(name: string, email: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith("GIT_") || k === "SSH_ASKPASS") continue;
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
 * A git client for the vault with the sanitised environment already applied — to EVERY command,
 * not just the commit. Pull and push spawn child processes through the same guard, so an
 * inherited `GIT_ASKPASS` broke them exactly as it broke commits.
 */
function vaultGit(dir: string) {
  const { name, email } = gitAuthor();
  return simpleGit(dir).env(gitEnv(name, email));
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

export interface SyncOutcome {
  committed: boolean;
  pulled: boolean;
  pushed: boolean;
  /** The rebase conflicted and was aborted: the local commit is safe, the vault is behind. */
  conflicted?: boolean;
  error?: string;
}

/** The last thing that went wrong in a sync, surfaced by syncStatus() instead of only console. */
let lastSyncError: string | undefined;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Undo a rebase that stopped on a conflict, restoring the pre-pull state.
 *
 * A `git pull --rebase` that hits a conflict leaves the repo mid-rebase: HEAD detached, the
 * conflicted note carrying `<<<<<<<` markers in the working tree. Nothing here used to notice —
 * the error was logged and the next sync tick ran `git add -A` and committed, writing conflict
 * markers into the note and pushing them to the vault. Aborting puts our own commit back on the
 * branch with the note intact; we stay behind the remote until a human merges the two edits, and
 * `syncStatus().lastError` says so. Diverging visibly beats corrupting quietly.
 *
 * This is the failure mode the vault's own warning describes: "a second git writer causes merge
 * conflicts and lost edits (it already discarded a staging-URL update on 2026-07-14)".
 */
async function abortRebaseIfAny(dir: string, g: ReturnType<typeof vaultGit>): Promise<boolean> {
  const inRebase =
    fs.existsSync(path.join(dir, ".git", "rebase-merge")) || fs.existsSync(path.join(dir, ".git", "rebase-apply"));
  if (!inRebase) return false;
  try {
    await g.rebase(["--abort"]);
    console.error("[git] rebase conflicted — aborted; the vault is behind the remote until this is merged by hand");
    return true;
  } catch (e) {
    console.error("[git] rebase abort failed", e);
    return false;
  }
}

/**
 * Commit everything dirty in the vault, then rebase onto the remote and push. Runs under the git
 * lock. Always returns an outcome — never `undefined` — so the caller can tell "ran" from "skipped".
 */
async function syncOnce(reasons: string[]): Promise<SyncOutcome> {
  const out: SyncOutcome = { committed: false, pulled: false, pushed: false };
  try {
    const dir = gitVaultDir(); // may have changed since the debounce fired
    if (!dir) return out;
    const g = vaultGit(dir);
    await g.add(["-A"]);
    const status = await g.status();
    if (status.files.length === 0) return out;
    await g.commit(`brain: ${reasons.length} change(s) — ${reasons.slice(0, 3).join("; ")}`);
    out.committed = true;

    // Commit FIRST, then rebase — so the working tree is clean and the rebase has nothing to
    // stash. Deliberately no `--autostash`: see the note on pullActive. If a write landed in the
    // gap, `git pull --rebase` refuses on a dirty tree, which loses nothing; the next tick retries.
    const before = await g.revparse(["HEAD"]).catch(() => "");
    try {
      await g.pull(["--rebase"]);
      out.pulled = true;
      const after = await g.revparse(["HEAD"]).catch(() => "");
      // A rebase that replayed our commit over remote work rewrote the tree; the index must
      // follow. Previously only pullActive rebuilt, so commits arriving down THIS path left
      // search answering from pre-pull content until the watcher happened to catch up.
      if (before !== after) rebuildIndex();
    } catch (e) {
      const aborted = await abortRebaseIfAny(dir, g);
      out.error = aborted
        ? `vault diverged from its remote and the rebase conflicted; the local commit is intact but unpushed. Merge by hand. (${errText(e)})`
        : errText(e);
      out.conflicted = aborted;
      console.error("[git] pull failed", e);
    }
    // Pushing a detached HEAD or a half-finished rebase cannot help, and its failure would
    // overwrite the conflict message with a less useful one.
    if (!out.conflicted) {
      try {
        await g.push();
        out.pushed = true;
      } catch (e) {
        out.error = errText(e);
        console.error("[git] push failed", e);
      }
    }
  } catch (e) {
    out.error = errText(e);
    console.error("[git] sync failed", e);
  }
  return out;
}

async function runSync(): Promise<void> {
  const reasons = pending;
  pending = [];
  const outcome = await withGitLock(() => syncOnce(reasons));
  if (outcome === SKIPPED) {
    // The lock was held by a pull. The changed files are still dirty on disk, so don't drop them:
    // re-queue the reasons and retry once the repo is free.
    pending.unshift(...reasons);
    if (timer) clearTimeout(timer);
    timer = setTimeout(runSync, 2500);
    return;
  }
  lastSyncError = outcome.error;
}

/** Run the debounced sync immediately. Returns SKIPPED-as-null when a pull holds the repo. */
export async function syncNow(reason = "manual sync"): Promise<SyncOutcome | null> {
  if (!gitSyncEnabled() || !gitVaultDir()) return null;
  const reasons = pending.length > 0 ? pending : [reason];
  pending = [];
  if (timer) clearTimeout(timer);
  timer = null;
  const outcome = await withGitLock(() => syncOnce(reasons));
  if (outcome === SKIPPED) {
    pending.unshift(...reasons);
    return null;
  }
  lastSyncError = outcome.error;
  return outcome;
}

/** Test seam: the reasons still waiting to be committed. */
export function pendingReasons(): string[] {
  return [...pending];
}

export async function syncStatus() {
  const dir = gitVaultDir();
  if (!dir || !gitSyncEnabled()) return { enabled: false as const };
  try {
    const g = vaultGit(dir);
    const s = await g.status();
    // Stash entries are reported because nothing in Engram creates one any more. Any that exist
    // are vault content the old `--autostash` pull stranded — recoverable with `git stash list`
    // / `git stash pop`, but invisible until someone is told it is there.
    const stashed = await g
      .stashList()
      .then((l) => l.total)
      .catch(() => 0);
    return {
      enabled: true as const,
      dirty: s.files.length,
      ahead: s.ahead,
      behind: s.behind,
      branch: s.current,
      pending: pending.length,
      ...(stashed > 0 ? { stashed } : {}),
      ...(lastSyncError ? { lastError: lastSyncError } : {}),
    };
  } catch {
    return { enabled: true as const, error: true };
  }
}

export interface PullResult {
  ok: boolean;
  changed: boolean;
  /** True when the pull was postponed because the vault had uncommitted writes. Not an error. */
  deferred?: boolean;
  error?: string;
}

/**
 * Pull remote commits into the ACTIVE vault clone (rebase). This is how changes pushed to the repo
 * from OUTSIDE Engram (an agent, a teammate, a direct git push) show up — the index is rebuilt when
 * HEAD moves. Independent of the push side; a fresh connected workspace should always reflect its
 * remote. No-op for the sample/local vault.
 *
 * Postpones itself rather than rebasing over uncommitted vault writes — see below.
 */
export async function pullActive(): Promise<PullResult> {
  const active = getActive();
  if (!active) return { ok: true, changed: false };
  const result = await withGitLock(async (): Promise<PullResult> => {
    const dir = activeVaultDir();
    try {
      const g = vaultGit(dir);

      // Never rebase over uncommitted vault writes.
      //
      // This used to pull with `--autostash`, which stashes the dirty working tree for the
      // duration of the rebase and restores it after. Two ways that loses a note, both silent:
      // while the stash is held the note on disk is back at HEAD, so a `brain_append` landing in
      // that window does its read-modify-write against stale content; and if the restore then
      // fails (upstream touched the same file, or the tree moved under it), git prints "Applying
      // autostash resulted in conflicts. Your changes are safe in the stash." and STILL EXITS 0 —
      // the note is reverted, the writes live only in a stash nobody reads, and every caller was
      // already told `ok: true`. Committing first (below) is strictly better than stashing: the
      // content is in history either way, and a commit is a place people look.
      const dirty = (await g.status()).files.length > 0;
      if (dirty) {
        if (gitSyncEnabled()) {
          // The write-sync commits, then pulls, then pushes. Let it own this cycle.
          requestSync("pull deferred — uncommitted vault writes");
          return { ok: true, changed: false, deferred: true };
        }
        return {
          ok: false,
          changed: false,
          error: "vault has uncommitted changes and git-sync is off — refusing to pull over them",
        };
      }

      const before = await g.revparse(["HEAD"]).catch(() => "");
      await g.pull(["--rebase"]); // pull already fetches — a separate g.fetch() only doubles the child processes
      const after = await g.revparse(["HEAD"]).catch(() => "");
      const changed = before !== after;
      if (changed) rebuildIndex();
      return { ok: true, changed };
    } catch (e) {
      // Same reason as in syncOnce: a conflicted rebase left in place means the next `git add -A`
      // commits conflict markers into a note.
      const aborted = await abortRebaseIfAny(dir, vaultGit(dir));
      console.error("[git] pull failed", e);
      return {
        ok: false,
        changed: false,
        error: aborted ? `vault diverged from its remote; rebase aborted. Merge by hand. (${errText(e)})` : errText(e),
      };
    }
  });
  // SKIPPED = a sync was already in flight; a skipped tick is not an error.
  return result === SKIPPED ? { ok: true, changed: false } : result;
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
