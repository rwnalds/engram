# Vault schema & conventions

The contract every agent reads before writing (served via the `brain_schema` MCP tool).
The app is taxonomy-agnostic — it renders whatever folders exist; this documents the defaults.

> `brain_schema` returns this file **plus a live report of your actual vault**: its folders, the
> `status:` values in use, the exact ranking weights, and any integrity warnings. An agent never
> has to guess your conventions — it can read them.

## Folders
`clients/` · `decisions/` · `projects/` · `people/` · `meetings/` · `docs/` · `research/` ·
`inbox/` (unsorted captures) · `archive/` (see below). Slugs are kebab-case. New folders are allowed.

## Frontmatter (YAML, optional)
```yaml
---
title: Human title       # graph node label (falls back to filename)
type: decision           # decision | client | project | person | meeting | doc | research
tags: [alpha, beta]
status: active           # see "Authority" — this drives search ranking
aliases: [win-back, churned]   # synonyms; searched like the title
created: 2026-01-15
related:
  - "[[projects/engram]]"
---
```

## Authority — how search decides what to trust

Search ranks by **keyword relevance**, which knows nothing about truth. A superseded price list
uses the word "price" as often as the live one, so it will happily outrank it. Engram fixes this by
multiplying each hit's score by an **authority** weight derived from the note itself — never from
its text. Every search hit and every `brain_read` returns its `authority`.

| authority | Triggered by | Weight | Meaning |
|---|---|---|---|
| `authoritative` | `status:` or a tag containing `locked`, `canonical`, `source-of-truth` | ×3.5 | Source of truth. Quote this over anything that disagrees. |
| `current` | anything else (**including no status at all**) | ×1 | Live. Fine for context. |
| `provisional` | `draft`, `proposed`, `exploring`, `wip`, `tentative`, `idea` | ×0.55 | Not decided. Never quote as settled. |
| `superseded` | `superseded`, `deprecated`, `obsolete`, `replaced`, `retired`, `dead` | ×0.15 | Explicitly replaced. History only. |
| `archived` | note lives under `archive/` (or `archives/`, `_archive/`, `trash/`) | ×0.08 | History only. **Excluded from agent search by default.** |

Words are matched inside `status:` *and* `tags:`, as whole tokens — so `status: draft-for-approval`
counts as `draft`. A vault that uses none of these conventions ranks purely by relevance, exactly as
it would without them: **the feature is opt-in and degrades to nothing.**

Override the archive folder names with the `ARCHIVE_FOLDERS` env var.

### The rule this exists to enforce
**Compose for context; route for facts.** Reading widely across notes to understand a client or a
history is what the graph is for. But a *single-valued fact* — a price, a guarantee, a legal entity,
a contract term — has exactly one owning note. Don't merge sources, don't take the top hit. Open the
`authoritative` note. **If two notes disagree on such a fact, that is a defect in the vault** — report
it rather than averaging them.

### Retiring a note
When something stops being true, **`brain_move` it into `archive/`** rather than deleting it, and add
a pointer in the replacement saying what superseded what. Archiving removes it from search; deleting
destroys the reasoning trail. An archived note with no superseding pointer is worse than a deleted
one — it still looks like an answer.

Mark a note `status: superseded` when it must stay in place (a decision log, where chronology matters).

## Links
- `[[note]]` / `[[../path/note|Alias]]` — resolve by filename stem.
- `related:` frontmatter arrays are edges too.
- Graph: nodes = notes (colored by folder, sized by degree), edges = the links above.
- Two files sharing a basename is a bug: links resolve to the first. `brain_schema` reports these.

## Callouts
`> [!note]`, `> [!tip]`, `> [!warning]`, `> [!abstract]`, `> [!danger]`, `> [!question]`.
