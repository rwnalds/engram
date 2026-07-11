# Authority, supersession, and "still true"

> Design notes seeded by the IndieHackers launch thread (July 2026). Two commenters
> independently pushed on the same gap, and they're right. This records the insight and the
> direction it points, so the next build starts from it instead of re-deriving it.

## The gap in location-authority

Engram today derives authority from a note's **location** — its folder and frontmatter
(`locked` / `current` / `superseded` / `archived`). That handles one half of the problem well:
it demotes low-authority junk.

It cannot see the half that actually caused the price story. A retired value often lives in a
**perfectly legitimate, high-authority note** — sometimes the very same note that also holds the
current value. Location-authority demotes untrustworthy *notes*; it does nothing about a **dead
value sitting in a trustworthy place**. The note still scores high on "price," so the dead number
still surfaces.

**Restated:** the failure isn't "this note is untrustworthy." It's "this value was retired, and the
retirement didn't demote it."

## The principle

> Authority has to key to the **value**, not just the note. And **"still true" cannot be recovered
> from the text at read time — it has to be written onto the supersession event itself.**

This is the load-bearing idea. You cannot infer "is this still current" by re-reading the text
later, because a retired price and a live price are textually identical. Cosine similarity can't tell
a contradiction from a duplicate. The only reliable signal is the **act of retiring**, and that act
has to leave a mark on the old value at the moment it happens.

- **Location-authority** handles the easy half (junk in low-authority places).
- **The retirement event** handles the half that bites (a dead value in a high-authority place).

## Why files are the right substrate for this

This is the part that makes Engram's "files are truth, git is the database" bet pay off rather than
just being a storage preference. A supersession does not have to be *inferred* from an embedding at
read time. It can be an **explicit, human-readable, versioned edit to the old value** — a struck
number with a pointer, a frontmatter edge, a commit whose message says what was retired and why.
The retirement is a fact you write down, not a guess you reconstruct. A vector store can't hold that;
a markdown file and a git history can.

## Direction for Engram (not built yet)

Current state: supersession is **note-level** — you archive a note or mark it `superseded`.
Value-level supersession is the gap.

The version to build:

1. **Retiring a value becomes a first-class write.** Setting a new price should mark the old one in
   the *same* operation, rather than quietly adding a second note that also scores high on "price."
   The old value gets a supersession marker written onto it.
2. **Capture is the natural hook.** The agentic capture loop already searches the vault before it
   files anything. That is exactly where a collision should be detected: if the incoming value
   conflicts with an existing one, the write is a **supersession**, not an **append**. This is the
   same "contradiction detection belongs at write time, not read time" conclusion from earlier in
   the thread, now made concrete: the write-time check isn't just "flag a contradiction," it's
   "convert an append into a supersession and mark the old value."
3. **Search consults supersession, not just note-location.** A value with a live supersession
   pointing at it is demoted or excluded even when its note still scores high.

## Open questions (carry into the build)

- **Where does the marker live?** A struck value in place (`~~€2,000~~ retired 2026-06 → [[new]]`),
  an explicit frontmatter edge, or a separate append-only event log? Each has different read-time
  cost and different merge behavior under git.
- **How is "a value" addressed?** A note is addressable; a claim inside a note is not, yet. Some
  granularity has to be invented (a keyed fact, a table row id, a tagged span).
- **Automated vs human-in-the-loop supersession.** When capture detects a collision, does it mark
  the old value automatically, or surface it for approval? (Consistent with the graduation ladder:
  propose first, earn auto.)

## Write-path atomicity, and hard exclusion for facts-of-record

> Later commenter, same thread. Sharpened the write-path point and added a retrieval-class point.

**Atomicity is the whole game.** Read-side authority is worthless if the flip to `superseded` is a
separate step a human or agent can skip. If "add the new fact" and "retire the old one" are two
operations, they drift, and authority-aware search then confidently ranks a stale note as current
again. In the commenter's words: *"otherwise you've just moved the bug from retrieval to
bookkeeping."* The durable version is **supersession as one atomic operation** — the write that adds
the new value demotes its predecessor in the same commit, so add and retire cannot come apart. This
makes the capture hook non-optional: capture already searches before it files, so it is the place to
fuse add + retire into a single write.

**Soft demotion is not enough for facts-of-record.** relevance × authority is a soft penalty, and
soft loses sometimes: a thin one-line live price note can be out-ranked by a verbose retired price
list that matches the query better, penalty and all. For the facts-of-record class (price, contract
terms, legal entity), **hard-exclude `superseded` by default** and surface it only when history is
explicitly requested, rather than trusting the weight to sink it far enough.

Current state, for the build: `archived` is *already* hard-excluded from agent search by default;
`superseded` is only soft-demoted (≈0.15×). Extending the hard exclusion to `superseded` — at least
for a facts-of-record class — is a small, correct change this comment is right to push.

## Source

IndieHackers launch thread for Engram, July 2026. Several commenters, independently, converged on:
location-authority is a good heuristic but blind to value-level retirement; the fix is to record
supersession as an event at write time (atomically, in the same commit that adds the new fact);
facts-of-record want a hard exclusion, not a soft demote; and readable files are the right place to
keep all of it. Credit to that thread for sharpening the model.
