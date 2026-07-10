import { agentStream, type AgentEvent, type ChatMessage } from "@/lib/agent";
import { curatorMode } from "@/lib/settings";

/**
 * The Curator's chat surface — a thin adapter over the shared agent loop (lib/agent.ts).
 *
 * Read-only in `chat` mode, write-capable in `full`. The tools, the conventions, and the
 * safety rules all live in the loop, so this surface cannot drift away from the MCP one.
 */
export type { ChatMessage };
export type CuratorEvent = AgentEvent;

export async function* curatorStream(opts: {
  messages: ChatMessage[];
  model?: string;
  thinking?: boolean;
}): AsyncGenerator<CuratorEvent> {
  // A human is present and every write lands in git, so chat may write once the operator
  // has chosen `full`. It still never deletes — that is a decision made in the UI.
  yield* agentStream({
    profile: "chat",
    messages: opts.messages,
    canWrite: curatorMode() === "full",
    actor: "curator (chat)",
    model: opts.model,
    thinking: opts.thinking,
  });
}
