# Deploying Cortex

Cortex deploys as one container. The **app** repo is this repo; the **vault** is a separate
remote repo the app clones + git-syncs into a volume. No machine keeps a local vault copy.

## 1. Push this repo to GitHub
Already a git repo. Create a remote (private is fine) and push `main`.

## 2. Create the vault repo (if you don't have one)
A separate repo of markdown (e.g. `youruser/second-brain`). Cortex clones it into its volume.
Give it the folders in `SCHEMA.md` (`clients/`, `decisions/`, …).

## 3. Google OAuth (dashboard login)
1. Google Cloud Console → **APIs & Services → Credentials → Create OAuth client ID** → **Web application**.
2. **Authorized redirect URI:** `https://<your-app>.up.railway.app/api/auth/callback`
3. Copy the **Client ID** and **Client secret**.

## 4. Railway
1. **New Project → Deploy from GitHub repo** → this repo. It builds via the root `Dockerfile`.
2. **Add a Volume**, mount path `/data`.
3. **Variables:**

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_APP_NAME` | e.g. `Klyiro Brain` |
| `VAULT_DIR` | `/data` |
| `GIT_REMOTE` | the vault repo URL (`https://github.com/youruser/second-brain.git`) |
| `GIT_TOKEN` | GitHub token with **push** access to the vault repo |
| `GIT_SYNC_ENABLED` | `true` |
| `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` | commit identity |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `APP_URL` | `https://<your-app>.up.railway.app` |
| `ALLOWED_EMAILS` | comma-separated team emails |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from step 3 |
| `MCP_TOKEN` | a long random string (agents send this) |
| `ANTHROPIC_API_KEY` | for `brain_capture` (optional) |

4. Deploy. On first boot the app clones `GIT_REMOTE` into `/data`. The dashboard is gated by
   Google login (allowlist); the MCP is gated by `MCP_TOKEN`.

## 5. Connect agents to the MCP
**Claude Code:**
```bash
claude mcp add --transport http cortex https://<your-app>.up.railway.app/api/mcp \
  --header "Authorization: Bearer $MCP_TOKEN"
```
**Hermes** (`~/.hermes/config.yaml`):
```yaml
mcp_servers:
  cortex:
    url: https://<your-app>.up.railway.app/api/mcp
    headers:
      Authorization: "Bearer <MCP_TOKEN>"
```

## Notes
- **No auth locally:** leave `AUTH_SECRET` empty (or `AUTH_DISABLED=true`) and the dashboard is open.
- **Security:** never expose the MCP without `MCP_TOKEN`. Rotate `GIT_TOKEN` if leaked.
