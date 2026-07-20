# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub's [private vulnerability reporting](https://github.com/rwnalds/engram/security/advisories/new)
(Security → Report a vulnerability). That opens a private thread with the maintainers.

Please include what you can: what you found, how to reproduce it, and what an attacker gets out
of it. A rough report sent early beats a polished one sent late.

You can expect an initial response within **72 hours**, and an assessment within **7 days**. If a
fix is warranted you'll be credited in the release notes unless you'd rather not be.

## Supported versions

Engram is pre-1.0 and moves fast. Only the **latest release** and `main` receive fixes. If you're
self-hosting an older image, upgrading is the fix.

## What this project handles

Engram is self-hosted and holds credentials, so it's worth being specific about the surface:

- **Dashboard auth** — Google OAuth, with a session cookie signed by `AUTH_SECRET`, gated on an
  email allowlist (`ALLOWED_EMAILS`) or GitHub login allowlist (`ALLOWED_GITHUB_LOGINS`).
- **MCP auth** — per-agent bearer tokens, stored as SHA-256 hashes and shown in plaintext once.
  Each carries a `read` or `write` scope; a read-only token never sees the write tools.
- **OAuth 2.0 server** — Dynamic Client Registration + PKCE, so Claude.ai can connect as a custom
  connector. Served whenever `AUTH_SECRET` is set.
- **GitHub tokens** — used to clone and push vault repos. Encrypted at rest, keyed off `AUTH_SECRET`.
- **Vault content** — your notes. When the Curator is enabled, note content is sent to the
  Anthropic API. It is off by default.

### Things that are intended behaviour, not vulnerabilities

- **An instance with no `AUTH_SECRET` and no tokens is open.** That's local dev mode, and the
  README and DEPLOY.md both say so. Deploying it to a public URL that way is a misconfiguration.
- **`AUTH_DISABLED=true` disables dashboard auth.** Documented, and labelled never-in-production.
- **A `write`-scoped token can write anywhere in the vault.** Scopes are read/write, not
  per-folder. If you need narrower isolation, run a separate instance against a separate vault.
- **`brain_delete` deletes a note.** It's recoverable from git history, and the tool description
  steers toward archiving instead.

## Hardening a deployment

- Set `AUTH_SECRET` to a real random value (`openssl rand -base64 32`).
- Set `ALLOWED_EMAILS` (or `ALLOWED_GITHUB_LOGINS`) — an empty allowlist is not a filter.
- Give every agent its own token, scoped `read` unless it genuinely needs to write, and revoke
  tokens you no longer recognise on the Connect page.
- Keep `ENGRAM_DATA_DIR` on a volume you control; it holds token hashes and encrypted git tokens.
- Leave the Curator off unless you intend note content to reach the Anthropic API.
