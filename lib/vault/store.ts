import fs from "node:fs";
import path from "node:path";
import MiniSearch from "minisearch";
import { watch, type FSWatcher } from "chokidar";
import { VAULT_IGNORE } from "@/lib/config";
import { activeVaultDir } from "@/lib/repos";
import { scanVault } from "./scan";
import { parseNote, stemOf } from "./parse";
import { authorityOf, authorityRules, isArchivedPath, isUnrecognizedStatus, overlayValidity, weightOf, type Authority } from "./authority";
import type { Graph, GraphEdge, GraphNode, Note, NoteMeta, TreeNode } from "./types";

interface IndexDoc {
  id: string;
  title: string;
  aliases: string;
  tags: string;
  body: string;
  folder: string;
  type: string;
  /** stored, not indexed — used for filtering + authority-weighted ranking */
  status: string;
  authority: Authority;
  /** epoch ms deadline (or null). Read at query time so expiry is live without re-indexing. */
  validUntil: number | null;
  /** stem of the superseding note (or null). Marks this doc retired at query time. */
  supersededBy: string | null;
  mtimeMs: number;
}

interface IndexState {
  dir: string;
  notes: Map<string, NoteMeta>;
  /** path -> wikilink target stems. Kept so link/graph rebuilds need no disk IO. */
  linksBySource: Map<string, string[]>;
  stemToPath: Map<string, string>;
  /** stems claimed by more than one file — wikilinks to these resolve to the first, silently. */
  duplicateStems: Map<string, string[]>;
  outEdges: Map<string, Set<string>>;
  inEdges: Map<string, Set<string>>;
  search: MiniSearch<IndexDoc>;
  builtAt: number;
}

let state: IndexState | null = null;
let watcher: FSWatcher | null = null;
let watchedDir = "";

function newIndex(): MiniSearch<IndexDoc> {
  return new MiniSearch<IndexDoc>({
    fields: ["title", "aliases", "tags", "body", "folder", "type"],
    storeFields: ["title", "folder", "type", "status", "authority", "validUntil", "supersededBy", "mtimeMs"],
    searchOptions: {
      boost: { title: 3, aliases: 3, tags: 2 },
      prefix: true,
      fuzzy: 0.2,
      // OR, deliberately. With AND, one query word the canonical note happens to lack
      // ("tiers") drops it from the results entirely — and the superseded note that *does*
      // use the word becomes the only answer. Authority weighting can only reorder what
      // survives the combiner, so the combiner must not throw the truth away.
      // Docs matching more terms still score higher; noise is handled by ranking, not exclusion.
      combineWith: "OR",
    },
  });
}

function toDoc(meta: NoteMeta, body: string): IndexDoc {
  return {
    id: meta.path,
    title: meta.title,
    aliases: meta.aliases.join(" "),
    tags: meta.tags.join(" "),
    body,
    folder: meta.folder,
    type: meta.type ?? "",
    status: meta.status ?? "",
    authority: authorityOf(meta),
    validUntil: meta.validUntil ?? null,
    supersededBy: meta.supersededBy ?? null,
    mtimeMs: meta.mtimeMs,
  };
}

function readAndParse(
  dir: string,
  rel: string,
  mtimeMs: number,
): { meta: NoteMeta; body: string; stems: string[] } | null {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(dir, rel), "utf8");
  } catch {
    return null;
  }
  const { meta, body, rawLinks } = parseNote(rel, raw);
  return { meta: { ...meta, mtimeMs }, body, stems: rawLinks.map((l) => stemOf(l.target)) };
}

/**
 * Rebuild stem resolution + the link graph from in-memory maps only.
 * Cheap (no disk IO), so it can run after every single-file change.
 */
function recomputeLinks(s: IndexState): void {
  s.stemToPath = new Map();
  s.duplicateStems = new Map();
  for (const rel of [...s.notes.keys()].sort()) {
    const slug = s.notes.get(rel)!.slug;
    const first = s.stemToPath.get(slug);
    if (first === undefined) {
      s.stemToPath.set(slug, rel);
    } else {
      const dupes = s.duplicateStems.get(slug) ?? [first];
      dupes.push(rel);
      s.duplicateStems.set(slug, dupes);
    }
  }
  // Only warn when something actually links to the ambiguous stem. Two notes sharing a
  // filename nothing references is harmless (every vault has a few READMEs), and warning
  // unconditionally reprints on every reindex — which buries the cases that DO silently
  // misresolve a link. The full set stays in s.duplicateStems for the integrity report.
  const linkedStems = new Set<string>();
  for (const stems of s.linksBySource.values()) {
    for (const stem of stems) linkedStems.add(stem);
  }
  for (const [slug, paths] of s.duplicateStems) {
    if (!linkedStems.has(slug)) continue;
    console.warn(`[vault] duplicate stem "${slug}" (${paths.join(", ")}) — wikilinks resolve to the first.`);
  }

  s.outEdges = new Map();
  s.inEdges = new Map();
  for (const [src, stems] of s.linksBySource) {
    for (const stem of stems) {
      const tgt = s.stemToPath.get(stem);
      if (!tgt || tgt === src) continue;
      (s.outEdges.get(src) ?? s.outEdges.set(src, new Set()).get(src)!).add(tgt);
      (s.inEdges.get(tgt) ?? s.inEdges.set(tgt, new Set()).get(tgt)!).add(src);
    }
  }
}

function buildState(): IndexState {
  const dir = activeVaultDir();
  const s: IndexState = {
    dir,
    notes: new Map(),
    linksBySource: new Map(),
    stemToPath: new Map(),
    duplicateStems: new Map(),
    outEdges: new Map(),
    inEdges: new Map(),
    search: newIndex(),
    builtAt: Date.now(),
  };

  const docs: IndexDoc[] = [];
  for (const f of scanVault(dir)) {
    const parsed = readAndParse(dir, f.rel, f.mtimeMs);
    if (!parsed) continue;
    s.notes.set(f.rel, parsed.meta);
    s.linksBySource.set(f.rel, parsed.stems);
    docs.push(toDoc(parsed.meta, parsed.body));
  }
  s.search.addAll(docs);
  recomputeLinks(s);
  return s;
}

/** Add or update one file in the live index. Returns false when the file is gone. */
function upsert(s: IndexState, rel: string): boolean {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(path.join(s.dir, rel)).mtimeMs;
  } catch {
    return false;
  }
  const parsed = readAndParse(s.dir, rel, mtimeMs);
  if (!parsed) return false;
  if (s.notes.has(rel)) {
    try {
      s.search.discard(rel);
    } catch {
      /* not in the index — fall through to add */
    }
  }
  s.notes.set(rel, parsed.meta);
  s.linksBySource.set(rel, parsed.stems);
  s.search.add(toDoc(parsed.meta, parsed.body));
  return true;
}

function remove(s: IndexState, rel: string): void {
  if (!s.notes.has(rel)) return;
  try {
    s.search.discard(rel);
  } catch {
    /* already gone */
  }
  s.notes.delete(rel);
  s.linksBySource.delete(rel);
}

function startWatcher(dir: string) {
  if (watcher && watchedDir === dir) return;
  if (watcher) {
    watcher.close().catch(() => {});
    watcher = null;
  }
  watchedDir = dir;
  try {
    watcher = watch(dir, {
      ignoreInitial: true,
      persistent: true,
      depth: 12,
      ignored: (p) => {
        const base = path.basename(p);
        if (base.startsWith(".")) return true;
        return [...VAULT_IGNORE].some((ig) => base === ig || p.includes(`${path.sep}${ig}${path.sep}`));
      },
    });

    const pending = new Set<string>();
    let t: ReturnType<typeof setTimeout> | null = null;
    let fullRebuild = false;

    const flush = () => {
      try {
        if (fullRebuild || !state || state.dir !== dir) {
          state = buildState();
        } else {
          for (const rel of pending) if (!upsert(state, rel)) remove(state, rel);
          recomputeLinks(state);
        }
      } catch (e) {
        console.error("[vault] index update failed", e);
      }
      pending.clear();
      fullRebuild = false;
    };

    const schedule = () => {
      if (t) clearTimeout(t);
      t = setTimeout(flush, 250);
    };
    const onFile = (abs: string) => {
      if (!abs.toLowerCase().endsWith(".md")) return;
      pending.add(path.relative(dir, abs).split(path.sep).join("/"));
      schedule();
    };
    const onDir = () => {
      fullRebuild = true;
      schedule();
    };

    watcher.on("add", onFile).on("change", onFile).on("unlink", onFile).on("addDir", onDir).on("unlinkDir", onDir);
  } catch (e) {
    console.error("[vault] watcher failed to start", e);
  }
}

function ensure(): IndexState {
  const dir = activeVaultDir();
  if (!state || state.dir !== dir) state = buildState();
  startWatcher(dir);
  return state;
}

/** Force a synchronous full rebuild (workspace switch, or after a git pull changed many files). */
export function rebuildIndex(): void {
  state = buildState();
  startWatcher(state.dir);
}

/** Update just these paths (created, edited, moved, or deleted). No full re-scan. */
export function refreshPaths(relPaths: string[]): void {
  const s = ensure();
  for (const rel of relPaths) {
    if (!rel.toLowerCase().endsWith(".md")) continue;
    if (!upsert(s, rel)) remove(s, rel);
  }
  recomputeLinks(s);
}

export function listNotes(): NoteMeta[] {
  return [...ensure().notes.values()];
}

/** Notes ordered by last modification, newest first. Powers "what changed lately". */
export function listRecent(sinceMs?: number, limit = 20): NoteMeta[] {
  return [...ensure().notes.values()]
    .filter((n) => (sinceMs ? n.mtimeMs >= sinceMs : true))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);
}

export function getNote(relPath: string): Note | null {
  const s = ensure();
  const abs = path.join(s.dir, relPath);
  let raw: string;
  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
  const { meta, body } = parseNote(relPath, raw);
  return { ...meta, mtimeMs: s.notes.get(relPath)?.mtimeMs ?? 0, body, raw };
}

export interface SearchHit {
  path: string;
  title: string;
  folder: string;
  type?: string;
  status?: string;
  /** Trust class, independent of relevance. See lib/vault/authority.ts. */
  authority: Authority;
  score: number;
  snippet?: string;
  /** Present only when a retired note is returned anyway (includeInvalid) — why it's stale. */
  reason?: string;
}

/** A note that matched the query but was withheld — the "explainable rejection". */
export interface SearchExclusion {
  path: string;
  title: string;
  folder: string;
  authority: Authority;
  /** Why it was withheld, e.g. "superseded by price-live" or "expired 2026-06-01". */
  reason: string;
}

export interface SearchResult {
  hits: SearchHit[];
  /** Matches held back as archived/superseded/expired, so an agent can say what it ignored and why. */
  excluded: SearchExclusion[];
}

export interface SearchOpts {
  limit?: number;
  /** Restrict to one top-level folder. */
  folder?: string;
  /** Include notes in archive folders (still ranked far below live ones). Default false. */
  includeArchive?: boolean;
  /** Include superseded/expired notes as hits (still demoted). Default false — they go to `excluded`. */
  includeInvalid?: boolean;
  /** Attach ~200 chars of matching context per hit. Default true. */
  snippets?: boolean;
}

/** First body line containing a query term (or the first prose line), trimmed for display. */
function snippetFor(dir: string, rel: string, terms: string[]): string | undefined {
  try {
    const raw = fs.readFileSync(path.join(dir, rel), "utf8");
    const { body } = parseNote(rel, raw);
    const lines = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("---"));
    const hit = lines.find((l) => {
      const low = l.toLowerCase();
      return terms.some((t) => low.includes(t));
    });
    const chosen = hit ?? lines[0];
    if (!chosen) return undefined;
    return chosen.length > 220 ? `${chosen.slice(0, 217)}…` : chosen;
  } catch {
    return undefined;
  }
}

interface StoredDoc {
  id: string;
  title: string;
  folder: string;
  type?: string;
  status?: string;
  authority: Authority;
  validUntil?: number | null;
  supersededBy?: string | null;
  score: number;
}

/**
 * Keyword search, reweighted by authority, then partitioned by validity.
 *
 * Three stages: MiniSearch says how well a note *matches*; authority says how far it can be
 * *trusted*; and the validity overlay (superseded / expired) decides whether it's still true at
 * all. A retired note is withheld from `hits` and reported in `excluded` with a reason — so an
 * agent can state what it ignored and why, instead of quietly quoting a dead fact.
 */
export function searchNotes(q: string, opts: SearchOpts = {}): SearchResult {
  const s = ensure();
  if (!q.trim()) return { hits: [], excluded: [] };
  const { limit = 20, folder, includeArchive = false, includeInvalid = false, snippets = true } = opts;
  const now = Date.now();
  const EXCLUDE_CAP = 10;

  const raw = s.search.search(q, {
    // Effective weight: overlay validity onto the stored authority so an expired/superseded note
    // is demoted at query time — no re-index needed (the index-time authority is frozen).
    boostDocument: (_id, _term, stored) => {
      const d = stored as { authority?: Authority; validUntil?: number | null; supersededBy?: string | null } | undefined;
      const eff = overlayValidity((d?.authority as Authority) ?? "current", d?.validUntil, d?.supersededBy, now);
      return weightOf(eff.authority);
    },
    // Folder is the only hard filter here; archived/superseded/expired flow through so they can be
    // partitioned into `excluded` with a reason rather than silently dropped.
    filter: (r) => {
      const stored = r as unknown as { folder: string };
      return !folder || stored.folder === folder;
    },
  });

  const hits: SearchHit[] = [];
  const excluded: SearchExclusion[] = [];

  for (const r of raw) {
    if (hits.length >= limit && excluded.length >= EXCLUDE_CAP) break;
    const d = r as unknown as StoredDoc;
    const eff = overlayValidity(d.authority, d.validUntil, d.supersededBy, now);
    const isArchived = eff.authority === "archived";
    const withhold = isArchived ? !includeArchive : eff.retired && !includeInvalid;

    if (withhold) {
      if (excluded.length < EXCLUDE_CAP) {
        excluded.push({ path: d.id, title: d.title, folder: d.folder, authority: eff.authority, reason: eff.reason ?? "retired" });
      }
      continue;
    }
    if (hits.length < limit) {
      hits.push({
        path: d.id,
        title: d.title,
        folder: d.folder,
        type: d.type || undefined,
        status: d.status || undefined,
        authority: eff.authority,
        score: d.score,
        reason: eff.retired ? eff.reason : undefined,
      });
    }
  }

  if (snippets && hits.length > 0) {
    const terms = q
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9-]/g, ""))
      .filter((t) => t.length >= 3);
    for (const h of hits) h.snippet = snippetFor(s.dir, h.path, terms);
  }

  return { hits, excluded };
}

export function getBacklinks(relPath: string): NoteMeta[] {
  const s = ensure();
  return [...(s.inEdges.get(relPath) ?? [])].map((p) => s.notes.get(p)).filter(Boolean) as NoteMeta[];
}

export function getOutlinks(relPath: string): NoteMeta[] {
  const s = ensure();
  return [...(s.outEdges.get(relPath) ?? [])].map((p) => s.notes.get(p)).filter(Boolean) as NoteMeta[];
}

/**
 * What this vault actually looks like + how search will treat it. Returned by brain_schema so
 * an agent meeting an unfamiliar vault discovers its conventions instead of assuming ours.
 */
export function vaultConventions() {
  const s = ensure();
  const folders = new Set<string>();
  const statuses = new Map<string, number>();
  const types = new Set<string>();
  const malformed: Array<{ path: string; error: string }> = [];
  const unknownStatus: Array<{ path: string; status: string }> = [];
  let archived = 0;
  let superseded = 0;
  let expired = 0;
  const now = Date.now();

  for (const n of s.notes.values()) {
    folders.add(n.folder);
    if (n.type) types.add(n.type);
    if (n.status) statuses.set(n.status, (statuses.get(n.status) ?? 0) + 1);
    if (isUnrecognizedStatus(n.status)) unknownStatus.push({ path: n.path, status: n.status! });
    if (isArchivedPath(n.path)) archived++;
    if (n.frontmatterError) malformed.push({ path: n.path, error: n.frontmatterError });
    if (n.supersededBy) superseded++;
    else if (n.validUntil != null && n.validUntil < now) expired++;
  }

  return {
    noteCount: s.notes.size,
    archivedCount: archived,
    supersededCount: superseded,
    expiredCount: expired,
    folders: [...folders].sort(),
    types: [...types].sort(),
    statusesInUse: [...statuses.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => ({ status, count })),
    ranking: authorityRules(),
    integrity: {
      duplicateStems: [...s.duplicateStems.entries()].map(([stem, paths]) => ({ stem, paths })),
      malformedFrontmatter: malformed,
      unrecognizedStatus: unknownStatus,
      ...(s.duplicateStems.size > 0
        ? { duplicateStemWarning: "Wikilinks to a duplicated stem resolve to the first path only. Rename one." }
        : {}),
      ...(malformed.length > 0
        ? {
            malformedFrontmatterWarning:
              "These notes open with `---` but their YAML is unparseable, so their status, tags and title are being ignored — they rank as ordinary notes regardless of what they claim. Usual cause: an unquoted `:` in a value. Fix by quoting it.",
          }
        : {}),
      ...(unknownStatus.length > 0
        ? {
            unrecognizedStatusWarning:
              "These notes carry a `status:` the ranking model does not recognise, so they rank as plain `current` no matter what they claim. Often a typo (`lokced`), sometimes a vault convention this instance has not been told about. See ranking.statusWords for the vocabulary.",
          }
        : {}),
    },
  };
}

export function getGraph(folder?: string): Graph {
  const s = ensure();
  const inScope = (p: string) => !folder || s.notes.get(p)?.folder === folder;
  const degree = new Map<string, number>();
  const bump = (p: string) => degree.set(p, (degree.get(p) ?? 0) + 1);

  const edges: GraphEdge[] = [];
  for (const [src, set] of s.outEdges) {
    for (const tgt of set) {
      if (!inScope(src) || !inScope(tgt)) continue;
      edges.push({ source: src, target: tgt });
      bump(src);
      bump(tgt);
    }
  }
  const nodes: GraphNode[] = [...s.notes.values()]
    .filter((n) => inScope(n.path))
    .map((n) => ({ id: n.path, label: n.title, folder: n.folder, type: n.type, degree: degree.get(n.path) ?? 0 }));

  return { nodes, edges };
}

export function getTree(): TreeNode {
  const s = ensure();
  const root: TreeNode = { name: "", path: "", type: "dir", children: [] };
  const dirs = new Map<string, TreeNode>([["", root]]);

  function ensureDir(dirPath: string): TreeNode {
    const existing = dirs.get(dirPath);
    if (existing) return existing;
    const parentPath = dirPath.split("/").slice(0, -1).join("/");
    const parent = ensureDir(parentPath);
    const node: TreeNode = { name: dirPath.split("/").pop()!, path: dirPath, type: "dir", children: [] };
    parent.children!.push(node);
    dirs.set(dirPath, node);
    return node;
  }

  for (const n of [...s.notes.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    const dirPath = n.path.split("/").slice(0, -1).join("/");
    ensureDir(dirPath).children!.push({ name: n.slug, path: n.path, type: "file", title: n.title });
  }

  (function sortRec(node: TreeNode) {
    node.children?.sort((a, b) => (a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name)));
    node.children?.forEach(sortRec);
  })(root);

  return root;
}

/** Read a top-level meta file (SCHEMA.md / INDEX.md) from the active vault, or null. */
export function readVaultFile(name: string): string | null {
  try {
    return fs.readFileSync(path.join(activeVaultDir(), name), "utf8");
  } catch {
    return null;
  }
}
