import Anthropic from "@anthropic-ai/sdk";
import { anthropicApiKey } from "@/lib/settings";
import { getBacklinks, getNote, listNotes, readVaultFile, searchNotes } from "@/lib/vault/store";

/**
 * The Curator — the resident chat agent of the brain. It answers questions about the
 * vault, grounded in the actual notes via read tools (search/read/list), streaming over
 * SSE with an interleaved tool loop. Read-only: it helps you think, it doesn't write notes.
 * Uses the official Anthropic SDK so model IDs + adaptive thinking are exact.
 */

export const CURATOR_MODELS = [
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
] as const;
export const DEFAULT_CURATOR_MODEL = "claude-opus-4-8";
const MODEL_IDS = new Set<string>(CURATOR_MODELS.map((m) => m.id));

function systemPrompt(): string {
  const schema = readVaultFile("SCHEMA.md");
  return `You are the Curator — the resident agent of this markdown "second brain". You help the operator recall, connect, and reason over their own notes.

Rules:
- Ground every factual claim about the vault in the notes. Use brain_search to find notes, brain_read to read their full content, brain_list to see what exists. Never invent facts about the vault — if it isn't in the notes, say so plainly.
- Cite notes in wikilink form so the user can click through, e.g. [[clients/mks/mks|MKS]] or [[decisions/foo-2026-07-09]].
- Be direct, specific, and concise. Lead with the answer, then the supporting detail.
- You are READ-ONLY in this chat. You help the user think; you do not create or edit notes.
${schema ? `\nThe vault's SCHEMA (folder taxonomy + conventions):\n"""\n${schema.slice(0, 4000)}\n"""` : ""}`;
}

// Anthropic tool definitions — read-only vault access.
const TOOLS: Anthropic.Tool[] = [
  {
    name: "brain_search",
    description: "Full-text + fuzzy search across all notes. Returns ranked results (path, title, folder). Use this first to find relevant notes.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "search query" } }, required: ["query"] },
  },
  {
    name: "brain_read",
    description: "Read a note's full markdown (frontmatter + body) plus its backlinks. Path is vault-relative, e.g. 'clients/mks/mks.md'.",
    input_schema: { type: "object", properties: { path: { type: "string", description: "vault-relative path" } }, required: ["path"] },
  },
  {
    name: "brain_list",
    description: "List all notes with metadata (path, title, folder, type, tags). Use to discover what exists.",
    input_schema: { type: "object", properties: {} },
  },
];

function runTool(name: string, input: Record<string, unknown>): unknown {
  if (name === "brain_search") return searchNotes(String(input.query ?? ""));
  if (name === "brain_read") {
    const p = String(input.path ?? "");
    const n = getNote(p);
    return n ? { path: p, frontmatter: n.frontmatter, content: n.raw, backlinks: getBacklinks(p) } : { error: `not found: ${p}` };
  }
  if (name === "brain_list") return listNotes();
  return { error: `unknown tool: ${name}` };
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
export type CuratorEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string }
  | { type: "done" }
  | { type: "error"; message: string };

/** Stream a Curator turn: yields text/thinking/tool events, runs the vault tool loop server-side. */
export async function* curatorStream(opts: {
  messages: ChatMessage[];
  model?: string;
  thinking?: boolean;
}): AsyncGenerator<CuratorEvent> {
  const apiKey = anthropicApiKey();
  if (!apiKey) {
    yield { type: "error", message: "No Anthropic API key. Enable the Curator in Settings and add a key." };
    return;
  }
  const model = opts.model && MODEL_IDS.has(opts.model) ? opts.model : DEFAULT_CURATOR_MODEL;
  const client = new Anthropic({ apiKey });

  const messages: Anthropic.MessageParam[] = opts.messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "")
    .map((m) => ({ role: m.role, content: m.content }));
  if (messages.length === 0) {
    yield { type: "error", message: "No message to send." };
    return;
  }

  try {
    for (let turn = 0; turn < 8; turn++) {
      const stream = client.messages.stream({
        model,
        max_tokens: 16000,
        system: systemPrompt(),
        tools: TOOLS,
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
        yield { type: "done" };
        return;
      }
      // Echo the assistant turn back (thinking + tool_use blocks unchanged), then run the tools.
      messages.push({ role: "assistant", content: message.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of message.content) {
        if (block.type === "tool_use") {
          let out: unknown;
          try {
            out = runTool(block.name, block.input as Record<string, unknown>);
          } catch (e) {
            out = { error: e instanceof Error ? e.message : String(e) };
          }
          results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out).slice(0, 40000) });
        }
      }
      messages.push({ role: "user", content: results });
    }
    yield { type: "done" };
  } catch (e) {
    yield { type: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
