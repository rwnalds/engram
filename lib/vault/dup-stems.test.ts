import { test, expect, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { TEST_VAULT } from "../../test/setup";
import { rebuildIndex, refreshPaths, vaultConventions } from "./store";

/**
 * A duplicated filename stem is a property of the vault's layout, not an event: no reindex
 * resolves it, and `recomputeLinks` runs on every write, every watcher flush and every rebuild.
 * Logging it from there put the same line in the deploy log forever. It belongs in the integrity
 * report, which is queryable on demand — so the console stays silent no matter how the index is
 * rebuilt, and the finding is still available in full.
 */

function write(rel: string, body: string) {
  const abs = path.join(TEST_VAULT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

/** Anything the vault index writes to console.warn / console.error while `fn` runs. */
function consoleOutput(fn: () => void): string[] {
  const out: string[] = [];
  const warn = console.warn;
  const error = console.error;
  console.warn = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void out.push(a.join(" "));
  try {
    fn();
  } finally {
    console.warn = warn;
    console.error = error;
  }
  return out;
}

/** Four notes sharing one stem, the layout that produced the original report. */
function fourWay(stem: string) {
  write(`${stem}.md`, "# Root\n");
  write(`archive/${stem}.md`, "# Archive\n");
  write(`leads/${stem}.md`, "# Leads\n");
  write(`leads/brands/${stem}.md`, "# Brands\n");
}

beforeEach(() => {
  fs.rmSync(TEST_VAULT, { recursive: true, force: true });
  fs.mkdirSync(TEST_VAULT, { recursive: true });
});

test("a linked duplicate stem is never logged — not once, not on any reindex", () => {
  fourWay("README");
  write("notes/a.md", "# A\n\nsee [[README]] for context\n");

  expect(consoleOutput(rebuildIndex)).toEqual([]);

  // Every write re-runs recomputeLinks; a full rebuild runs it too. All must stay silent.
  for (let i = 0; i < 3; i++) {
    write(`notes/b${i}.md`, `# B${i}\n\nunrelated\n`);
    expect(consoleOutput(() => refreshPaths([`notes/b${i}.md`]))).toEqual([]);
  }
  expect(consoleOutput(rebuildIndex)).toEqual([]);
});

test("the collision is reported in full by the integrity report instead", () => {
  fourWay("README");
  write("notes/a.md", "# A\n\nsee [[README]] for context\n");
  rebuildIndex();

  const { integrity } = vaultConventions();
  const dupe = integrity.duplicateStems.find((d) => d.stem === "README");
  expect(dupe).toBeDefined();
  expect(dupe!.paths).toEqual(["README.md", "archive/README.md", "leads/README.md", "leads/brands/README.md"]);
  // Names the note to edit — the signal the log line carried, kept.
  expect(dupe!.linkedFrom).toBe("notes/a.md");
  expect(integrity.duplicateStemWarning).toContain("notes/a.md");
  expect(integrity.duplicateStemWarning).toContain("resolves to README.md");
});

test("a collision no wikilink reaches is listed but not flagged", () => {
  fourWay("OVERVIEW");
  write("notes/a.md", "# A\n\nno wikilinks here\n");
  rebuildIndex();

  const { integrity } = vaultConventions();
  // Still visible — the report is the full picture.
  expect(integrity.duplicateStems.find((d) => d.stem === "OVERVIEW")).toBeDefined();
  expect(integrity.duplicateStems.find((d) => d.stem === "OVERVIEW")!.linkedFrom).toBeUndefined();
  // But no warning: nothing resolves to the wrong note, so there is nothing to act on.
  expect(integrity.duplicateStemWarning).toBeUndefined();
});
