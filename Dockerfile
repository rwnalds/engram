# Engram — the app is the repo root. The vault is mounted separately at VAULT_DIR.
FROM oven/bun:1

WORKDIR /app

# git + certs for the vault clone/sync loop.
#
# tini is not optional, and it is the half of the SIGABRT crash loop that lib/git-queue.ts cannot
# reach. `git pull` forks helpers (remote-https, merge-base) that outlive their parent and get
# reparented to PID 1. PID 1 here was `bun run start` — a script runner, not an init: it never
# wait()s, so every pull left ~2 <defunct> git processes behind FOREVER. Measured in production:
# pids.max=1000, 22 zombie `git` with PPid 1, growing +2 every 30s — the pull loop's cadence, and
# 1000 PIDs at 4/min is the 4h10m that separated consecutive crashes.
#
# Serializing git children throttles how fast the budget fills; it does not empty it. Nothing in
# the app can: a zombie is only cleared by its parent calling wait(), and by then that parent is
# PID 1. Once the budget is gone every symptom looks like a network fault — "getaddrinfo() thread
# failed to start" (libcurl can't start a resolver thread), "cannot fork() for merge-base",
# "Authentication failed" (the credential helper can't fork) — and finally bun's own posix_spawn
# returns EAGAIN and the runtime aborts. Memory was never involved: 126 MB against an 8 GB limit.
#
# Node-as-PID-1 would not help either: libuv only waitpid()s children it spawned itself, never
# adopted orphans. An init that reaps is the only fix.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && test -x /usr/bin/tini   # fail the BUILD, not the boot, if the path ever moves

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

EXPOSE 3000

# tini runs as PID 1 and reaps adopted orphans. Keep the server as CMD (not baked into the
# ENTRYPOINT) so a platform-level start command still runs *under* tini rather than replacing it.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "run", "start"]
