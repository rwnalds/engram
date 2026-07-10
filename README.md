<p align="center">
  <img src="assets/logo.png" alt="Engram logo" width="120" height="120" />
</p>

<h1 align="center">Engram</h1>

<p align="center"><b>The second brain your AI agents read and write.</b></p>

<p align="center">
  <a href="https://github.com/rwnalds/engram/blob/main/assets/demo.mp4">
    <img src="assets/demo.gif" alt="Engram demo — a home dashboard with recent activity and a Claude Code agent querying the vault" width="820" />
  </a>
</p>

<p align="center"><sub><a href="https://github.com/rwnalds/engram/blob/main/assets/demo.mp4">▶ Watch the full-length video</a> (real-time, full quality)</sub></p>

---

Engram is a self-hosted **MCP server + dashboard** that gives Claude Code, Cursor, Hermes, and any
[Model Context Protocol](https://modelcontextprotocol.io) agent **shared, long-term memory they read
_and write_** — over a plain, **git-backed folder of markdown you own**.

Autonomous agents forget everything between sessions. Engram is the persistent layer that remembers —
decisions, context, and everything your agents learn — in one vault they all share.

Unlike a headless memory store, **you can watch it happen.** A fast dashboard lets you **search your
brain**, see exactly what every agent and teammate changed (with per-file **diffs**), **jump back** into
recent notes, and curate it all — while agents read and write the same vault over one MCP endpoint. No
database: your `.md` files are the source of truth, git is the durable store, and an in-memory index
powers full-text search + a wikilink **knowledge graph**.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/engram?referralCode=PEidIe&utm_medium=integration&utm_source=template&utm_campaign=generic)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/rwnalds/engram)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](./LICENSE)

> **Opinionated about _how_ it stores memory** — git-backed markdown, no database, agents write (not
> just read), self-hosted. **Unopinionated about _what_ you keep in it** — any markdown vault, any folder
> structure, any MCP client. Point it at a fresh repo or your existing **Obsidian vault**: no import
> step, no lock-in.

---

## What it's for

- **Long-term memory for Claude Code** and other coding agents — stop re-explaining your project every session.
- **Shared memory for a fleet of AI agents** — one vault, many agents reading and writing concurrently.
- **A team knowledge base agents can actually write to** — meeting notes, decisions, client context, SOPs.
- **A self-hosted, Obsidian-compatible second brain** exposed over MCP — your notes, your server, your git repo.
- **Memory you can see, not a black box** — a dashboard to search, watch (with diffs), and curate what your agents remember.
- **Markdown RAG without the vector database** — full-text search + a link graph over human-readable files.

## Features

- **MCP server** — 14 `brain_*` tools over one bearer-authenticated HTTP endpoint (`POST /api/mcp`,
  streamable HTTP JSON-RPC). Connect any MCP client to a single URL. **Per-agent token scopes**:
  a read-only token never even sees the write tools.
- **Human dashboard** — a **search-first home**, file tree, note viewer with **Obsidian callouts,
  wikilinks, and backlinks**, Preview / Edit / Split editor with autosave, ⌘K search + **in-page keyboard
  navigation**, "jump back in" recents, and a **force-directed knowledge graph**.
- **Activity feed** — see every change agents and teammates make to your brain, read straight from **git
  history**, with expandable **per-file diffs**. Your vault gets an audit trail for free.
- **The Curator** *(optional)* — a resident **chat agent grounded in your notes**: ask a question and it
  searches + reads the vault to answer, with wikilink citations (Opus / Sonnet / Haiku, your key). Plus
  one-shot auto-filing (`brain_capture`) — drop a rough note and it lands in the right folder with the
  right frontmatter.
- **Markdown-native** — plain `.md` + YAML frontmatter + `[[wikilinks]]`. Drop in an existing
  **Obsidian vault** and it just works.
- **Git-backed** — optional auto commit + push of every change. Full history, no lock-in, your data
  lives in **your** repo.
- **No database** — files are the source of truth; an in-memory MiniSearch index + a ported wikilink
  graph power search and backlinks. Nothing to provision.
- **Multi-workspace** — connect multiple vault repos (URL + token or GitHub OAuth), rename, switch the
  active one, or remove them — all from the UI.
- **Self-hosted** — one Docker container. Railway / Render / Fly / any host with a volume.
  **Not** serverless (it needs a persistent volume, a file watcher, and a long-running index).
- **Team auth** — Google SSO + email allowlist for the dashboard; per-agent bearer tokens — or **OAuth
  for Claude.ai custom connectors** — for MCP, created/revoked in the UI. Secrets encrypted at rest.
- **Runtime config** — toggle git-sync and the Curator right from the home; manage commit author, keys,
  and OAuth in **Settings** — no redeploy.

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
A `read`-scope token sees only the read tools. `brain_capture` appears only when the Curator is `full`.

| | Tools |
|---|---|
| **Read** | `brain_search` · `brain_read` · `brain_list` · `brain_recent` · `brain_tree` · `brain_backlinks` · `brain_graph` · `brain_schema` |
| **Write** (needs a `write`-scope token) | `brain_write` · `brain_edit` · `brain_append` · `brain_move` · `brain_create_folder` · `brain_delete` |

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

**Can I chat with my notes?**
Yes — enable the optional **Curator**, a chat agent that searches and reads your vault to answer with
wikilink citations (Opus / Sonnet / Haiku). It's read-only in chat, so it helps you think without
changing anything, and it runs on your own Anthropic key.

**Can I see what my agents changed?**
Yes — the **Activity** view reads your vault's git history and shows every change (agents and teammates
alike), expandable to per-file diffs. Since it's just git, you get the full audit trail for free.

**Is my data locked in?**
No. It's just `.md` files in a git repo you own. Turn Engram off and you still have every note and its
full history.

**Where does it run / is it self-hosted?**
You host it. One Docker container on Railway / Render / Fly / any VM with a volume. Your keys, your data.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui · bun · MiniSearch ·
d3-force · MCP SDK. **MIT licensed.**

---

<sub>**Keywords:** MCP server · Model Context Protocol · second brain for AI agents · agent memory ·
long-term memory for Claude Code · shared memory for AI agents · self-hosted knowledge base ·
Obsidian-compatible · markdown · knowledge graph · wikilinks · PKM · Zettelkasten · git-backed notes ·
Hermes agent memory · Cursor memory · RAG without a vector database · chat with your markdown notes ·
git-backed agent activity feed · audit trail for AI agents.</sub>
