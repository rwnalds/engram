import { currentActor } from "@/lib/actor";

/**
 * What each caller has read recently, so the write path can enforce read-before-overwrite.
 *
 * The Curator loop gets this for free — it's one process with one `readPaths` set per run. MCP has
 * no session: every `tools/call` is an independent HTTP POST, so "have you read this note?" has
 * nowhere to live. This is that missing session, keyed by the authenticated caller's name and aged
 * out on a sliding window. It is a safety interlock, not state the protocol depends on — losing it
 * costs one extra brain_read, which is exactly the behaviour we want anyway.
 *
 * Deliberately in-memory: a restart forgetting that an agent read a note is the safe direction to
 * fail, and it keeps a single-binary deploy free of another store.
 */

/** How long a read counts for. Long enough for a multi-step task, short enough that a stale read doesn't authorise a clobber an hour later. */
const TTL_MS = 30 * 60 * 1000;
/** Cap per actor, so a long-lived token that reads thousands of notes can't grow without bound. */
const MAX_PATHS = 500;

const reads = new Map<string, Map<string, number>>();

function bucket(actor: string): Map<string, number> {
  let b = reads.get(actor);
  if (!b) {
    b = new Map();
    reads.set(actor, b);
  }
  return b;
}

/** Drop expired entries, then the oldest ones if the bucket is still over cap. */
function prune(b: Map<string, number>, now: number): void {
  for (const [p, at] of b) if (now - at > TTL_MS) b.delete(p);
  if (b.size <= MAX_PATHS) return;
  const oldestFirst = [...b].sort((x, y) => x[1] - y[1]);
  for (let i = 0; i < oldestFirst.length - MAX_PATHS; i++) b.delete(oldestFirst[i][0]);
}

export function recordRead(relPath: string, now: number = Date.now()): void {
  if (!relPath) return;
  const b = bucket(currentActor());
  b.set(relPath, now);
  prune(b, now);
}

export function hasRead(relPath: string, now: number = Date.now()): boolean {
  const b = reads.get(currentActor());
  if (!b) return false;
  const at = b.get(relPath);
  return at != null && now - at <= TTL_MS;
}

/** Test seam. */
export function resetSessions(): void {
  reads.clear();
}
