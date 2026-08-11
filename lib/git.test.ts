import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";

/**
 * The vault-sync durability tests.
 *
 * Two defects shipped inside the 2026-07-15 "serialize git-sync" fix, both of which the vault's
 * own history shows running in production:
 *
 *   1. `withGitLock` returned `undefined` for "the lock was held", but its callback was typed
 *      `Promise<void>` and so also resolved to `undefined`. Every successful sync looked like a
 *      skip, so `runSync` re-queued its reasons and rescheduled itself forever — `pending` never
 *      drained. Commit subjects on 2026-08-06 read `1 change(s)` → `2` → `3` → `4` → `5`, each
 *      repeating every earlier reason, and a git subprocess pair ran every 2.5s indefinitely.
 *
 *   2. Both pull paths used `git pull --rebase --autostash`. Autostash reverts the working tree
 *      to HEAD for the duration of the rebase and restores it after — and when the restore fails
 *      git says so on STDOUT and still exits 0. The notes end up reverted with their content in a
 *      stash nobody reads. Untracked files (a brand-new note) are never stashed, which is why
 *      creating a note survived what modifying one did not.
 */

const LAB = path.join(process.env.ENGRAM_DATA_DIR!, "gitlab");
const REMOTE = path.join(LAB, "remote.git");
const REPO_ID = "sync-test";
const VAULT = path.join(process.env.ENGRAM_DATA_DIR!, "vaults", REPO_ID);
const SEED = path.join(LAB, "seed");
const NOTE = "clients/kolumbi/delivery.md";

const V0 = `---
title: Delivery
updated: '2026-07-14'
---

# Delivery

## Log

- **2026-07-20** — Phase 3 content build completed.
`;

const vaultGit = () => simpleGit(VAULT);
const onDisk = () => fs.readFileSync(path.join(VAULT, NOTE), "utf8");

/**
 * Every branch name here is pinned explicitly.
 *
 * The fixture used to let the working branch come from the host's `init.defaultBranch` while
 * pushing to `refs/heads/main`. On a machine defaulting to `main` that is silently consistent; on
 * one defaulting to `master` — a GitHub runner — the seed clone sits on `master` tracking
 * `origin/main`, and `git push` under the default `push.default=simple` refuses:
 * "The upstream branch of your current branch does not match the name of your current branch."
 * Three tests failed on CI and passed locally for that reason alone. A test fixture must not
 * inherit the thing it is testing around.
 */
const BRANCH = "main";

async function seedRemoteAndClone() {
  fs.rmSync(LAB, { recursive: true, force: true });
  fs.rmSync(VAULT, { recursive: true, force: true });
  fs.mkdirSync(LAB, { recursive: true });

  await simpleGit().raw(["init", "--bare", "-b", BRANCH, REMOTE]);
  await simpleGit().clone(REMOTE, SEED);
  const seed = simpleGit(SEED);
  await seed.addConfig("user.email", "seed@test");
  await seed.addConfig("user.name", "Seed");
  // Works on an unborn branch, unlike `checkout -B`, so it can run before the first commit.
  await seed.raw(["symbolic-ref", "HEAD", `refs/heads/${BRANCH}`]);
  fs.mkdirSync(path.join(SEED, path.dirname(NOTE)), { recursive: true });
  fs.writeFileSync(path.join(SEED, NOTE), V0);
  await seed.add(["-A"]);
  await seed.commit("init");
  await seed.push(["origin", `HEAD:refs/heads/${BRANCH}`]);
  await seed.raw(["branch", `--set-upstream-to=origin/${BRANCH}`, BRANCH]);

  await simpleGit().clone(REMOTE, VAULT);
  const v = vaultGit();
  await v.addConfig("user.email", "engram@test");
  await v.addConfig("user.name", "Engram");
  await v.raw(["checkout", "-B", BRANCH, `origin/${BRANCH}`]);
  await v.raw(["branch", `--set-upstream-to=origin/${BRANCH}`, BRANCH]);

  // Fail loudly here rather than as three puzzling assertion failures further down. The vault's
  // push goes through production code with no refspec, so its branch and upstream must line up.
  const st = await v.status();
  if (st.current !== BRANCH || st.tracking !== `origin/${BRANCH}`) {
    throw new Error(`fixture: vault is on ${st.current} tracking ${st.tracking}, expected ${BRANCH}/origin/${BRANCH}`);
  }

  fs.writeFileSync(
    path.join(process.env.ENGRAM_DATA_DIR!, "repos.json"),
    JSON.stringify([
      { id: REPO_ID, name: "vault", url: REMOTE, branch: BRANCH, active: true, addedAt: "2026-01-01T00:00:00.000Z" },
    ]),
  );
}

/** A second writer pushing to the same remote — the shape that made autostash lose data. */
async function secondWriterPushes(line: string) {
  const seed = simpleGit(SEED);
  await seed.raw(["pull", "--rebase", "origin", BRANCH]);
  fs.appendFileSync(path.join(SEED, NOTE), `${line}\n`);
  await seed.add(["-A"]);
  await seed.commit("second writer");
  // Explicit refspec: never depends on push.default or on the local branch name matching.
  await seed.push(["origin", `HEAD:refs/heads/${BRANCH}`]);
}

let appendNote: typeof import("./vault/write").appendNote;
let pullActive: typeof import("./git").pullActive;
let syncNow: typeof import("./git").syncNow;
let pendingReasons: typeof import("./git").pendingReasons;
let requestSync: typeof import("./git").requestSync;
let syncStatus: typeof import("./git").syncStatus;
let rebuildIndex: typeof import("./vault/store").rebuildIndex;

beforeAll(async () => {
  await seedRemoteAndClone();
  // test/setup.ts pins GIT_SYNC_ENABLED=false for every other suite; this one needs it on.
  const settings = await import("./settings");
  settings.updateSettings({ gitSyncEnabled: true, gitAuthorName: "Engram", gitAuthorEmail: "engram@test" });
  ({ pullActive, syncNow, pendingReasons, requestSync, syncStatus } = await import("./git"));
  ({ appendNote } = await import("./vault/write"));
  ({ rebuildIndex } = await import("./vault/store"));
});

afterAll(async () => {
  const settings = await import("./settings");
  settings.updateSettings({ gitSyncEnabled: false });
  fs.rmSync(path.join(process.env.ENGRAM_DATA_DIR!, "repos.json"), { force: true });
});

describe("the sync queue drains", () => {
  test("a completed sync does not re-queue its reasons", async () => {
    requestSync("Agent Yang: append delivery.md");
    expect(pendingReasons().length).toBe(1);

    fs.appendFileSync(path.join(VAULT, NOTE), "- **2026-08-06** — first entry.\n");
    const out = await syncNow();

    expect(out?.committed).toBe(true);
    // The bug: `pending` still held the reason, so the next commit repeated it.
    expect(pendingReasons()).toEqual([]);
  });

  test("consecutive syncs do not accumulate each other's reasons in the commit subject", async () => {
    const subjects: string[] = [];
    for (const entry of ["second", "third", "fourth"]) {
      fs.appendFileSync(path.join(VAULT, NOTE), `- **2026-08-06** — ${entry} entry.\n`);
      requestSync(`Agent Yang: append ${entry}`);
      await syncNow();
      subjects.push((await vaultGit().log({ maxCount: 1 })).latest!.message);
    }
    // Production showed "1 change(s)" → "2" → "3": every subject restating all earlier reasons.
    for (const s of subjects) expect(s).toContain("brain: 1 change(s)");
    expect(subjects[2]).toContain("fourth");
    expect(subjects[2]).not.toContain("second");
  });
});

describe("a pull never rebases over uncommitted vault writes", () => {
  test("an uncommitted append survives a concurrent pull, with a second writer on the same note", async () => {
    await syncNow(); // start from a clean tree
    await secondWriterPushes("- **2026-08-05** — line from the other writer.");

    const entry = "- **2026-08-06** — MARKER Bitwarden collection created.";
    await appendNote(NOTE, entry); // on disk, not yet committed (2.5s debounce)

    const res = await pullActive();

    expect(res.ok).toBe(true);
    // The append must still be on disk, whatever the pull decided to do.
    expect(onDisk()).toContain(entry);
    // …and not smuggled into a stash where nobody would look for it.
    expect((await vaultGit().stashList()).total).toBe(0);
    // …and not left as a conflicted merge for the next writer to trip over.
    expect(onDisk()).not.toContain("<<<<<<<");
  });

  test("a conflicting second writer never corrupts the note or strands the repo mid-rebase", async () => {
    const entry = "- **2026-08-06** — MARKER Bitwarden collection created.";
    const out = await syncNow();

    // Both writers appended to the end of the same note, so the rebase conflicts. What matters is
    // that our content survives, the note is clean, and the repo is left usable.
    expect(out?.committed).toBe(true);
    const body = onDisk();
    expect(body).toContain(entry); // ours, still here
    expect(body).toContain("Phase 3 content build completed."); // and the original
    expect(body).not.toContain("<<<<<<<"); // never conflict markers on disk
    expect(body).not.toContain(">>>>>>>");

    // Not stranded: on a branch, no rebase in flight, nothing hidden in a stash.
    const status = await vaultGit().status();
    expect(status.current).toBe(BRANCH);
    expect(status.conflicted).toEqual([]);
    expect((await vaultGit().stashList()).total).toBe(0);

    // And the divergence is reported rather than swallowed.
    expect(out?.conflicted).toBe(true);
    expect(out?.error).toMatch(/diverged/);
    const s = (await syncStatus()) as { lastError?: string };
    expect(s.lastError).toMatch(/diverged/);
  });

  test("no conflict markers are ever committed to the vault", async () => {
    const log = await vaultGit().raw(["log", "-p", "--all", "-S", "<<<<<<<", "--", NOTE]);
    expect(log.trim()).toBe("");
  });

  test("a non-conflicting second writer merges cleanly and both sides land", async () => {
    // Reset to a shared base, then have the other writer touch a DIFFERENT note — the ordinary
    // case, which must rebase through without deferring, conflicting, or losing either side.
    const g = vaultGit();
    await g.raw(["fetch", "origin"]);
    await g.raw(["reset", "--hard", `origin/${BRANCH}`]);
    rebuildIndex();

    const seed = simpleGit(SEED);
    await seed.raw(["pull", "--rebase", "origin", BRANCH]);
    fs.writeFileSync(path.join(SEED, "clients/kolumbi/access.md"), "---\ntitle: Access\n---\n\n- their note\n");
    await seed.add(["-A"]);
    await seed.commit("second writer, different file");
    await seed.push(["origin", `HEAD:refs/heads/${BRANCH}`]);

    const ours = "- **2026-08-06** — ours, on a different line.";
    await appendNote(NOTE, ours);
    const out = await syncNow();

    expect(out?.conflicted).toBeFalsy();
    expect(out?.pushed).toBe(true);
    expect(onDisk()).toContain(ours);
    expect(fs.readFileSync(path.join(VAULT, "clients/kolumbi/access.md"), "utf8")).toContain("their note");
  });

  test("repeated append-then-pull cycles lose nothing", async () => {
    for (let i = 0; i < 5; i++) {
      const entry = `- **2026-08-06** — cycle-${i} entry.`;
      await appendNote(NOTE, entry);
      await pullActive();
      expect(onDisk()).toContain(entry);
      await syncNow();
      expect(onDisk()).toContain(entry);
    }
    const body = onDisk();
    for (let i = 0; i < 5; i++) expect(body).toContain(`cycle-${i} entry.`);
    expect((await vaultGit().stashList()).total).toBe(0);
  });
});

describe("one writer, across every copy of this module", () => {
  /**
   * Next.js compiles lib/git.ts into three server chunks — the instrumentation entry that owns the
   * pull loop, the shared API-route chunk, and /api/folders. Module-level `let pending` / `let
   * timer` therefore gave each of them its own debounce queue, so a note write and a folder write
   * in the same 2.5s window each started their own commit → pull → push against one clone. Two
   * concurrent `git pull --rebase` on one repo is what produced "Cannot rebase onto multiple
   * branches." in the Railway log (reproduced 40/40; see lib/git-queue.test.ts). Holding the state
   * on globalThis is what makes the three copies one writer.
   */
  test("the debounce queue is shared process state, not module state", async () => {
    requestSync("Agent Yang: append delivery.md");
    const shared = (globalThis as Record<symbol, { pending: string[] } | undefined>)[Symbol.for("engram.git.sync")];
    expect(shared?.pending).toContain("Agent Yang: append delivery.md");
    expect(pendingReasons()).toEqual(shared!.pending);
    await syncNow(); // drain, so the 2.5s timer can't fire into a later test
    expect(pendingReasons()).toEqual([]);
  });

  test("overlapping pulls and syncs never race into 'Cannot rebase onto multiple branches'", async () => {
    fs.appendFileSync(path.join(VAULT, NOTE), "- **2026-08-07** — concurrent-callers entry.\n");
    const results = await Promise.all([pullActive(), syncNow(), pullActive(), syncNow(), pullActive()]);

    for (const r of results) {
      expect(r?.error ?? "").not.toMatch(/multiple branches/);
    }
    // Whoever won the queue, the write is committed and the repo is left on its branch, not
    // half-rebased. The losers skipped rather than piling a second git process onto the first.
    expect(onDisk()).toContain("concurrent-callers entry.");
    const status = await vaultGit().status();
    expect(status.current).toBe(BRANCH);
    expect(status.conflicted).toEqual([]);
  });
});

describe("sync failures are reportable, not just console noise", () => {
  test("syncStatus surfaces a stranded stash so old autostash losses can be recovered", async () => {
    await syncNow();
    // Simulate what the old --autostash pull left behind: vault content parked in a stash.
    fs.appendFileSync(path.join(VAULT, NOTE), "- stranded content\n");
    await vaultGit().stash(["push", "-m", "autostash"]);

    const s = (await syncStatus()) as { enabled: boolean; stashed?: number };
    expect(s.enabled).toBe(true);
    expect(s.stashed).toBe(1);

    await vaultGit().stash(["drop"]);
  });
});
