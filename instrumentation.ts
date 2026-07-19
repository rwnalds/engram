// Runs once when the server starts. Re-clones the active workspace's vault if missing
// (e.g. a fresh volume), pulls the latest from its remote, then starts a periodic pull so
// externally-pushed changes keep flowing in without a redeploy.
//
// The vault sync is deliberately DEFERRED off the startup path. It used to run inline here,
// which meant boot did: load Next.js -> immediately fork a git subprocess. That is the worst
// possible moment: Next is at its peak memory/thread usage, and on a small container the extra
// process tips it over — git dies with "getaddrinfo() thread failed to start" (pthread_create
// EAGAIN) and the runtime aborts (SIGABRT) before anything is served. The healthcheck then never
// passes, so the platform restart-loops forever and the whole service is down because a *background
// sync* failed. Serving the vault must not depend on being able to reach GitHub.
//
// So: return immediately (the server starts and /api/health answers), then do the git work once
// things have settled. A sync failure now degrades freshness instead of killing the process.
//
// Env knobs:
//   ENGRAM_DISABLE_GIT_SYNC=1   — skip vault git entirely. Reads still work from the volume;
//                                 use this to bring the service up when git is the thing breaking.
//   ENGRAM_GIT_BOOT_DELAY_MS    — how long to wait before the first sync (default 20s).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.ENGRAM_DISABLE_GIT_SYNC === "1") {
    console.warn("[boot] ENGRAM_DISABLE_GIT_SYNC=1 — serving the vault from disk, no git sync");
    return;
  }

  const delayMs = Number(process.env.ENGRAM_GIT_BOOT_DELAY_MS ?? 20_000);

  const timer = setTimeout(() => {
    void (async () => {
      try {
        const { ensureActiveCloned } = await import("@/lib/repos");
        const { pullActive, startPullLoop } = await import("@/lib/git");
        await ensureActiveCloned();
        await pullActive().catch(() => {});
        startPullLoop();
      } catch (e) {
        // Never rethrow: a broken sync must not take the server down with it.
        console.error("[boot] deferred vault sync failed — serving from disk anyway", e);
      }
    })();
  }, delayMs);
  timer.unref?.();
}
