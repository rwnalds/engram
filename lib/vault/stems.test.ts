import { test, expect, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { TEST_VAULT } from "../../test/setup";
import { stemOf } from "./parse";
import { rebuildIndex, getBacklinks } from "./store";

function write(rel: string, body: string) {
  const abs = path.join(TEST_VAULT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

beforeEach(() => {
  fs.rmSync(TEST_VAULT, { recursive: true, force: true });
  fs.mkdirSync(TEST_VAULT, { recursive: true });
});

test("stemOf strips alias, heading anchor, folder hint and extension", () => {
  expect(stemOf("Pricing")).toBe("Pricing");
  expect(stemOf("Pricing.md")).toBe("Pricing");
  expect(stemOf("docs/Pricing")).toBe("Pricing");
  expect(stemOf("Pricing|alias")).toBe("Pricing");

  // Anchors: the link addresses a section of the note, so it resolves to the note.
  expect(stemOf("Pricing#Tiers")).toBe("Pricing");
  expect(stemOf("Pricing#^block-id")).toBe("Pricing");
  expect(stemOf("docs/Pricing.md#Tiers")).toBe("Pricing");

  // An alias may contain its own '#' — the alias must be removed before the anchor.
  expect(stemOf("Pricing#Tiers|our #1 objection")).toBe("Pricing");

  // A pure self-anchor addresses the current note, so it names no other note.
  expect(stemOf("#Tiers")).toBe("");
});

test("an anchored wikilink produces a real backlink", () => {
  write("pricing.md", "# Pricing\n\n## Tiers\n\nfloor + share\n");
  write("leads/acme.md", "# Acme\n\nquoted from [[pricing#Tiers]] on the call\n");
  rebuildIndex();

  // Before the anchor fix this stem was "pricing#Tiers", which matched no note, so the
  // link vanished: no backlink, no graph edge, silently.
  expect(getBacklinks("pricing.md").map((b) => b.path)).toContain("leads/acme.md");
});

test("a self-anchor does not invent a link", () => {
  write("pricing.md", "# Pricing\n\njump to [[#Tiers]]\n\n## Tiers\n\nfloor + share\n");
  rebuildIndex();
  expect(getBacklinks("pricing.md")).toEqual([]);
});
