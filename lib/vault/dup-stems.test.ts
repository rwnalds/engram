import { test, expect, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { TEST_VAULT } from "../../test/setup";
import { rebuildIndex, refreshPaths } from "./store";

/**
 * A duplicated filename stem is a permanent property of a vault's layout — no reindex resolves it.
 * The warning therefore has to be edge-triggered, because `recomputeLinks` runs on every write and
 * every watcher flush. Warning on state instead of on change is what made a 4-README vault reprint
 * the same line into the deploy log forever.
 *
 * "Already warned" is process-lifetime state, so each test below claims its OWN stem. Sharing one
 * across tests would make them order-dependent — which is the honest cost of the memo, not a bug.
 */

function write(rel: string, body: string) {
  const abs = path.join(TEST_VAULT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

function warnings(fn: () => void): string[] {
  const out: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => void out.push(a.join(" "));
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return out.filter((l) => l.includes("duplicate stem"));
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

test("duplicate stems nothing links to stay silent", () => {
  fourWay("OVERVIEW");
  write("notes/a.md", "# A\n\nno wikilinks here\n");
  expect(warnings(rebuildIndex)).toEqual([]);
});

test("a linked duplicate stem is reported once, not on every later reindex", () => {
  fourWay("README");
  write("notes/a.md", "# A\n\nsee [[README]] for context\n");

  const first = warnings(rebuildIndex);
  expect(first).toHaveLength(1);
  // Actionable: names the note holding the link, the winner, and what it shadows.
  expect(first[0]).toContain("notes/a.md");
  expect(first[0]).toContain("resolves to README.md");
  expect(first[0]).toContain("leads/brands/README.md");

  // Unrelated writes each re-run recomputeLinks. None of them may reprint.
  for (let i = 0; i < 3; i++) {
    write(`notes/b${i}.md`, `# B${i}\n\nunrelated\n`);
    expect(warnings(() => refreshPaths([`notes/b${i}.md`]))).toEqual([]);
  }
  // Neither may a full rebuild.
  expect(warnings(rebuildIndex)).toEqual([]);
});

test("a collision that is resolved and then reintroduced warns again", () => {
  fourWay("GUIDE");
  write("notes/a.md", "# A\n\nsee [[GUIDE]]\n");
  expect(warnings(rebuildIndex)).toHaveLength(1);

  // Resolve it: nothing links the ambiguous stem any more.
  write("notes/a.md", "# A\n\nno link now\n");
  expect(warnings(() => refreshPaths(["notes/a.md"]))).toEqual([]);

  // Reintroduce it — the earlier report must not suppress the new one.
  write("notes/a.md", "# A\n\nsee [[GUIDE]] again\n");
  expect(warnings(() => refreshPaths(["notes/a.md"]))).toHaveLength(1);
});
