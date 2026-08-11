import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GitUnavailableError, SKIPPED, gitPausedFor, gitRead, invalidateGitReads, runGit, tryRunGit } from "./git-queue";

// Standard ESM and a plain timer rather than `import.meta.dir` / `Bun.sleep`, for the reason
// test/setup.ts gives: `next build` type-checks this file with tsc, which knows neither.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The crash this file guards against.
 *
 * Railway logged, on repeat: "Cannot rebase onto multiple branches.", then "cannot fork() for
 * remote-https: Resource temporarily unavailable", then "getaddrinfo() thread failed to start",
 * then SIGABRT and a restart. All three are one bug — concurrent git children on one clone —
 * and the guard that was supposed to prevent it (`let gitBusy` in lib/git.ts) could not, because
 * Next.js compiles that module into several server chunks and each copy got its own `let`.
 */

/** How long two tasks must overlap before we call the queue broken. Zero overlap is the contract. */
const overlaps = (spans: Array<[number, number]>) =>
  spans.some((a, i) => spans.some(([s, e], j) => j !== i && s < a[1] && e > a[0]));

describe("one git child at a time", () => {
  test("concurrent tasks never overlap, whatever order they were queued in", async () => {
    const spans: Array<[number, number]> = [];
    const task = async (ms: number) => {
      const start = performance.now();
      await sleep(ms);
      spans.push([start, performance.now()]);
    };

    await Promise.all([runGit(() => task(20)), runGit(() => task(5)), runGit(() => task(15)), runGit(() => task(1))]);

    expect(spans.length).toBe(4);
    expect(overlaps(spans)).toBe(false);
  });

  test("a task that throws does not strand everything queued behind it", async () => {
    const ran: string[] = [];
    const boom = runGit(async () => {
      ran.push("boom");
      throw new Error("git exploded");
    });
    const after = runGit(async () => {
      ran.push("after");
      return "ok";
    });

    await expect(boom).rejects.toThrow("git exploded");
    expect(await after).toBe("ok");
    expect(ran).toEqual(["boom", "after"]);
  });

  test("a second writer skips instead of stacking onto the first", async () => {
    let ran = 0;
    const held = tryRunGit(() => sleep(20));
    const skipped = await tryRunGit(async () => {
      ran++;
    });

    expect(skipped).toBe(SKIPPED);
    expect(ran).toBe(0);
    await held;

    // …and runs again once the queue drains, so a skipped tick is not a stuck one.
    expect(await tryRunGit(async () => ++ran)).toBe(1);
  });

  test("a read in flight makes a writer wait its turn, not give up", async () => {
    // The sidebar polls `git status` every 10s. That must never be the reason a human's "sync
    // now" reports nothing to do — it only has to stop the two from spawning git at once.
    const spans: Array<[number, number]> = [];
    const task = async (ms: number) => {
      const start = performance.now();
      await sleep(ms);
      spans.push([start, performance.now()]);
      return "done";
    };

    const read = runGit(() => task(20));
    const write = await tryRunGit(() => task(5));

    expect(write).toBe("done");
    expect(await read).toBe("done");
    expect(overlaps(spans)).toBe(false);
  });
});

describe("the queue is one queue, not one per bundle copy", () => {
  /**
   * The production defect, reproduced honestly.
   *
   * Turbopack emits this module into one chunk per entry group — the instrumentation entry that
   * owns the pull loop gets its own, the API routes get theirs — so the process holds several
   * module instances, and before the fix each held an independent lock. Copying the source to a
   * second path and importing it gives a second instance the same way a second chunk does. Both
   * copies must reach the same queue, or they run git simultaneously.
   */
  test("a second instance of this module serializes against the first", async () => {
    const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "engram-queue-")), "git-queue.ts");
    fs.copyFileSync(path.join(HERE, "git-queue.ts"), copy);
    const second = (await import(copy)) as typeof import("./git-queue");

    // A different module instance, not the same object handed back by the loader.
    expect(second.runGit).not.toBe(runGit);

    const spans: Array<[number, number]> = [];
    const task = async (ms: number) => {
      const start = performance.now();
      await sleep(ms);
      spans.push([start, performance.now()]);
    };

    await Promise.all([runGit(() => task(20)), second.runGit(() => task(20))]);
    expect(spans.length).toBe(2);
    expect(overlaps(spans)).toBe(false);

    // A writer in one copy makes a writer in the other skip — the guarantee the production bug
    // broke. And the sentinel survives the boundary: a `Symbol()` per copy would not compare
    // equal, which is what made every completed sync look like a skipped one.
    const held = tryRunGit(() => sleep(20));
    expect(await second.tryRunGit(async () => "should not run")).toBe(SKIPPED);
    await held;

    fs.rmSync(path.dirname(copy), { recursive: true, force: true });
  });
});

describe("running out of processes stops git instead of retrying into a crash", () => {
  const exhausted = () =>
    runGit(async () => {
      throw new Error("unable to access 'https://github.com/x/y/': getaddrinfo() thread failed to start");
    });

  test("three consecutive fork/thread failures pause git; a success clears it", async () => {
    expect(gitPausedFor()).toBe(0);

    for (let i = 0; i < 3; i++) await expect(exhausted()).rejects.toThrow(/thread failed to start/);

    // The breaker is open: git is not spawned at all, so the retry cannot cost a fork we don't have.
    expect(gitPausedFor()).toBeGreaterThan(0);
    let spawned = false;
    await expect(
      runGit(async () => {
        spawned = true;
      }),
    ).rejects.toBeInstanceOf(GitUnavailableError);
    expect(spawned).toBe(false);
    // Periodic work backs off quietly rather than throwing into the pull loop.
    expect(await tryRunGit(async () => "nope")).toBe(SKIPPED);

    // Reopening is time-based; reach in rather than sleep five minutes for it.
    const s = (globalThis as Record<symbol, { openUntil: number; exhaustions: number }>)[
      Symbol.for("engram.git.queue")
    ];
    s.openUntil = Date.now() - 1;

    expect(await runGit(async () => "back")).toBe("back");
    expect(gitPausedFor()).toBe(0);
    expect(s.exhaustions).toBe(0);
  });

  test("an ordinary git failure never trips it — only the host running out does", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(runGit(async () => Promise.reject(new Error("CONFLICT (content): merge conflict")))).rejects.toThrow(
        /CONFLICT/,
      );
    }
    expect(gitPausedFor()).toBe(0);
  });
});

describe("polled reads collapse onto one git process", () => {
  test("callers within the TTL share one result, and an invalidation forces a fresh one", async () => {
    invalidateGitReads();
    let spawns = 0;
    const read = () =>
      gitRead("test:key", 10_000, async () => {
        spawns++;
        return spawns;
      });

    // Concurrent callers — the shape of several dashboard tabs polling /api/sync at once.
    expect(await Promise.all([read(), read(), read()])).toEqual([1, 1, 1]);
    expect(spawns).toBe(1);

    // Sequential callers inside the TTL, the shape of one tab polling every 10s.
    expect(await read()).toBe(1);
    expect(spawns).toBe(1);

    // A sync we ran ourselves changed the answer, so the next read must not be the stale one.
    invalidateGitReads();
    expect(await read()).toBe(2);
    expect(spawns).toBe(2);
  });

  test("a failed read is not cached as the answer", async () => {
    invalidateGitReads();
    let attempts = 0;
    const read = () =>
      gitRead("test:flaky", 10_000, async () => {
        attempts++;
        if (attempts === 1) throw new Error("git status failed");
        return "fine";
      });

    await expect(read()).rejects.toThrow("git status failed");
    expect(await read()).toBe("fine");
  });
});
