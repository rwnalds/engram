import fsp from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { activeVaultDir } from "@/lib/repos";
import { refreshPaths, getNote } from "./store";
import { humanize, stemOf } from "./parse";
import { checkFrontmatter, frontmatterErrorMessage } from "./validate";
import { guardConflict } from "./conflict";
import { requestSync } from "@/lib/git";
import { currentActor } from "@/lib/actor";

/** Resolve a vault-relative path to an absolute path in the active vault, refusing escapes. */
function safeAbs(relPath: string): string {
  const root = path.resolve(activeVaultDir());
  const abs = path.resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error("path escapes the vault");
  return abs;
}

export function normalizeNotePath(relPath: string): string {
  const p = relPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.\.(\/|$)/g, "");
  return /\.md$/i.test(p) ? p : `${p}.md`;
}

/**
 * Re-index only what changed, then queue a git commit stamped with who caused it.
 * The actor prefix is what turns the Activity feed into an audit trail rather than a
 * list of anonymous edits. `touched` are vault-relative paths.
 */
function after(message: string, touched: string[]) {
  refreshPaths(touched);
  requestSync(`${currentActor()}: ${message}`);
}

export interface WriteOpts {
  /**
   * Reject the write when the frontmatter cannot be parsed back.
   * True for agents (MCP) — a machine has no excuse for emitting broken YAML, and a corrupt
   * note silently loses its authority. False for the dashboard editor, where a human may save
   * a half-typed document; they get a warning instead of losing their work.
   */
  strict?: boolean;
  /**
   * Permit a write that destroys most of an existing note. Default false for agents.
   * A human in the editor is looking at what they're deleting; an agent usually is not.
   */
  allowShrink?: boolean;
  /**
   * Permit creating a note that duplicates a live note's subject. Default false for agents.
   * See `guardConflict` — the common failure is an agent adding a second live price note
   * instead of superseding the first.
   */
  allowConflict?: boolean;
}

/** An existing note this size or larger is worth protecting from an accidental truncation. */
const SHRINK_FLOOR_BYTES = 400;
/** Replacing a note with less than this fraction of its content looks like an accident. */
const SHRINK_RATIO = 0.3;

/**
 * Refuse to replace a substantial note with a stub.
 *
 * A real incident: an agent was told "replace {{BOOKING_LINK}} in this file", and wrote that
 * *instruction* into the file as its entire contents — destroying a 5.6KB snippet library.
 * `writeNote` overwrites blind, so nothing stopped it. Overwriting is legitimate (an agent
 * reads a note and writes it back), but collapsing 5.6KB to 170 bytes is a mistake worth
 * refusing until someone says they meant it.
 */
async function guardTruncation(abs: string, relPath: string, next: string, allowShrink: boolean): Promise<void> {
  if (allowShrink) return;
  let existing: string;
  try {
    existing = await fsp.readFile(abs, "utf8");
  } catch {
    return; // new note — nothing to destroy
  }
  if (existing.length < SHRINK_FLOOR_BYTES) return;
  if (next.length >= existing.length * SHRINK_RATIO) return;
  throw new Error(
    `Refusing to write ${relPath}: it would shrink from ${existing.length} to ${next.length} bytes, ` +
      `discarding most of the note. Read it first (brain_read) and write back the full content you intend to keep. ` +
      `To append, use brain_append. If you really mean to replace it, pass overwrite: true.`,
  );
}

/**
 * Structural read-before-overwrite. Not a size heuristic like `guardTruncation` — this refuses the
 * write outright until the caller has actually opened the note, so a same-size clobber is caught
 * too. Returns an error message for the model, or null to proceed.
 *
 * Shared by the Curator loop (which tracks reads per run) and the MCP tools (which track them per
 * caller — see lib/mcp/session.ts). It used to live only in the loop, which left the surface that
 * matters most, a coding agent writing over MCP, protected by the size heuristic alone.
 */
export function guardOverwrite(toolName: string, target: string, hasRead: (p: string) => boolean): string | null {
  if (toolName !== "brain_write" && toolName !== "brain_edit") return null;
  if (!target || hasRead(target)) return null;
  let exists = false;
  try {
    exists = getNote(normalizeNotePath(target)) !== null;
  } catch {
    return null;
  }
  if (!exists) return null;
  return `${target} already exists and you have not read it in this session. Call brain_read("${target}") first, then write back the full content you intend to keep — or use brain_append to add to it.`;
}

async function fileExists(abs: string): Promise<boolean> {
  try {
    await fsp.access(abs);
    return true;
  } catch {
    return false;
  }
}

/** Write a note from a raw markdown string (frontmatter included). Used by the editor. */
export async function writeNoteRaw(relPath: string, content: string, opts: WriteOpts = {}): Promise<string> {
  const p = normalizeNotePath(relPath);
  if (opts.strict) {
    const check = checkFrontmatter(content);
    if (!check.ok) throw new Error(frontmatterErrorMessage(p, check.error!));
  }
  const abs = safeAbs(p);
  // Agents only. A human in the editor who names a note `pricing-2026` next to `pricing` can see
  // both in the sidebar and meant it; an agent usually has not looked.
  if (opts.strict) guardConflict(p, !(await fileExists(abs)), opts.allowConflict === true);
  await guardTruncation(abs, p, content, opts.allowShrink === true);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content, "utf8");
  after(`edit ${p}`, [p]);
  return p;
}

/**
 * Write a note from a body + optional frontmatter object. Used by agents (MCP) and the harness.
 * `matter.stringify` serialises the object, so the YAML always parses — this path cannot
 * produce the corruption that hand-written frontmatter can.
 */
export async function writeNote(
  relPath: string,
  body: string,
  frontmatter?: Record<string, unknown>,
  opts: WriteOpts = {},
): Promise<string> {
  const content =
    frontmatter && Object.keys(frontmatter).length > 0 ? matter.stringify(body ?? "", frontmatter) : (body ?? "");
  return writeNoteRaw(relPath, content, { ...opts, strict: true });
}

export async function appendNote(relPath: string, text: string): Promise<string> {
  const p = normalizeNotePath(relPath);
  const abs = safeAbs(p);
  let existing = "";
  try {
    existing = await fsp.readFile(abs, "utf8");
  } catch {
    /* new file */
  }
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const sep = existing && !existing.endsWith("\n") ? "\n" : "";
  await fsp.writeFile(abs, `${existing}${sep}${text}\n`, "utf8");
  after(`append ${p}`, [p]);
  return p;
}

export async function moveNote(from: string, to: string): Promise<string> {
  const a = safeAbs(normalizeNotePath(from));
  const b = safeAbs(normalizeNotePath(to));
  await fsp.mkdir(path.dirname(b), { recursive: true });
  await fsp.rename(a, b);
  after(`move ${from} -> ${to}`, [normalizeNotePath(from), normalizeNotePath(to)]);
  return normalizeNotePath(to);
}

export async function deleteNote(relPath: string): Promise<void> {
  await fsp.rm(safeAbs(normalizeNotePath(relPath)));
  after(`delete ${relPath}`, [normalizeNotePath(relPath)]);
}

/**
 * Atomically retire OLD in favor of NEW, in a single commit.
 *
 * This is the "add and retire can't drift apart" primitive. It marks the old note superseded
 * *in place* (frontmatter only — body preserved, so backlinks and chronology survive and the
 * truncation guard never trips), ensures the replacement exists, and records both in ONE `after()`
 * call so git-sync produces exactly one commit (the `moveNote` atomicity pattern). Query-time
 * search then withholds the old note with the reason "superseded by <new>".
 *
 * Uses raw `fsp` writes deliberately — `writeNote`/`appendNote` each call `after()` themselves,
 * which would split the operation across two commits.
 */
export async function supersedeNote(
  from: string,
  to: string,
  reason?: string,
  body?: string,
): Promise<{ from: string; to: string }> {
  const fromPath = normalizeNotePath(from);
  const toPath = normalizeNotePath(to);
  if (fromPath === toPath) throw new Error("supersede: `from` and `to` must be different notes.");
  const fromAbs = safeAbs(fromPath);
  const toAbs = safeAbs(toPath);

  let oldRaw: string;
  try {
    oldRaw = await fsp.readFile(fromAbs, "utf8");
  } catch {
    throw new Error(`Cannot supersede ${fromPath}: it does not exist.`);
  }
  // Refuse rather than silently rewrite a note whose YAML is already broken.
  const check = checkFrontmatter(oldRaw);
  if (!check.ok) {
    throw new Error(`Refusing to supersede ${fromPath}: its frontmatter is already unparseable (${check.error}). Fix it first.`);
  }

  const toStem = stemOf(toPath);
  const fromStem = stemOf(fromPath);
  const today = new Date(Date.now()).toISOString().slice(0, 10);

  // 1. Mark OLD superseded in place — frontmatter only, body verbatim.
  const g = matter(oldRaw);
  const data: Record<string, unknown> = { ...(g.data as Record<string, unknown>) };
  data.status = "superseded";
  data.superseded_by = `[[${toStem}]]`;
  data.superseded_at = today;
  if (reason) data.superseded_reason = reason;
  const oldOut = matter.stringify(g.content, data);

  // 2. Prepare NEW if it doesn't exist yet (from `body`, or a minimal stub linking back).
  let newContent: string | null = null;
  try {
    await fsp.access(toAbs);
  } catch {
    if (body && body.trim().startsWith("---")) {
      const bc = checkFrontmatter(body);
      if (!bc.ok) throw new Error(`supersede: the replacement's frontmatter is invalid (${bc.error}). Pass a plain body, or valid YAML.`);
      newContent = body;
    } else {
      newContent = matter.stringify(body?.trim() || `Supersedes [[${fromStem}]]${reason ? ` — ${reason}` : ""}.`, {
        title: humanize(toStem),
        supersedes: `[[${fromStem}]]`,
      });
    }
  }

  // 3. Write both, then one after() → one refreshPaths + one commit.
  await fsp.mkdir(path.dirname(fromAbs), { recursive: true });
  await fsp.writeFile(fromAbs, oldOut, "utf8");
  if (newContent !== null) {
    await fsp.mkdir(path.dirname(toAbs), { recursive: true });
    await fsp.writeFile(toAbs, newContent, "utf8");
  }
  after(`supersede ${fromPath} -> ${toPath}${reason ? `: ${reason}` : ""}`, [fromPath, toPath]);
  return { from: fromPath, to: toPath };
}

export async function createFolder(relPath: string): Promise<string> {
  const p = relPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\.\.(\/|$)/g, "");
  const abs = safeAbs(p);
  await fsp.mkdir(abs, { recursive: true });
  await fsp.writeFile(path.join(abs, ".gitkeep"), "", "utf8");
  requestSync(`${currentActor()}: mkdir ${p}`);
  return p;
}
