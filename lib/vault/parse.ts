import matter from "gray-matter";
import type { RawLink, NoteMeta } from "./types";

const WIKILINK = /\[\[([^\]]+)\]\]/g;

export function humanize(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function normalizeTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

/** First path segment = category; "root" for a top-level file. */
export function folderOf(relPath: string): string {
  const seg = relPath.split("/");
  return seg.length > 1 ? seg[0] : "root";
}

/** Resolve a wikilink target to a bare filename stem (path portion is a hint only). */
export function stemOf(target: string): string {
  const noAlias = target.split("|")[0].trim();
  const base = noAlias.split("/").pop() || noAlias;
  return base.replace(/\.md$/i, "").trim();
}

function parseRawLink(raw: string, source: RawLink["source"]): RawLink {
  const [targetPart, alias] = raw.split("|");
  return { target: targetPart.trim(), alias: alias?.trim(), source };
}

export function extractRawLinks(body: string, frontmatter: Record<string, unknown>): RawLink[] {
  const links: RawLink[] = [];
  WIKILINK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK.exec(body))) links.push(parseRawLink(m[1], "body"));

  const related = frontmatter.related;
  const relArr = Array.isArray(related) ? related : related != null ? [related] : [];
  for (const r of relArr) {
    if (typeof r !== "string") continue;
    const inner = r.replace(/^\s*\[\[/, "").replace(/\]\]\s*$/, "");
    links.push(parseRawLink(inner, "related"));
  }
  return links;
}

/** Every markdown heading in a body, in document order, without the leading #s. */
export function listHeadings(body: string): string[] {
  return body
    .split("\n")
    .filter((l) => /^#{1,6}\s+\S/.test(l))
    .map((l) => l.replace(/^#{1,6}\s+/, "").trim());
}

/**
 * Return one section of a note: the matching heading plus everything under it, stopping at
 * the next heading of the same or higher level. Lets an agent read 40 lines of a 1000-line
 * document instead of all of it. Matches case-insensitively, by prefix.
 */
export function extractSection(body: string, heading: string): string | null {
  const lines = body.split("\n");
  const want = heading.replace(/^#+\s*/, "").trim().toLowerCase();
  if (!want) return null;

  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (!m) continue;
    const text = m[2].trim().toLowerCase();
    if (text === want || text.startsWith(want)) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  if (start === -1) return null;

  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s+/.exec(lines[i]);
    if (m && m[1].length <= level) break;
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

export interface ParsedNote {
  meta: Omit<NoteMeta, "mtimeMs">;
  body: string;
  rawLinks: RawLink[];
}

/**
 * Parse a `valid_until` frontmatter value to an epoch-ms deadline, inclusive through the end of
 * that day. gray-matter/js-yaml turns a bare `valid_until: 2026-06-01` into a JS `Date`; a quoted
 * or odd value stays a string. A date-only value (midnight UTC) expires at 23:59:59.999 of that
 * day, not 00:00, so a note doesn't go stale mid-business-day. Returns undefined when unparseable.
 */
export function parseValidUntil(v: unknown): number | undefined {
  if (v == null) return undefined;
  let d: Date;
  if (v instanceof Date) {
    d = v;
  } else {
    const ms = Date.parse(String(v).trim());
    if (Number.isNaN(ms)) return undefined;
    d = new Date(ms);
  }
  const t = d.getTime();
  if (Number.isNaN(t)) return undefined;
  const midnightUTC =
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  return midnightUTC ? t + 24 * 60 * 60 * 1000 - 1 : t;
}

/** Normalize a `superseded_by` value (may be `[[wikilink]]`, alias, or path) to a bare stem. */
function supersededStem(v: unknown): string | undefined {
  if (v == null) return undefined;
  const inner = String(v).replace(/^\s*\[\[/, "").replace(/\]\]\s*$/, "");
  const stem = stemOf(inner);
  return stem || undefined;
}

export function parseNote(relPath: string, raw: string): ParsedNote {
  let data: Record<string, unknown> = {};
  let body = raw;
  let frontmatterError: string | undefined;
  try {
    const g = matter(raw);
    data = (g.data ?? {}) as Record<string, unknown>;
    body = g.content;
  } catch (e) {
    // Tolerate malformed frontmatter — treat the whole file as body — but never silently.
    // A YAML typo (e.g. an unquoted second colon in a title) would otherwise discard the
    // note's status and tags, so an authoritative note quietly ranks as an ordinary one.
    frontmatterError = (e as Error).message.split("\n")[0];
    if (raw.trimStart().startsWith("---")) {
      console.warn(`[vault] ${relPath}: unreadable frontmatter — ${frontmatterError}`);
    } else {
      frontmatterError = undefined;
    }
  }

  const slug = (relPath.split("/").pop() || relPath).replace(/\.md$/i, "");
  const tags = normalizeTags(data.tags);
  const titleFm = typeof data.title === "string" ? data.title.trim() : "";

  const meta: Omit<NoteMeta, "mtimeMs"> = {
    path: relPath,
    slug,
    title: titleFm || humanize(slug),
    folder: folderOf(relPath),
    type: typeof data.type === "string" ? data.type : tags[0],
    tags,
    aliases: normalizeTags(data.aliases),
    status: data.status != null ? String(data.status) : undefined,
    created: data.created != null ? String(data.created) : undefined,
    updated:
      data.updated != null ? String(data.updated) : data.date != null ? String(data.date) : undefined,
    validUntil: parseValidUntil(data.valid_until),
    supersededBy: supersededStem(data.superseded_by),
    frontmatter: data,
    frontmatterError,
  };

  return { meta, body, rawLinks: extractRawLinks(body, data) };
}
