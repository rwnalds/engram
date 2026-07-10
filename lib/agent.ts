import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_CURATOR_MODEL, SUPPORTED_MODEL_IDS } from "@/lib/models";
import { anthropicApiKey } from "@/lib/settings";
import { TOOLS, type Tool } from "@/lib/mcp/tools";
import { getNote, readVaultFile, vaultConventions } from "@/lib/vault/store";
import { normalizeNotePath } from "@/lib/vault/write";
import { withActor } from "@/lib/actor";

/**
 * The Curator — one agentic loop, two surfaces.
 *
 *  chat    — a human asks questions in the dashboard (streamed).
 *  capture — an agent hands over a rough dump and the loop files it (blocking, via brain_capture).
 *
 * Both run the same tools, the same conventions, and the same safety rules. They differ only in
 * their prompt and their capability profile, because the trust boundary differs: a human is
 * watching the chat, and nobody is watching a capture at 2am.
 *
 * The tools come straight from lib/mcp/tools.ts rather than being redefined here. When they were
 * defined twice, the second copy silently rotted — the Curator went months describing a return
 * shape that no longer existed.
 */
export type AgentProfile = "chat" | "capture";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Everything the loop changed, so a caller who delegated the decision can see what happened. */
export interface Manifest {
  created: string[];
  updated: string[];
  appended: string[];
  moved: string[];
}

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string }
  | { type: "manifest"; manifest: Manifest }
  | { type: "done" }
  | { type: "error"; message: string };

/**
 * Tools the loop may use.
 *
 * `brain_capture` is excluded always — the loop *is* capture, and exposing it to itself invites
 * an agent calling an agent. `brain_delete` is excluded always: archiving (brain_move) demotes a
 * note out of search while preserving the reasoning trail, and deletion is a human decision made
 * in the dashboard where you can see what you are removing.
 */
export function loopTools(canWrite: boolean): Tool[] {
  return TOOLS.filter((t) => {
    if (t.name === "brain_capture" || t.name === "brain_delete") return false;
    return canWrite || !t.write;
  });
}

const toAnthropicTool = (t: Tool): Anthropic.Tool => ({
  name: t.name,
  description: t.description,
  input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
});

const SHARED_RULES = `
Rules that hold on every turn:
- Ground every claim in the notes. Use brain_search to find them, brain_read to read them. Never invent a fact about this vault; if it isn't written down, say so.
- Search ranks by keyword relevance, NOT by truth. Every result carries an "authority": authoritative > current > provisional > superseded > archived. Prefer the authoritative note. Never present a superseded, archived, or provisional note as current fact.
- Compose freely for context and history. But a single-valued fact — a price, a guarantee, a legal entity, a contract term — has exactly one owning note. Do not merge sources for those, and never average two notes that disagree: that is a defect in the vault. Report it.
- Read a note before you overwrite it. Writing a note you have not read destroys whatever was there.
- Nothing is ever deleted. When a note stops being true, brain_move it into archive/ and leave a pointer in whatever replaced it.
`.trim();

const CHAT_PROMPT = `You are the Curator — the resident agent of this markdown "second brain". You help the operator recall, connect, and reason over their own notes.

${SHARED_RULES}
- Cite notes in wikilink form so the operator can click through, e.g. [[clients/mks/mks|MKS]].
- Be direct, specific, concise. Lead with the answer, then the supporting detail.`;

const CHAT_READONLY = `\n- You cannot write in this mode. If a change is needed, say exactly what you would change and let the operator make it.`;
const CHAT_WRITE = `\n- You may edit the vault. The operator is watching, so act when asked — but read a note before you rewrite it, and say what you changed.`;

const CAPTURE_PROMPT = `You file rough notes into a markdown "second brain". You are given a raw dump and must put it where it belongs, cleanly.

${SHARED_RULES}

How to work:
1. brain_schema first — folder taxonomy, frontmatter conventions, and this vault's actual status vocabulary.
2. brain_search for what already exists on this subject. Do not skip this: filing a duplicate is worse than filing nothing.
3. Then decide, deliberately:
   - Nothing exists → brain_write a new note at a sensible path.
   - A note covers this already → brain_read it, then brain_append the new material, or brain_edit it with the FULL merged content.
   - The dump supersedes an existing note → brain_move the old one into archive/ and write the replacement with a pointer to what it replaced.
4. Prefer passing a \`frontmatter\` object plus a plain \`body\` over hand-writing YAML — it always parses.
5. Finish with one short sentence saying what you did and why. No preamble.

Never write to a path you have not read when a note already lives there. Never delete.`;

/** Was this tool call a mutation, and of what shape? */
const MUTATION_KIND: Record<string, keyof Manifest> = {
  brain_write: "created",
  brain_edit: "updated",
  brain_append: "appended",
  brain_move: "moved",
};

function noteExists(p: string): boolean {
  try {
    return getNote(normalizeNotePath(String(p))) !== null;
  } catch {
    return false;
  }
}

/**
 * Structural read-before-overwrite. Not a size heuristic like the one in write.ts — this refuses
 * the write outright until the loop has actually opened the note, so a same-size clobber is
 * caught too. Returns an error message for the model, or null to proceed.
 */
export function guardOverwrite(toolName: string, target: string, readPaths: ReadonlySet<string>): string | null {
  if (toolName !== "brain_write" && toolName !== "brain_edit") return null;
  if (!target || !noteExists(target) || readPaths.has(target)) return null;
  return `${target} already exists and you have not read it in this session. Call brain_read("${target}") first, then write back the full content you intend to keep — or use brain_append to add to it.`;
}

export interface AgentOpts {
  profile: AgentProfile;
  /** chat: the conversation. capture: a single user turn holding the rough dump. */
  messages: ChatMessage[];
  canWrite: boolean;
  model?: string;
  thinking?: boolean;
  maxTurns?: number;
  /**
   * Who to credit for writes in the git log. Bound around each tool call rather than around the
   * generator: an async generator resumes in the caller's context, so wrapping the whole stream
   * would lose the actor on the very first `await`.
   */
  actor?: string;
}

/**
 * Run the loop, yielding events. Chat streams them to the browser; capture drains them and
 * keeps the manifest.
 */
export async function* agentStream(opts: AgentOpts): AsyncGenerator<AgentEvent> {
  const apiKey = anthropicApiKey();
  if (!apiKey) {
    yield { type: "error", message: "No Anthropic API key. Enable the Curator in Settings and add a key." };
    return;
  }

  const tools = loopTools(opts.canWrite);
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const model = opts.model && SUPPORTED_MODEL_IDS.has(opts.model) ? opts.model : DEFAULT_CURATOR_MODEL;
  const client = new Anthropic({ apiKey });

  const manifest: Manifest = { created: [], updated: [], appended: [], moved: [] };
  /** Paths this run has actually read. The loop may not overwrite a note it hasn't opened. */
  const readPaths = new Set<string>();

  const system =
    opts.profile === "capture"
      ? CAPTURE_PROMPT
      : CHAT_PROMPT + (opts.canWrite ? CHAT_WRITE : CHAT_READONLY);

  const messages: Anthropic.MessageParam[] = opts.messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "")
    .map((m) => ({ role: m.role, content: m.content }));
  if (messages.length === 0) {
    yield { type: "error", message: "Nothing to do." };
    return;
  }

  /** Run one tool call, enforcing read-before-overwrite and recording what changed. */
  async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    const tool = toolMap.get(name);
    if (!tool) return { error: `unknown or forbidden tool: ${name}` };

    const target = typeof input.path === "string" ? normalizeNotePath(input.path) : "";

    const blocked = guardOverwrite(name, target, readPaths);
    if (blocked) return { error: blocked };

    const out = await withActor(opts.actor ?? "curator", () => tool.handler(input));

    if (name === "brain_read" && target) readPaths.add(target);
    const kind = MUTATION_KIND[name];
    if (kind && out && typeof out === "object" && "path" in out) {
      const p = String((out as { path: unknown }).path);
      // brain_write on a path that already existed is an update, not a creation.
      const bucket: keyof Manifest = name === "brain_write" && readPaths.has(target) ? "updated" : kind;
      if (!manifest[bucket].includes(p)) manifest[bucket].push(p);
      readPaths.add(p); // it is now known content
    }
    return out;
  }

  try {
    const maxTurns = opts.maxTurns ?? 8;
    for (let turn = 0; turn < maxTurns; turn++) {
      const stream = client.messages.stream({
        model,
        max_tokens: 16000,
        system,
        tools: tools.map(toAnthropicTool),
        messages,
        ...(opts.thinking ? { thinking: { type: "adaptive", display: "summarized" } } : {}),
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") yield { type: "text", text: event.delta.text };
          else if (event.delta.type === "thinking_delta") yield { type: "thinking", text: event.delta.thinking };
        } else if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          yield { type: "tool", name: event.content_block.name };
        }
      }

      const message = await stream.finalMessage();
      if (message.stop_reason !== "tool_use") {
        yield { type: "manifest", manifest };
        yield { type: "done" };
        return;
      }

      messages.push({ role: "assistant", content: message.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of message.content) {
        if (block.type !== "tool_use") continue;
        let out: unknown;
        try {
          out = await runTool(block.name, (block.input ?? {}) as Record<string, unknown>);
        } catch (e) {
          out = { error: e instanceof Error ? e.message : String(e) };
        }
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out).slice(0, 40000) });
      }
      messages.push({ role: "user", content: results });
    }
    // Ran out of turns — still report what was touched, so nothing is silently half-done.
    yield { type: "manifest", manifest };
    yield { type: "done" };
  } catch (e) {
    yield { type: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Vault context injected into a capture, so the model doesn't have to discover it by tool call. */
export function captureContext(): string {
  const schema = readVaultFile("SCHEMA.md") ?? "(no SCHEMA.md)";
  const c = vaultConventions();
  return [
    `Existing folders: ${c.folders.join(", ") || "(none yet)"}`,
    `Statuses in use: ${c.statusesInUse.map((s) => s.status).join(", ") || "(none)"}`,
    "",
    "SCHEMA:",
    schema,
  ].join("\n");
}
