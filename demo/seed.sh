#!/usr/bin/env bash
#
# Seed the public playground vault: 18 markdown notes and a small, fabricated git history so the
# Activity page has something to show. Deterministic — every reset produces the identical vault,
# including commit dates, so the demo always looks the same no matter when you hit it.
#
# The content is a fictional company. Nothing here is real. The one thing it demonstrates for real
# is the price story: docs/pricing-2025.md is superseded by docs/pricing-2026.md, so a search for
# "retainer price" returns the live note and withholds the dead one with a reason.
#
# Usage: seed.sh <vault-dir>
set -euo pipefail

VAULT="${1:?usage: seed.sh <vault-dir>}"
rm -rf "$VAULT"
mkdir -p "$VAULT"/{clients/northwind,clients/vertex,decisions,projects,people,docs,archive}

w() { mkdir -p "$(dirname "$VAULT/$1")"; cat > "$VAULT/$1"; }

w docs/pricing-2026.md <<'EOF'
---
title: Pricing (2026)
type: doc
tags: [pricing, commercial]
status: locked
created: 2026-01-08
valid_until: 2026-12-31
supersedes: "[[pricing-2025]]"
---
# Pricing (2026)

The standard retainer is **EUR 2,500 per month**, billed monthly.

| Tier | Monthly | Includes |
|---|---|---|
| Standard | EUR 2,500 | Core workspace, support, quarterly review |
| Plus | EUR 4,000 | Everything in Standard + dedicated integration work |

Supersedes [[pricing-2025]] — repriced for the 2026 renewal cycle.

> Try it: search this vault for **retainer price**. This note comes back as `authoritative`;
> the 2025 note is withheld with the reason "superseded by pricing-2026".
EOF

w docs/pricing-2025.md <<'EOF'
---
title: Pricing (2025 pilot)
type: doc
tags: [pricing, commercial]
status: superseded
superseded_by: "[[pricing-2026]]"
superseded_at: 2026-01-08
superseded_reason: repriced for the 2026 renewal
created: 2025-02-11
---
# Pricing (2025 pilot)

> [!warning] Retired — kept for history
> Replaced by [[pricing-2026]]. Search withholds this note.

The standard retainer is **EUR 2,000 per month**, billed quarterly in advance. This price covers
the full pilot engagement. Pricing questions about the retainer price should reference this note.
The price was held flat for the pilot.
EOF

w docs/support-sla.md <<'EOF'
---
title: Support SLA
type: doc
tags: [support, commercial]
status: canonical
created: 2026-02-02
---
# Support SLA

First response within one business day. Sev-1 within four hours.
Escalation path: on-call, then [[maya-okonkwo]].
EOF

w docs/security-posture.md <<'EOF'
---
title: Security posture
type: doc
tags: [security]
status: locked
created: 2026-03-14
---
# Security posture

Secrets encrypted at rest. Per-agent tokens scoped read or write.
Reviewed quarterly. See [[adopt-authority-ranking]].
EOF

w docs/onboarding-runbook.md <<'EOF'
---
title: Client onboarding runbook
type: doc
tags: [process]
status: active
created: 2026-02-20
---
# Client onboarding runbook

1. Kickoff call, scope confirmed in writing
2. Workspace provisioned
3. Integration review at day 14
4. Handover to [[maya-okonkwo]]
EOF

w decisions/adopt-authority-ranking.md <<'EOF'
---
title: Adopt authority-aware ranking
type: decision
tags: [architecture]
status: locked
created: 2026-01-22
---
# Adopt authority-aware ranking

An agent quoted a retired price from [[pricing-2025]]. Search ranked it above the live note
because both use the word "price" equally often.

**Decision:** rank by relevance x authority. Retired notes are withheld from search and reported
with a reason.
EOF

w decisions/move-to-whatsapp-first.md <<'EOF'
---
title: WhatsApp-first client comms
type: decision
tags: [ops]
status: proposed
created: 2026-06-30
---
# WhatsApp-first client comms

> [!note] Proposed, not decided
Draft. Do not quote as settled.
EOF

w decisions/deprecate-legacy-export.md <<'EOF'
---
title: Deprecate the legacy export
type: decision
tags: [product]
status: locked
created: 2026-04-03
---
# Deprecate the legacy export

Legacy CSV export retired in favour of the JSON API. See [[archive/legacy-export]].
EOF

w clients/northwind/northwind.md <<'EOF'
---
title: Northwind Labs
type: client
tags: [client, active]
status: active
created: 2026-01-15
related: ["[[maya-okonkwo]]"]
---
# Northwind Labs

Contract signed 2026-01-15. Contact [[maya-okonkwo]].
Pricing: see [[pricing-2026]].

| Field | Value |
|---|---|
| Plan | Standard |
| Started | 2026-01-15 |
EOF

w clients/northwind/northwind-integration.md <<'EOF'
---
title: Northwind integration notes
type: doc
tags: [client]
status: active
created: 2026-03-02
---
# Northwind integration notes

Webhook endpoint live. Retry policy agreed at 5 attempts.
Blocked on their SSO rollout, revisit after Q3.
EOF

w clients/vertex/vertex.md <<'EOF'
---
title: Vertex Systems
type: client
tags: [client, active]
status: active
created: 2026-02-28
related: ["[[tomas-lindqvist]]"]
---
# Vertex Systems

Contact [[tomas-lindqvist]]. Plus tier. Renewal 2027-02.
EOF

w people/maya-okonkwo.md <<'EOF'
---
title: Maya Okonkwo
type: person
tags: [contact]
status: active
created: 2026-01-15
---
# Maya Okonkwo

Head of Platform at [[northwind]]. Main technical contact.
Prefers async, reviews on Thursdays.
EOF

w people/tomas-lindqvist.md <<'EOF'
---
title: Tomas Lindqvist
type: person
tags: [contact]
status: active
created: 2026-02-28
---
# Tomas Lindqvist

CTO at [[vertex]]. Decision maker on renewals.
EOF

w projects/atlas.md <<'EOF'
---
title: Atlas
type: project
tags: [project]
status: active
created: 2026-02-01
---
# Atlas

Internal search rewrite. Depends on [[adopt-authority-ranking]].
Owner: [[maya-okonkwo]] on the client side.
EOF

w projects/beacon.md <<'EOF'
---
title: Beacon
type: project
tags: [project]
status: draft
created: 2026-06-18
---
# Beacon

Early exploration. Not committed.
EOF

w archive/legacy-export.md <<'EOF'
---
title: Legacy CSV export
type: doc
tags: [product]
created: 2025-08-01
---
# Legacy CSV export

Retired. Replaced by the JSON API. See [[deprecate-legacy-export]].
EOF

w archive/q1-forecast.md <<'EOF'
---
title: Q1 2025 forecast
type: doc
created: 2025-01-05
---
# Q1 2025 forecast

Historical. Numbers superseded by actuals.
EOF

w SCHEMA.md <<'EOF'
---
title: Vault schema
status: locked
---
# Vault schema

Folders: `clients/` `decisions/` `projects/` `people/` `docs/` `archive/`

`status:` drives ranking. `locked`/`canonical` outrank `current`; `draft`/`proposed` are demoted;
`superseded` and anything under `archive/` are withheld from agents.
EOF

# --- fabricated git history: gives the Activity page real per-agent commits to show ---
cd "$VAULT"
git init -q -b main
git config user.name "Engram"
git config user.email "brain@example.com"

commit() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -q -m "$2"; }

git add SCHEMA.md docs/pricing-2025.md people docs/onboarding-runbook.md
commit "2026-01-06T09:12:00" "ronalds: seed the vault"
git add decisions/adopt-authority-ranking.md
commit "2026-01-22T14:03:00" "claude-code: 1 change(s) — write decisions/adopt-authority-ranking.md"
git add docs/pricing-2026.md
commit "2026-01-08T11:55:00" "claude-code: supersede docs/pricing-2025.md -> docs/pricing-2026.md: repriced for the 2026 renewal"
git add clients/northwind/northwind.md docs/support-sla.md
commit "2026-02-02T10:41:00" "claude-code: 2 change(s) — write clients/northwind/northwind.md; write docs/support-sla.md"
git add projects/atlas.md clients/vertex
commit "2026-02-28T16:20:00" "cursor-agent: 2 change(s) — write projects/atlas.md; write clients/vertex/vertex.md"
git add clients/northwind/northwind-integration.md docs/security-posture.md
commit "2026-03-14T09:30:00" "teammate-agent (read-write): 2 change(s) — append clients/northwind/northwind-integration.md; write docs/security-posture.md"
git add decisions/deprecate-legacy-export.md archive
commit "2026-04-03T13:08:00" "claude-code: 3 change(s) — write decisions/deprecate-legacy-export.md; move docs/legacy-export.md -> archive/legacy-export.md"
git add projects/beacon.md decisions/move-to-whatsapp-first.md
commit "2026-06-30T08:44:00" "ronalds: 2 change(s) — write projects/beacon.md; write decisions/move-to-whatsapp-first.md"

echo "[seed] vault ready at $VAULT ($(git rev-list --count HEAD) commits, $(find . -name '*.md' | wc -l | tr -d ' ') notes)"
