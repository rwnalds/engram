/**
 * The single gate every git child process in this app passes through.
 *
 * WHY THE STATE LIVES ON `globalThis` AND NOT IN MODULE SCOPE
 * ----------------------------------------------------------
 * `lib/git.ts` is compiled into the server build several times over — the instrumentation entry
 * (which owns the pull loop) gets its own copies, and the API routes get theirs, split across more
 * than one chunk. Each copy got its own `let gitBusy`, its own `pending` array and its own debounce
 * timer, so the "serialize git-sync" guard only ever serialized a caller against itself. Count the
 * copies on any build:
 *
 *     grep -rl 'engram.git.queue' .next/server/chunks    # one file per copy of this module
 *
 * In production that means the 30s pull loop, an MCP note write and a folder write can each run
 * `git pull --rebase` on the same clone at the same moment. Two consequences, both in the crash log:
 *
 *   - Two fetches interleave their writes to `.git/FETCH_HEAD`, which ends up holding more than one
 *     merge candidate, and git dies with "Cannot rebase onto multiple branches." Three concurrent
 *     `git pull --rebase` in one clone reproduce it 40 times out of 40; serialized, 0 out of 40.
 *     Naming the remote and branch explicitly does NOT help — only one-at-a-time does.
 *   - The git children pile up — every pull forks git, then git-remote-https, which starts threads
 *     to resolve DNS — until the container is out of its process/thread budget. Then git reports
 *     "cannot fork() for remote-https: Resource temporarily unavailable" and "getaddrinfo() thread
 *     failed to start", libuv cannot start a thread either, and the runtime aborts: SIGABRT,
 *     restart, repeat. A *background sync* takes the whole service down.
 *
 * Keying off `globalThis` with `Symbol.for` makes the three copies share one queue, which is what
 * the original fix intended. Every git invocation in the app — writes, pulls AND the read-only
 * status/log/show commands the dashboard polls — goes through here, so "one git child at a time"
 * is finally true rather than merely documented.
 */

/**
 * Returned by `tryRunGit` when the queue was busy and the callback never ran.
 *
 * A Symbol, not `undefined`: the original guard returned `undefined` for "skipped", but a callback
 * typed `Promise<void>` also resolves to `undefined`, so "we skipped" and "we ran and finished"
 * were the same value. `runSync` therefore treated EVERY successful sync as a skip — it re-queued
 * its reasons and rescheduled itself, forever. The vault's git history shows it plainly: on
 * 2026-08-06 the commit subjects grew `1 change(s)` → `2` → `3` → `4` → `5`, each repeating every
 * earlier reason, because `pending` never drained. A sentinel that cannot be produced by `fn`
 * makes the two cases impossible to confuse.
 *
 * `Symbol.for`, not `Symbol`: with three copies of the calling module in one process, a fresh
 * per-copy symbol would make `outcome === SKIPPED` false across a bundle boundary and resurrect
 * exactly that bug. The global registry gives all three the same sentinel.
 */
export const SKIPPED = Symbol.for("engram.git.skipped");

/** Thrown by `runGit` instead of spawning git while the breaker is open. */
export class GitUnavailableError extends Error {
  constructor(retryInMs: number) {
    super(`git is paused for ${Math.ceil(retryInMs / 1000)}s — the container ran out of processes for it`);
    this.name = "GitUnavailableError";
  }
}

/** Consecutive fork/thread failures before we stop spawning git at all. */
const TRIP_AFTER = 3;
/** How long the breaker stays open. Long enough for whatever ate the process budget to let go. */
const COOLDOWN_MS = 5 * 60_000;

/**
 * The failures that mean "this container cannot start another process or thread right now" —
 * as opposed to "the network is down" or "the rebase conflicted". Retrying these immediately is
 * what turns a resource blip into the crash loop, because each retry costs the fork we don't have.
 */
const EXHAUSTED =
  /resource temporarily unavailable|thread failed to start|cannot fork|cannot allocate memory|\bEAGAIN\b|\bENOMEM\b/i;

interface ReadSlot {
  /** When `value` was produced (epoch ms). */
  at: number;
  value: unknown;
  /** A read already on its way, so N concurrent callers share one git process instead of N. */
  inFlight: Promise<unknown> | null;
}

interface QueueState {
  /** Tail of the serial chain: a task awaits this before it may spawn git. Never rejects. */
  tail: Promise<unknown>;
  /**
   * Enqueued-and-unsettled tasks that WRITE — a sync or a pull. Only these make `tryRunGit` skip.
   *
   * Counted separately from the reads deliberately. Everything queues, so no two git children ever
   * overlap either way; but a 20ms `git status` for the sidebar must not be the reason a human's
   * "sync now" click reports "nothing to do". Skipping is for the case that matters — a second
   * writer piling onto the first — and waiting is fine for the rest.
   */
  writes: number;
  /** Consecutive resource failures. Only a git command that SUCCEEDS resets it. */
  exhaustions: number;
  /** Epoch ms until which we refuse to spawn git. 0 when the breaker is closed. */
  openUntil: number;
  reads: Map<string, ReadSlot>;
}

const STATE_KEY = Symbol.for("engram.git.queue");
type GlobalWithQueue = typeof globalThis & { [STATE_KEY]?: QueueState };

function state(): QueueState {
  const g = globalThis as GlobalWithQueue;
  return (g[STATE_KEY] ??= {
    tail: Promise.resolve(),
    writes: 0,
    exhaustions: 0,
    openUntil: 0,
    reads: new Map(),
  });
}

const NOOP = () => {};

function breakerOpen(s: QueueState): boolean {
  if (s.openUntil === 0) return false;
  if (s.openUntil > Date.now()) return true;
  s.openUntil = 0; // cooldown elapsed — let the next command try
  return false;
}

function trip(s: QueueState): void {
  s.exhaustions++;
  if (s.exhaustions < TRIP_AFTER || s.openUntil > Date.now()) return;
  s.openUntil = Date.now() + COOLDOWN_MS;
  console.error(
    `[git] out of processes/threads for git ${s.exhaustions} times in a row — pausing all vault git for ` +
      `${COOLDOWN_MS / 1000}s. The vault still serves from disk; it just stops syncing.`,
  );
}

/** Run `fn`, minding the breaker and recording what its outcome says about the host. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  const s = state();
  // Checked here rather than at enqueue time so a task that queued before the breaker opened
  // still doesn't get to spawn git after it.
  if (breakerOpen(s)) throw new GitUnavailableError(s.openUntil - Date.now());
  try {
    const out = await fn();
    s.exhaustions = 0;
    s.openUntil = 0;
    return out;
  } catch (e) {
    if (EXHAUSTED.test(e instanceof Error ? e.message : String(e))) trip(s);
    throw e;
  }
}

function enqueue<T>(fn: () => Promise<T>, isWrite: boolean): Promise<T> {
  const s = state();
  // Synchronously, before any await: two tryRunGit calls in one tick must not both see zero.
  if (isWrite) s.writes++;
  const result = s.tail.then(() => guarded(fn)).finally(() => {
    if (isWrite) s.writes--;
  });
  // The chain must survive a failing task: everything queued behind a rejection still has to run.
  s.tail = result.then(NOOP, NOOP);
  return result;
}

/**
 * Wait for the git queue, then run `fn`. Use for work that must happen — reads, clones.
 * Rejects with `GitUnavailableError` (without spawning anything) while the breaker is open.
 */
export function runGit<T>(fn: () => Promise<T>): Promise<T> {
  return enqueue(fn, false);
}

/**
 * Run `fn` unless another writer is already in flight, in which case return `SKIPPED` without
 * running it. Use for the vault-mutating work — a pull or a debounced sync — where a skipped tick
 * costs nothing because the next one is already scheduled, and where queueing a second writer
 * would just stack git processes on top of the first under load.
 */
export function tryRunGit<T>(fn: () => Promise<T>): Promise<T | typeof SKIPPED> {
  const s = state();
  if (s.writes > 0 || breakerOpen(s)) return Promise.resolve(SKIPPED);
  return enqueue(fn, true);
}

/**
 * Serve a read-only git command from a short-lived cache, and collapse concurrent callers onto one
 * git process. The dashboard polls `/api/sync` every 10s and `/api/activity` every 15s from the
 * sidebar — per open tab — and every one of those was two-plus unserialized git children before.
 */
export function gitRead<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const reads = state().reads;
  const slot = reads.get(key);
  if (slot) {
    if (Date.now() - slot.at < ttlMs) return Promise.resolve(slot.value as T);
    if (slot.inFlight) return slot.inFlight as Promise<T>;
  }
  const fresh: ReadSlot = slot ?? { at: 0, value: undefined, inFlight: null };
  fresh.inFlight = runGit(fn).then(
    (v) => {
      fresh.at = Date.now();
      fresh.value = v;
      fresh.inFlight = null;
      return v;
    },
    (e) => {
      fresh.inFlight = null;
      throw e;
    },
  );
  reads.set(key, fresh);
  return fresh.inFlight as Promise<T>;
}

/** Drop the read cache. Called after we ourselves commit, pull or push — the answers just changed. */
export function invalidateGitReads(): void {
  state().reads.clear();
}

/** Milliseconds until git is allowed again, or 0 when it is allowed now. For reporting. */
export function gitPausedFor(): number {
  const s = state();
  return breakerOpen(s) ? s.openUntil - Date.now() : 0;
}
