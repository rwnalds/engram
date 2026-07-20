# Contributing to Engram

Thanks for helping improve Engram. It's an agent-first, markdown-native second brain — a
dashboard for humans and an MCP server for agents over a git-backed vault. Keep changes small,
verified, and in the grain of the existing code.

## Getting started

```bash
bun install
bun dev            # http://localhost:3000, runs against ./sample-vault
bun run build      # production build (also type-checks)
bun run lint       # eslint
```

Point it at your own vault: `VAULT_DIR=/path/to/vault bun dev`.

## Stack & conventions

- **Next.js 16 (App Router, Turbopack), React 19, TypeScript (strict), Tailwind v4, shadcn/base-ui, bun.**
- Tailwind v4 has **no config file** — the theme lives in `app/globals.css` (`@theme inline`).
- base-ui primitives have **no `asChild`**.
- Next 16 route handlers: `params` is a **Promise** (`const { path } = await params`).
- **Files are the source of truth** — there is no database. The vault is markdown; app state
  (tokens, workspaces, settings) lives under `ENGRAM_DATA_DIR`, never inside a vault.
- The MCP layer exposes **only** vault tools — never repo/workspace/GitHub internals.
- Match the surrounding code's naming, comment density, and idiom.

## Before you open a PR

1. `bun run lint` and `bun run build` both pass (CI runs these on every PR).
2. **Verify in the running app**, not just in theory — drive the actual flow you changed.
3. Update docs (`README.md`, `DEPLOY.md`, `.env.example`) if you changed behavior or config.
4. Never commit secrets, tokens, or real vault content. `.engram-data` is gitignored.

## Scope

Bug fixes and focused improvements are welcome as PRs directly. For larger features or anything
that changes the data model, the MCP tool surface, or auth, please **open an issue first** so we
can align on the approach before you build.

MIT licensed — by contributing you agree your work is released under the same license.
