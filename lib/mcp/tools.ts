import {
  getBacklinks,
  getGraph,
  getNote,
  getTree,
  listNotes,
  listRecent,
  readVaultFile,
  searchNotes,
  vaultConventions,
} from "@/lib/vault/store";
import { authorityOf } from "@/lib/vault/authority";
import { extractSection, listHeadings } from "@/lib/vault/parse";
import {
  appendNote,
  createFolder,
  deleteNote,
  moveNote,
  writeNote,
  writeNoteRaw,
} from "@/lib/vault/write";
import { captureNote } from "@/lib/harness";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Args = Record<string, any>;

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Args) => Promise<unknown> | unknown;
}

const s = (description: string) => ({ type: "string", description });

/**
 * Resolve a note write from whichever convention the caller used, so brain_write and
 * brain_edit are interchangeable and forgiving:
 *   - `content`: full raw markdown (frontmatter included) → written as-is.
 *   - `body` that already starts with `---` (embedded frontmatter, no fm object) → raw.
 *   - `body` (+ optional `frontmatter` object) → structured write.
 * Throws on an empty write instead of silently creating an empty note.
 */
async function writeFromArgs(a: Args): Promise<string> {
  const p = String(a.path);
  const fm = a.frontmatter && typeof a.frontmatter === "object" ? a.frontmatter : undefined;
  const hasFm = !!fm && Object.keys(fm).length > 0;
  const bodyStr = typeof a.body === "string" ? a.body : "";
  const contentStr = typeof a.content === "string" ? a.content : "";
  const raw = contentStr.trim() !== "" ? contentStr : !hasFm && bodyStr.trim().startsWith("---") ? bodyStr : "";
  if (raw.trim() !== "") return writeNoteRaw(p, raw);
  if (bodyStr.trim() !== "" || hasFm) return writeNote(p, bodyStr, fm);
  throw new Error(
    "Nothing to write. Pass `body` (markdown, + optional `frontmatter` object) or `content` (full raw markdown incl. frontmatter). Refusing to create an empty note.",
  );
}

export const TOOLS: Tool[] = [
  {
    name: "brain_schema",
    description:
      "READ THIS FIRST, before searching or writing. Returns the vault's SCHEMA.md (folder taxonomy, frontmatter conventions, wikilink model, write protocol) AND a live description of this specific vault: its folders, the `status:` values actually in use, how search ranks notes by authority, and any integrity warnings. Vaults differ — never assume conventions, read them here.",
    inputSchema: { type: "object", properties: {} },
    handler: () => ({
      schema: readVaultFile("SCHEMA.md") ?? "(no SCHEMA.md in this vault)",
      conventions: vaultConventions(),
    }),
  },
  {
    name: "brain_search",
    description:
      "Keyword search across the vault. Returns ranked hits with `path`, `title`, `folder`, `status`, `snippet`, and `authority`.\n\n" +
      "IMPORTANT — ranking is by keyword relevance, NOT by truth. A superseded document repeats the query words just as often as the live one, so it can outrank it. Every hit carries an `authority` field: `authoritative` (source of truth — prefer it), `current`, `provisional` (draft/proposed — never quote as settled), `superseded`, `archived`. Rank order is a suggestion; `authority` is the signal.\n\n" +
      "Before quoting a price, guarantee, contract term, or any other single-valued fact, open the `authoritative` note and read it. If two notes disagree on such a fact, that is a defect in the vault — report it rather than averaging them.\n\n" +
      "Archived notes are excluded unless `includeArchive` is true.",
    inputSchema: {
      type: "object",
      properties: {
        query: s("search query — a few keywords beat a full sentence"),
        limit: { type: "number", description: "max results (default 20)" },
        folder: s("restrict to one top-level folder, e.g. 'decisions'"),
        includeArchive: { type: "boolean", description: "include historical notes in archive folders (default false)" },
      },
      required: ["query"],
    },
    handler: ({ query, limit, folder, includeArchive }) =>
      searchNotes(String(query ?? ""), {
        limit: typeof limit === "number" ? limit : 20,
        folder: folder ? String(folder) : undefined,
        includeArchive: includeArchive === true,
      }),
  },
  {
    name: "brain_read",
    description:
      "Read a note: full markdown (frontmatter + body), its `authority`, and its backlinks. Path is vault-relative, e.g. 'clients/mks/mks.md'.\n\n" +
      "Pass `section` to read just one heading's content instead of the whole file — cheaper on long documents. If the heading isn't found you get the list of available headings back.\n\n" +
      "Always check the returned `authority` before acting on the content: `archived` and `superseded` notes are history, not instructions.",
    inputSchema: {
      type: "object",
      properties: {
        path: s("vault-relative path"),
        section: s("optional heading to extract, e.g. 'Pricing' — matches case-insensitively by prefix"),
      },
      required: ["path"],
    },
    handler: ({ path, section }) => {
      const n = getNote(String(path));
      if (!n) return { error: "not found", path };
      const base = {
        path: n.path,
        title: n.title,
        status: n.status,
        authority: authorityOf(n),
        tags: n.tags,
        frontmatter: n.frontmatter,
        backlinks: getBacklinks(n.path).map((b) => b.path),
      };
      if (!section) return { ...base, content: n.raw };

      const found = extractSection(n.body, String(section));
      if (found === null) {
        return { ...base, error: `section "${section}" not found`, sections: listHeadings(n.body) };
      }
      return { ...base, section: String(section), content: found, sections: listHeadings(n.body) };
    },
  },
  {
    name: "brain_list",
    description:
      "List every note with metadata (path, title, folder, type, tags, status, authority). Use to discover what exists. `authority` tells you which notes are source-of-truth and which are history.",
    inputSchema: { type: "object", properties: {} },
    handler: () =>
      listNotes().map((n) => ({
        path: n.path,
        title: n.title,
        folder: n.folder,
        type: n.type,
        tags: n.tags,
        status: n.status,
        authority: authorityOf(n),
      })),
  },
  {
    name: "brain_recent",
    description:
      "Notes changed most recently, newest first. Use to catch up on what humans or other agents have done since you last looked.",
    inputSchema: {
      type: "object",
      properties: {
        since: s("optional ISO date/time — only notes modified at or after this"),
        limit: { type: "number", description: "max results (default 20)" },
      },
    },
    handler: ({ since, limit }) => {
      const t = since ? Date.parse(String(since)) : NaN;
      return listRecent(Number.isNaN(t) ? undefined : t, typeof limit === "number" ? limit : 20).map((n) => ({
        path: n.path,
        title: n.title,
        folder: n.folder,
        status: n.status,
        authority: authorityOf(n),
        modified: new Date(n.mtimeMs).toISOString(),
      }));
    },
  },
  {
    name: "brain_tree",
    description: "Return the folder/file tree of the vault.",
    inputSchema: { type: "object", properties: {} },
    handler: () => getTree(),
  },
  {
    name: "brain_backlinks",
    description: "Notes that link to the given note.",
    inputSchema: { type: "object", properties: { path: s("vault-relative path") }, required: ["path"] },
    handler: ({ path }) => ({ backlinks: getBacklinks(String(path)).map((n) => n.path) }),
  },
  {
    name: "brain_graph",
    description: "The knowledge graph (nodes + edges from wikilinks and related:). Optional folder filter.",
    inputSchema: { type: "object", properties: { folder: s("optional folder filter") } },
    handler: ({ folder }) => getGraph(folder ? String(folder) : undefined),
  },
  {
    name: "brain_write",
    description:
      "Create or overwrite a note. Pass EITHER `body` (markdown) + optional `frontmatter` (object), OR `content` (full raw markdown incl. frontmatter, same as brain_edit) — either works. Follow SCHEMA.md: kebab-case path, dated names for daily/decisions, frontmatter with title/type/tags/status. Path vault-relative (e.g. decisions/foo-2026-07-09.md).",
    inputSchema: {
      type: "object",
      properties: {
        path: s("vault-relative path, e.g. decisions/foo-2026-07-09.md"),
        body: s("markdown body (pair with `frontmatter`)"),
        frontmatter: { type: "object", description: "YAML frontmatter object: title, type, tags, status, related, ..." },
        content: s("full raw markdown incl. frontmatter — alternative to body+frontmatter"),
      },
      required: ["path"],
    },
    handler: async (a) => ({ ok: true, path: await writeFromArgs(a) }),
  },
  {
    name: "brain_edit",
    description:
      "Overwrite a note. Pass `content` (full raw markdown incl. frontmatter) — read first with brain_read, then write the whole file back. Also accepts `body` (+ optional `frontmatter`) like brain_write.",
    inputSchema: {
      type: "object",
      properties: {
        path: s("vault-relative path"),
        content: s("full raw markdown incl. frontmatter"),
        body: s("markdown body (alternative to content; pair with `frontmatter`)"),
        frontmatter: { type: "object", description: "YAML frontmatter object (with `body`)" },
      },
      required: ["path"],
    },
    handler: async (a) => ({ ok: true, path: await writeFromArgs(a) }),
  },
  {
    name: "brain_append",
    description: "Append text to a note (creates it if missing).",
    inputSchema: {
      type: "object",
      properties: { path: s("vault-relative path"), text: s("text to append") },
      required: ["path", "text"],
    },
    handler: async ({ path, text }) => ({ ok: true, path: await appendNote(String(path), String(text ?? "")) }),
  },
  {
    name: "brain_move",
    description:
      "Move or rename a note. This is how you retire something: when a note stops being true, move it to an archive folder (see brain_schema → conventions.ranking.archiveFolders) rather than deleting it. Archived notes are demoted in search and excluded by default, so they stop misleading agents while the reasoning trail survives. Leave a pointer in the replacement note saying what superseded what.",
    inputSchema: { type: "object", properties: { from: s("current path"), to: s("new path") }, required: ["from", "to"] },
    handler: async ({ from, to }) => ({ ok: true, path: await moveNote(String(from), String(to)) }),
  },
  {
    name: "brain_create_folder",
    description: "Create a new folder in the vault (with a .gitkeep).",
    inputSchema: { type: "object", properties: { path: s("folder path") }, required: ["path"] },
    handler: async ({ path }) => ({ ok: true, path: await createFolder(String(path)) }),
  },
  {
    name: "brain_capture",
    description:
      "Capture a ROUGH note / brain-dump and let the vault file it automatically: it reads SCHEMA.md + the current folders, picks the right folder + filename, writes clean frontmatter, and structures the body. Use when you have unstructured input and don't want to decide the path yourself.",
    inputSchema: { type: "object", properties: { text: s("the rough note / brain dump to file") }, required: ["text"] },
    handler: async ({ text }) => await captureNote(String(text ?? "")),
  },
  {
    name: "brain_delete",
    description:
      "Delete a note (recoverable via git history). Prefer brain_move into an archive folder — deleting destroys the reasoning trail, archiving only removes it from search. Delete when the note is wrong or duplicated, archive when it is merely no longer true.",
    inputSchema: { type: "object", properties: { path: s("vault-relative path") }, required: ["path"] },
    handler: async ({ path }) => {
      await deleteNote(String(path));
      return { ok: true };
    },
  },
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));
