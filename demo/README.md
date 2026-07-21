# Engram — public playground

The open, resettable demo behind [the "try it live" link](https://github.com/rwnalds/engram).
No login, no signup: anyone can read, write, supersede, delete, break it. It heals on a timer.

It exists so you can watch the one thing Engram does differently without cloning anything: search
the seeded vault for **retainer price** and see the live 2026 note come back while the retired 2025
one is withheld with a reason.

## How it works

- **[`Dockerfile`](./Dockerfile)** wraps the published `ghcr.io/rwnalds/engram-app` image — the same
  binary you'd deploy — and swaps in a supervisor entrypoint. Pinned to a released tag so the demo
  can never run code older than its security fixes. **Must be ≥ 0.1.2.**
- **[`seed.sh`](./seed.sh)** writes a fictional 18-note vault with a small fabricated git history, so
  the Activity page shows real per-agent commits (`claude-code`, `cursor-agent`, a read-write
  teammate). Deterministic — every reset produces the identical vault.
- **[`entrypoint.sh`](./entrypoint.sh)** seeds the vault, starts the app, and on an interval (or on
  exit) tears it down and re-seeds. Because there is **no persistent volume**, a restart resets
  everything too.

It runs `AUTH_DISABLED=true` with git sync off. Nothing it does touches a real vault or pushes
anywhere.

## Deploy (Railway)

1. New service from this repo.
2. **Settings → Build**: Dockerfile path `demo/Dockerfile`, root directory the repo root (the build
   needs `demo/` in context).
3. **Do not add a volume.** Ephemeral is the point.
4. Variables — all optional:

   | Variable | Default | Notes |
   |---|---|---|
   | `RESET_INTERVAL_SECONDS` | `21600` (6h) | Lower it on a high-traffic day so graffiti doesn't linger. |
   | `PORT` | `3000` | Railway sets this; the app honours it. |

5. Deploy, open the URL, confirm `/api/health` returns 200.

## When a new version ships

Bump the `FROM` tag in `demo/Dockerfile` to the new release and redeploy. The demo does not
auto-follow `latest` on purpose — a demo pinned to a known-good tag can't be broken by a bad push.

## What's deliberately allowed

This is a playground, so the open behaviours are intended, not oversights:

- **Anyone can write or delete any note.** The reset heals it.
- **Anyone can create MCP tokens** on the Connect page. Ephemeral; wiped on reset.
- **Anyone can connect a vault repo** in Workspaces. It clones into throwaway state and is wiped on
  reset; it does not touch the seeded demo vault permanently.

What is **not** allowed — and is enforced by the app, not by this wrapper — is reading files outside
the vault or landing script in another visitor's browser. Both were fixed in 0.1.2, which is why the
base tag floor is 0.1.2.
