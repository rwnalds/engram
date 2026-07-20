import { listNotes } from "./store";
import { overlayValidity, authorityOf } from "./authority";
import { stemOf } from "./parse";
import type { NoteMeta } from "./types";

/**
 * Refuse to create a second note asserting a fact an existing live note already asserts.
 *
 * The failure this exists for: an agent is told "our price is now X". It cannot overwrite a note
 * it never read, so it does the agreeable thing and *adds* one — `clients/acme-pricing-2026.md`
 * next to `clients/acme-pricing.md`. Nothing is corrupted, no guard trips, and the vault now holds
 * two live notes disagreeing about one number. Authority ranking cannot save this: both are
 * `current`, both match "price", and the older one is often the wordier and better-matching of the
 * two. The contradiction has to be refused at write time, because by read time both look equally true.
 *
 * The rule is deliberately narrow, because a guard that cries wolf gets `allow_conflict: true`
 * pasted into every call and stops meaning anything. It fires only on **near-duplicate names**:
 * two stems that are identical once dates and recency words are stripped. `acme-pricing-2026`
 * collides with `acme-pricing`; `acme-pricing-uk` does not collide with `acme-pricing`, because a
 * region-specific note is a real distinction and not this bug.
 */

/** Tokens that say "when" or "which version", never "about what". Stripped before comparing. */
const NOISE = new Set([
  // recency / versioning
  "new", "old", "latest", "current", "final", "updated", "revised", "copy", "duplicate",
  "v1", "v2", "v3", "v4", "rev", "revision",
  // months, long and short
  "january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  // quarters
  "q1", "q2", "q3", "q4",
]);

/** A 4-digit year, or any pure number (day, ISO fragment, `2026`, `07`, `09`). */
function isDateish(tok: string): boolean {
  return /^\d+$/.test(tok);
}

/**
 * Reduce a stem to the tokens that describe *what it is about*.
 * "acme-pricing-2026-07" and "acme-pricing-new" both reduce to {acme, pricing}.
 */
export function subjectTokens(stem: string): Set<string> {
  return new Set(
    stem
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0 && !isDateish(t) && !NOISE.has(t)),
  );
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size || a.size === 0) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

export interface ConflictCandidate {
  path: string;
  title: string;
  authority: string;
}

/**
 * Live notes whose subject tokens are identical to `relPath`'s.
 *
 * Retired notes are not conflicts — a superseded or expired note is exactly what a replacement is
 * *supposed* to sit next to, and flagging it would refuse the correct workflow. Only `current` and
 * `authoritative` notes can be contradicted.
 */
export function findConflicts(relPath: string, now: number = Date.now()): ConflictCandidate[] {
  const mine = subjectTokens(stemOf(relPath));
  if (mine.size === 0) return [];

  const out: ConflictCandidate[] = [];
  for (const n of listNotes() as NoteMeta[]) {
    if (n.path === relPath) continue;
    if (!sameSet(mine, subjectTokens(n.slug))) continue;
    const eff = overlayValidity(
      authorityOf({ path: n.path, status: n.status, tags: n.tags }),
      n.validUntil,
      n.supersededBy,
      now,
    );
    if (eff.retired) continue;
    out.push({ path: n.path, title: n.title, authority: eff.authority });
  }
  return out;
}

/**
 * Throw if creating `relPath` would contradict a live note. Callers pass `allowConflict` to
 * override — the escape hatch is deliberate and named in the message, mirroring `overwrite`.
 */
export function guardConflict(relPath: string, isNewNote: boolean, allowConflict: boolean): void {
  if (allowConflict || !isNewNote) return;
  const clashes = findConflicts(relPath);
  if (clashes.length === 0) return;

  const list = clashes.map((c) => `${c.path} (${c.authority})`).join(", ");
  const first = clashes[0].path;
  throw new Error(
    `Refusing to create ${relPath}: ${list} already covers this and is still live. ` +
      `Two live notes on one subject is how a retired value keeps getting quoted — both match the query, ` +
      `and the older one often matches it better. ` +
      `If this replaces it, use brain_supersede(from: "${first}", to: "${relPath}") — that retires the old note ` +
      `and adds this one in a single commit, so they cannot drift apart. ` +
      `If it genuinely belongs alongside it, pass allow_conflict: true.`,
  );
}
