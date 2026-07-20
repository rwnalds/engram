---
title: Acme Pricing (2026)
type: doc
tags: [client, pricing]
status: locked
created: 2026-01-10
valid_until: 2026-12-31
supersedes: "[[acme-pricing]]"
related:
  - "[[acme]]"
---

# Acme Pricing (2026)

The Acme retainer price is **EUR 2,500 per month**.

| Field | Value |
|---|---|
| Retainer price | EUR 2,500 / month |
| Billing | Monthly |
| Term | 2026 renewal |

Supersedes [[acme-pricing]] — repriced for the 2026 renewal.

## Try it

This pair is the whole idea of Engram, in two files. Search the vault for **`acme price`**:

- This note comes back as a hit, marked `authoritative`.
- [[acme-pricing]] is **withheld**, and the agent is handed the reason — `superseded by
  acme-pricing-2026` — so it can say what it skipped instead of quoting EUR 2,000.

Note that the retired note is the *longer* one, and repeats "price" more often. Relevance alone
would rank it first. That's why the retirement has to be written down when it happens, rather
than inferred at read time.

`valid_until: 2026-12-31` is the passive half: after that date this note flags itself stale
without anyone remembering to retire it.
