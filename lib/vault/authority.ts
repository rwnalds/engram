import { ARCHIVE_FOLDERS } from "@/lib/config";

/**
 * Authority — how much a note should be trusted, independent of how well it matches a query.
 *
 * Search engines rank by *resemblance*. They cannot tell a live contract from a dead one:
 * a superseded price list mentions "price" just as often as the real one, so it can easily
 * outrank it. Authority is the missing axis. It is derived entirely from the files
 * (path + frontmatter), never stored separately, so the index stays disposable.
 */
export type Authority = "authoritative" | "current" | "provisional" | "superseded" | "archived";

/** Status/tag words that mark a note as the source of truth for whatever it covers. */
const AUTHORITATIVE = ["locked", "canonical", "source-of-truth", "authoritative"];
/** Words that mark a note as no longer true. */
const SUPERSEDED = ["superseded", "deprecated", "obsolete", "replaced", "retired", "dead"];
/** Words that mark a note as not yet decided. A `proposed` decision is not a decision. */
const PROVISIONAL = ["draft", "proposed", "exploring", "tentative", "wip", "idea"];

/** Multiplier applied to a note's search score. Files are truth; this only reorders hits. */
const WEIGHT: Record<Authority, number> = {
  authoritative: 3.5,
  current: 1,
  provisional: 0.55,
  superseded: 0.15,
  archived: 0.08,
};

/** One-line explanation per class, surfaced to agents via brain_schema. */
export const AUTHORITY_MEANING: Record<Authority, string> = {
  authoritative: "Source of truth for its subject. Quote this over anything that disagrees.",
  current: "Live, but not declared authoritative. Fine for context.",
  provisional: "Not decided yet (draft/proposed). Never quote as settled.",
  superseded: "Explicitly replaced. Historical only.",
  archived: "Lives in an archive folder. Historical only — never quote as current.",
};

/** Match `needle` as a whole token inside `hay` (so "draft" hits "draft-for-approval"). */
function hasWord(hay: string, needle: string): boolean {
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i").test(hay);
}

/** True when the note's top-level folder is an archive folder. */
export function isArchivedPath(relPath: string): boolean {
  return ARCHIVE_FOLDERS.has(relPath.split("/")[0].toLowerCase());
}

/**
 * Classify a note. Order matters: a locked note inside `archive/` is still archived,
 * and an explicitly superseded note is dead however loudly it calls itself canonical.
 */
export function authorityOf(meta: { path: string; status?: string; tags?: string[] }): Authority {
  if (isArchivedPath(meta.path)) return "archived";
  const hay = [meta.status ?? "", ...(meta.tags ?? [])].join(" ").toLowerCase();
  if (SUPERSEDED.some((w) => hasWord(hay, w))) return "superseded";
  if (PROVISIONAL.some((w) => hasWord(hay, w))) return "provisional";
  if (AUTHORITATIVE.some((w) => hasWord(hay, w))) return "authoritative";
  return "current";
}

export function weightOf(a: Authority): number {
  return WEIGHT[a];
}

/** Base authority overlaid with temporal validity, plus a human-readable reason when retired. */
export interface EffectiveAuthority {
  authority: Authority;
  /** Why the note is retired, e.g. "superseded by price-live" or "expired 2026-06-01". */
  reason?: string;
  /** True when the note must not be treated as current fact (superseded, expired, or archived). */
  retired: boolean;
}

/**
 * Overlay temporal validity onto an already-known base authority.
 *
 * `authorityOf` is text-only and timeless, so a `locked` note stays authoritative forever. This
 * demotes a note that was explicitly superseded (`superseded_by`) or has passed its `valid_until`
 * to `superseded`, regardless of how authoritative its text claims to be — and returns a reason.
 * Precedence: archived → superseded (explicit) → expired.
 *
 * Kept separate from `effectiveAuthority` so the search path, which only has the pre-computed base
 * authority in the index (not status/tags), can overlay without re-classifying.
 */
export function overlayValidity(
  base: Authority,
  validUntil: number | null | undefined,
  supersededBy: string | null | undefined,
  now: number = Date.now(),
): EffectiveAuthority {
  if (base === "archived") return { authority: "archived", reason: "archived", retired: true };
  if (supersededBy) return { authority: "superseded", reason: `superseded by ${supersededBy}`, retired: true };
  if (base === "superseded") return { authority: "superseded", reason: "marked superseded", retired: true };
  if (validUntil != null && validUntil < now) {
    const on = new Date(validUntil).toISOString().slice(0, 10);
    return { authority: "superseded", reason: `expired ${on} (no replacement)`, retired: true };
  }
  return { authority: base, retired: false };
}

/** The effective authority of a note: its text-based class, overlaid with validity. For live reads. */
export function effectiveAuthority(
  meta: { path: string; status?: string; tags?: string[]; validUntil?: number; supersededBy?: string },
  now: number = Date.now(),
): EffectiveAuthority {
  return overlayValidity(authorityOf(meta), meta.validUntil, meta.supersededBy, now);
}

/**
 * The live ranking contract, returned by brain_schema so an agent working against a vault
 * it has never seen can discover the rules instead of guessing them.
 */
export function authorityRules() {
  return {
    summary:
      "Search ranks by keyword relevance, then multiplies by authority. Authority comes from the note's folder and frontmatter — never from the text.",
    archiveFolders: [...ARCHIVE_FOLDERS],
    statusWords: { authoritative: AUTHORITATIVE, superseded: SUPERSEDED, provisional: PROVISIONAL },
    weights: WEIGHT,
    meaning: AUTHORITY_MEANING,
    note: "Words are matched in both `status:` and `tags:`. A note with no status is `current` (weight 1) — vaults that use no conventions rank purely by relevance, exactly as before.",
  };
}
