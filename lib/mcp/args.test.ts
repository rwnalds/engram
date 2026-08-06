import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { TOOL_MAP } from "./tools";
import { callTool } from "./call";

/**
 * The 2026-08-06 silent data-loss incident, pinned.
 *
 * Five `brain_append` calls to `clients/kolumbi/delivery.md` and `access.md` each returned
 * `{ ok: true }` and each committed exactly ONE BLANK LINE — the payload never reached disk.
 * The tool takes `text`; its siblings `brain_write`/`brain_edit` take `content`. Nothing on the
 * server validated `arguments` against `inputSchema`, so a call carrying `content` destructured
 * `text` as `undefined`, `String(undefined ?? "")` became `""`, and `appendNote` wrote
 * `existing + "\n"`. The caller was told it succeeded.
 *
 * Two independent defects, so two independent guards:
 *   1. arguments are validated against the tool's own inputSchema before the handler runs, and
 *   2. an append with nothing to append is refused outright.
 */

const vault = process.env.VAULT_DIR!;

function seed(rel: string, content: string): string {
  const abs = path.join(vault, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return abs;
}
const read = (rel: string) => fs.readFileSync(path.join(vault, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(vault, rel));

const NOTE = "clients/kolumbi/delivery.md";
const BODY = `---
title: Delivery
updated: '2026-07-14'
---

# Delivery

## Log

- **2026-07-20** — Phase 3 content build completed.
`;

afterEach(() => {
  fs.rmSync(path.join(vault, "clients"), { recursive: true, force: true });
  fs.rmSync(path.join(vault, "undefined.md"), { force: true });
});

describe("brain_append — the incident", () => {
  test("a payload under the wrong key is REFUSED, not silently dropped", async () => {
    seed(NOTE, BODY);
    // Exactly what production received: `content` (brain_write's parameter) instead of `text`.
    await expect(
      callTool("brain_append", { path: NOTE, content: "- **2026-08-06** — Bitwarden collection created." }),
    ).rejects.toThrow(/text/);
    // and the note is untouched — no stray blank line
    expect(read(NOTE)).toBe(BODY);
  });

  test("the refusal names the parameter the caller should have used", async () => {
    seed(NOTE, BODY);
    const err = await callTool("brain_append", { path: NOTE, content: "x" }).catch((e: Error) => e);
    expect((err as Error).message).toContain("brain_append");
    expect((err as Error).message).toContain("text");
    expect((err as Error).message).toContain("content");
  });

  test("an empty or whitespace-only append is refused", async () => {
    seed(NOTE, BODY);
    for (const text of ["", "   ", "\n\n"]) {
      await expect(callTool("brain_append", { path: NOTE, text })).rejects.toThrow(/[Nn]othing to append/);
    }
    expect(read(NOTE)).toBe(BODY);
  });

  test("a missing `text` is refused rather than appending a blank line", async () => {
    seed(NOTE, BODY);
    await expect(callTool("brain_append", { path: NOTE })).rejects.toThrow();
    expect(read(NOTE)).toBe(BODY);
  });

  test("a well-formed append still works, and the text is on disk", async () => {
    seed(NOTE, BODY);
    const entry = "- **2026-08-06** — Bitwarden collection created for Kolumbi.";
    const res = (await callTool("brain_append", { path: NOTE, text: entry })) as { ok: boolean; path: string };
    expect(res.ok).toBe(true);
    expect(read(NOTE)).toContain(entry);
    expect(read(NOTE).startsWith(BODY)).toBe(true);
  });

  test("consecutive appends all survive", async () => {
    seed(NOTE, BODY);
    for (const n of ["ONE", "TWO", "THREE"]) {
      await callTool("brain_append", { path: NOTE, text: `- entry ${n}` });
    }
    const out = read(NOTE);
    for (const n of ["ONE", "TWO", "THREE"]) expect(out).toContain(`- entry ${n}`);
  });
});

describe("argument validation covers every tool", () => {
  test("an unknown argument is refused everywhere, not coerced", async () => {
    seed(NOTE, BODY);
    await expect(callTool("brain_read", { path: NOTE, sekshun: "Log" })).rejects.toThrow(/sekshun/);
  });

  test("a missing required argument is refused before the handler runs", async () => {
    // brain_move without `to` used to rename the note to `undefined.md` and report ok.
    seed(NOTE, BODY);
    await expect(callTool("brain_move", { from: NOTE })).rejects.toThrow(/to/);
    expect(exists(NOTE)).toBe(true);
    expect(exists("undefined.md")).toBe(false);
  });

  test("brain_supersede cannot retire a note into `undefined.md`", async () => {
    seed(NOTE, BODY);
    await expect(callTool("brain_supersede", { from: NOTE })).rejects.toThrow(/to/);
    expect(read(NOTE)).toBe(BODY);
    expect(exists("undefined.md")).toBe(false);
  });

  test("a write with no `path` cannot land in `undefined.md`", async () => {
    // This one is not hypothetical: vault commit 5703072 (2026-07-10) is
    // "brain: 1 change(s) — edit undefined.md", a real 38-line decision note filed at the vault
    // root because `String(undefined)` is "undefined". It was spotted and moved 90 seconds later;
    // nothing but luck made it visible.
    await expect(callTool("brain_write", { body: "---\ntitle: Decision\n---\nreal content" })).rejects.toThrow(/path/);
    await expect(callTool("brain_edit", { content: "---\ntitle: Decision\n---\nreal content" })).rejects.toThrow(/path/);
    expect(exists("undefined.md")).toBe(false);
  });

  test("a wrongly-typed argument is refused rather than stringified", async () => {
    seed(NOTE, BODY);
    await expect(callTool("brain_append", { path: NOTE, text: { md: "hi" } })).rejects.toThrow(/string/);
    expect(read(NOTE)).toBe(BODY);
  });

  test("every tool's required list only names properties it declares", () => {
    // A required key absent from `properties` would be unvalidatable and always reject.
    for (const t of TOOL_MAP.values()) {
      const schema = t.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
      for (const r of schema.required ?? []) {
        expect(Object.keys(schema.properties ?? {})).toContain(r);
      }
    }
  });
});

describe("the write tools refuse an empty payload consistently", () => {
  // brain_write/brain_edit already refused; brain_append did not. That inconsistency IS the bug —
  // a client that says `content` everywhere got an error from one tool and silence from the other.
  test("brain_write refuses an empty note", async () => {
    await expect(callTool("brain_write", { path: "scratch/empty.md" })).rejects.toThrow(/[Nn]othing to write/);
    expect(exists("scratch/empty.md")).toBe(false);
  });

  test("brain_edit refuses an empty overwrite", async () => {
    // A fresh path, so the empty-payload guard is what fires rather than read-before-overwrite
    // (which correctly refuses first on an existing note — see the guardOverwrite tests).
    await expect(callTool("brain_edit", { path: "clients/kolumbi/fresh.md", body: "   " })).rejects.toThrow(
      /[Nn]othing to write/,
    );
    expect(exists("clients/kolumbi/fresh.md")).toBe(false);
  });

  test("no write tool reports ok:true without changing anything", async () => {
    seed(NOTE, BODY);
    const before = read(NOTE);
    const attempts: Array<[string, Record<string, unknown>]> = [
      ["brain_append", { path: NOTE, text: "" }],
      ["brain_append", { path: NOTE, content: "dropped" }],
      ["brain_write", { path: NOTE }],
      ["brain_edit", { path: NOTE, content: "" }],
    ];
    for (const [name, args] of attempts) {
      const res = await callTool(name, args).catch((e: Error) => e);
      expect(res).toBeInstanceOf(Error);
    }
    expect(read(NOTE)).toBe(before);
  });
});
