# Deploying Engram

Engram deploys as one container (this repo). Vault repos are **connected in the dashboard**
(Workspaces) — no repo lives in this repo, and no laptop keeps a vault copy. The active
workspace is what the dashboard shows and what agents read/write.

## 1. Push this repo to GitHub
Already a git repo — create a remote and push `main`.

## 2. Dashboard login — Google OAuth
1. Google Cloud Console → Credentials → Create OAuth client ID → Web application.
2. Redirect URI: `https://<your-app>.up.railway.app/api/auth/callback`
3. Copy the Client ID + Secret.

## 3. Railway
1. **New Project → Deploy from GitHub repo** → this repo (builds via root `Dockerfile`).
2. **Add a Volume**, mount path `/data`.
3. **Variables** — only these five are required on the host; the rest are optional and
   configurable later in the dashboard **Settings** page (they take effect without a redeploy):

| Variable | Value |
|---|---|
| `ENGRAM_DATA_DIR` | `/data` (app state + vault clones live here) |
| `AUTH_SECRET` | `openssl rand -base64 32`, or Railway "Generate" |
| `APP_URL` | `https://<your-app>.up.railway.app` |
| `ALLOWED_EMAILS` | comma-separated team emails (Google login) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from step 2 |

Deploy, then sign in with Google. These five bootstrap **auth + infra** — they gate login
itself (or say where state lives), so they can't live behind the login and must be env.

**Configure in the dashboard → Settings (or the toggles on the home) instead of env** (all
optional; env value, if set, is just the default): **Git sync** (ON by default — commit +
push the connected vault; author + advanced in Settings) · **Curator** — a three-state control:
`off` (no model calls, the default), `chat` (grounded read-only chat over the vault), `full`
(chat can edit, and `brain_capture` files rough dumps). `chat` and `full` need an Anthropic key,
**and send note content to Anthropic** — worth knowing before you enable them. · **App name** ·
**GitHub** repo-connect OAuth (client id/secret). Secrets entered in Settings are stored encrypted
at rest (keyed off `AUTH_SECRET`).

Note `ARCHIVE_FOLDERS` (default `archive,archives,_archive,trash`): notes in these folders are
demoted in search and excluded from agent results by default — how you retire a note without
deleting it.

## 4. Connect a vault repo (in the dashboard → Workspaces)
Two ways — pick one:

- **URL + token (zero setup):** paste the repo URL + a GitHub token with access. Works with
  no GitHub OAuth app — the simplest path, especially for self-hosting.
- **Connect GitHub (nicer):** if you set the GitHub OAuth app in step 5, click *Connect GitHub*
  and pick a repo from a list.

Add repos, switch the active one, remove — all in the UI. MCP tokens (per teammate/agent) are
created on the **Connect** page, each **`read` or `write`** scope. A read-only token cannot see or
call the write tools — give one to an agent you don't want mutating the vault. Every write is
recorded in the git log with which token or human caused it.

## 5. (Optional) GitHub OAuth app — for the "Connect GitHub" flow
Each deployment uses **its own** GitHub OAuth app (secrets can't be shared, and the callback is
host-specific — so there's no shared central app for self-hosters):
1. GitHub → Settings → Developer settings → **OAuth Apps → New OAuth App**.
2. **Authorization callback URL:** `https://<your-app>.up.railway.app/api/github/callback`
3. Paste the Client ID / Secret into the dashboard **Settings → GitHub** (or set
   `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` in Railway — the Settings value wins).

Skip this entirely if you use the URL + token path in step 4.

## 6. Connect agents to the MCP
Dashboard → **Connect** → copy the command. Agents always hit the same endpoint and only ever
see the **active** vault:
```bash
claude mcp add --transport http engram https://<your-app>.up.railway.app/api/mcp \
  --header "Authorization: Bearer <token from the Connect page>"
```
Claude Code, Cursor, and Cline take that bearer header directly.

### Connect from Claude.ai (custom connector — OAuth)
Claude.ai's web connectors authenticate via **OAuth, not a pasted token**. Engram serves the
OAuth flow automatically **whenever `AUTH_SECRET` is set** (no extra config): Settings →
**Connectors** → **Add custom connector** → URL `https://<your-app>/api/mcp`. Claude registers
itself (Dynamic Client Registration) and sends you through **your Google login + email
allowlist**; approve and you're connected — no open endpoint, no shared secret. Requires a paid
Claude plan (and, on Team/Enterprise, an admin to enable custom connectors).

## Notes
- **No auth locally:** leave `AUTH_SECRET` empty (or `AUTH_DISABLED=true`) and the dashboard is open; the MCP is open until a token exists.
- Git tokens are stored **encrypted** at rest (keyed off `AUTH_SECRET`); token hashes and vault clones live under `ENGRAM_DATA_DIR`, never in a vault repo.
