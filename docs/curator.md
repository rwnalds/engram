# The Curator, and who is allowed to write

Two different questions get confused constantly. Keep them apart:

- **Can an agent change my vault?** → decided by the **token's scope**, on the Connect page.
- **Does Engram itself run a model?** → decided by the **Curator mode**, in Settings.

The Curator has never governed whether agents can write. MCP write tools (`brain_write`,
`brain_edit`, `brain_append`, `brain_move`, `brain_create_folder`, `brain_delete`) are available to
any token with `write` scope, in every Curator mode, including `off`.

---

## Token scopes

| Scope | Sees | Can |
|---|---|---|
| `read` | 8 tools | search, read, list, tree, backlinks, graph, recent, schema |
| `write` | 15 tools | everything above, plus write, edit, append, move, supersede, create-folder, delete (`brain_capture` makes 16 when the Curator is `full`) |

A read-only token never *sees* the write tools in `tools/list`, so the model is never tempted and
never wastes a turn discovering it is forbidden. Calling one anyway returns a clear error.

> Tokens created before scopes existed are grandfathered as `write`.

**If you don't want an agent mutating your vault while you sleep, give it a read-only token.**
That is the lever. Not the Curator.

---

## Curator modes

| | Engram calls a model | Dashboard chat | `brain_capture` | Who decides what gets written |
|---|---|---|---|---|
| **off** (default) | never | hidden | hidden | the calling agent |
| **chat** | when a human asks | read-only | hidden | the calling agent |
| **full** | on questions *and* dumps | can write | exposed | Engram's model, for captures |

### off
A deterministic MCP server and dashboard. **Engram makes zero outbound model calls.** Note content
leaves the box only two ways: a git push to your own remote, and MCP responses to the agents you
chose to connect — which feed their own providers. Engram costs you nothing in tokens.

What you lose is **curation**: nothing notices when a note goes stale. Superseded documents keep
looking authoritative until a human archives them.

### chat
A grounded conversation with the vault, with citations, authority-aware. The model cannot write.

Costs: tokens per question, on your key — and **Engram itself now sends note content to Anthropic.**
If you only ever connected local agents, that is a new egress path. Say so out loud before enabling.

### full
Chat gains write tools, and `brain_capture` appears over MCP: an agent hands Engram a rough dump and
the loop files it, returning a manifest of every path it touched.

Costs: a bounded multi-turn loop per dump instead of one call, and **any token holder can trigger it
on your key**. Filing is non-deterministic — the same dump twice may produce two notes rather than
one update. And the decision about what to mutate moves from the caller into Engram, where it is
harder to review. That is why the manifest and the git provenance exist.

---

## What holds in every mode

Turning the Curator on does not change how the deterministic tools behave. It adds one tool and
unlocks chat. These are enforced in code, below the model, and cannot be talked out of it:

- **Frontmatter must parse.** An agent write whose YAML cannot be read back is *rejected* — silently
  discarded frontmatter would strip a note's status and tags, so a note claiming `status: locked`
  would rank as an ordinary one. The dashboard editor stays permissive (a human can see what they
  typed) and warns instead.
- **No silent truncation.** A write that shrinks an existing note (≥400 bytes) below 30% of its size
  is refused unless the caller passes `overwrite: true`.
- **No path escapes.** Writes are confined to the active vault.
- **Files are the source of truth; git is the database.** The index is disposable.

## What the loop adds on top

`lib/agent.ts` runs both surfaces. It shares one prompt core: authority beats rank order,
single-valued facts (a price, a guarantee, a legal entity) route to their owning note rather than
being merged, read before you overwrite, archive instead of delete.

- **`guardOverwrite`** — a structural read-before-overwrite. `brain_write` / `brain_edit` on an
  existing note the loop has not opened this session is refused. Unlike the byte-shrink guard, this
  catches a *same-size* clobber.
- **No delete, ever.** Neither surface gets `brain_delete`. Archiving preserves the reasoning trail;
  deletion is a human decision made where you can see what you are removing.
- **No recursion.** Neither surface gets `brain_capture`.
- **Provenance.** Writes are attributed in the git log: `curator (chat)`, or `<token> via capture`.

## Recommended rollout

Ship `off`. Move to `chat` when you want to ask questions. Reach `full` only after the Activity feed
has earned your trust — run `chat` for a week and watch what a capture *would* have done. The quick
toggle on the home page deliberately only reaches `chat`; granting write access is a choice made in
Settings.
