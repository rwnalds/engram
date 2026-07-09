<p align="center">
  <img src="assets/logo.png" alt="Engram logo" width="120" height="120" />
</p>

<h1 align="center">Engram</h1>

<p align="center"><b>The second brain your AI agents read and write.</b></p>

<p align="center">
  <video src="https://github.com/rwnalds/engram/raw/main/assets/demo.mp4" controls width="820"></video>
</p>

<p align="center"><sub><a href="https://github.com/rwnalds/engram/raw/main/assets/demo.mp4">▶ Watch the demo</a> if the video doesn't play inline.</sub></p>

---

Engram is a self-hosted **MCP server + dashboard** that gives Claude Code, Cursor, Hermes, and any
[Model Context Protocol](https://modelcontextprotocol.io) agent **shared, long-term memory** — over a
plain, **git-backed folder of markdown**. No database:
your notes are the source of truth, an in-memory index powers full-text search and a wikilink
**knowledge graph**, and git is the durable store.

Think **Obsidian, but agent-native** — or **markdown RAG without a vector database**. Point it at any
vault of `.md` files (or the bundled `sample-vault/`) and every agent on your team can search, read,
and write the same knowledge. Humans edit it in a fast dashboard; agents edit it over one MCP endpoint.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/engram?referralCode=PEidIe&utm_medium=integration&utm_source=template&utm_campaign=generic)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/rwnalds/engram)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](./LICENSE)

> **Why it exists:** autonomous AI agents forget everything between sessions. Engram is the
> **persistent memory layer** — one knowledge base that humans and agents share, versioned in git,
> so your Claude Code / Hermes / Cursor agents remember decisions, context, and everything they learn.

---

## What it's for

- **Long-term memory for Claude Code** and other coding agents — stop re-explaining your project every session.
- **Shared memory for a fleet of AI agents** — one vault, many agents reading and writing concurrently.
- **A team knowledge base agents can actually write to** — meeting notes, decisions, client context, SOPs.
- **A self-hosted, Obsidian-compatible second brain** exposed over MCP — your notes, your server, your git repo.
- **Markdown RAG without the vector database** — full-text search + a link graph over human-readable files.

## Features

- **MCP server** — 13 `brain_*` tools over one bearer-authenticated HTTP endpoint (`POST /api/mcp`,
  streamable HTTP JSON-RPC). Connect any MCP client to a single URL.
- **Human dashboard** — file tree, note viewer with **Obsidian callouts, wikilinks, and backlinks**,
  Preview / Edit / Split editor with autosave, ⌘K command-palette search, and a **force-directed
  knowledge graph**.
- **Markdown-native** — plain `.md` + YAML frontmatter + `[[wikilinks]]`. Drop in an existing
  **Obsidian vault** and it just works.
- **Git-backed** — optional auto commit + push of every change. Full history, no lock-in, your data
  lives in **your** repo.
- **No database** — files are the source of truth; an in-memory MiniSearch index + a ported wikilink
  graph power search and backlinks. Nothing to provision.
- **Multi-workspace** — connect multiple vault repos and switch the active one from the UI.
- **Self-hosted** — one Docker container. Railway / Render / Fly / any host with a volume.
  **Not** serverless (it needs a persistent volume, a file watcher, and a long-running index).
- **Team auth** — Google SSO + email allowlist for the dashboard; per-agent bearer tokens for MCP
  (create/revoke in the UI). Secrets encrypted at rest.
- **Optional AI auto-filing** (`brain_capture`) — dump a rough note and it gets filed into the right
  place, with the right frontmatter, automatically.
- **Runtime Settings page** — flip git-sync, capture, and OAuth on/off without a redeploy.

## Works with

**Claude Code · Claude Desktop · Cursor · Cline · Windsurf · Hermes · any MCP client.**
One endpoint, bearer-token auth — if it speaks the Model Context Protocol, it can use Engram as memory.

## Quick start

```bash
bun install
bun dev            # http://localhost:3000 — runs against ./sample-vault
```

Point it at your own vault:

```bash
VAULT_DIR=/path/to/your/obsidian-or-markdown/vault bun dev
```

## MCP tools

Agents only ever see the active vault — no repo, workspace, or GitHub tools are exposed.

| | Tools |
|---|---|
| **Read** | `brain_search` · `brain_read` · `brain_list` · `brain_tree` · `brain_backlinks` · `brain_graph` · `brain_schema` |
| **Write** | `brain_write` · `brain_edit` · `brain_append` · `brain_move` · `brain_create_folder` · `brain_delete` |

Connect an agent (the dashboard → **Connect** page shows the exact command + token):

```bash
claude mcp add --transport http engram https://<host>/api/mcp \
  --header "Authorization: Bearer <token>"
```

## Deploy

Runs anywhere you can run a Docker container with a persistent volume — Railway, Render, Fly, or your
own box. **Serverless (Vercel) won't work**: Engram holds a volume, a file watcher, and an in-memory
index that a serverless function can't keep alive.

1. Deploy this repo (root `Dockerfile`), mount a volume at `/data`, set `ENGRAM_DATA_DIR=/data`.
2. Connect your vault repo(s) **in the dashboard** (Workspaces) — by URL + token, or GitHub OAuth.
3. Sign in with Google, create MCP tokens on the **Connect** page, point your agents at the URL.

Most runtime config (git-sync, AI capture, GitHub OAuth, app name) is editable in the **Settings**
page — only auth/infra bootstrap vars live on the host. Full setup: **[DEPLOY.md](./DEPLOY.md)**.

- **Railway:** New Project → *Deploy from GitHub repo* → add a Volume at `/data`.
- **Render:** one-click via the bundled `render.yaml` (Docker + a `/data` disk).

## FAQ

**How do I give Claude Code long-term memory?**
Deploy Engram, connect a markdown vault, and `claude mcp add` the endpoint. The `brain_*` tools let
Claude Code search, read, and write persistent notes across sessions.

**Can multiple AI agents share one knowledge base?**
Yes. Every agent points at the same MCP URL and reads/writes the same active vault — that's the point.
Give each agent its own bearer token.

**Does it work with my Obsidian vault?**
Yes. It reads plain markdown with frontmatter and `[[wikilinks]]`, and renders Obsidian-style callouts
and backlinks. No import step.

**Do I need a vector database?**
No. Engram uses full-text search (MiniSearch) plus a wikilink graph over human-readable markdown —
no embeddings service, no vector store to run.

**Is my data locked in?**
No. It's just `.md` files in a git repo you own. Turn Engram off and you still have every note and its
full history.

**Where does it run / is it self-hosted?**
You host it. One Docker container on Railway / Render / Fly / any VM with a volume. Your keys, your data.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/base-ui · bun · MiniSearch ·
d3-force · MCP SDK. **MIT licensed.**

---

<sub>**Keywords:** MCP server · Model Context Protocol · second brain for AI agents · agent memory ·
long-term memory for Claude Code · shared memory for AI agents · self-hosted knowledge base ·
Obsidian-compatible · markdown · knowledge graph · wikilinks · PKM · Zettelkasten · git-backed notes ·
Hermes agent memory · Cursor memory · RAG without a vector database.</sub>
