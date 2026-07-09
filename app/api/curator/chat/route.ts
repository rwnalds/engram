import { curatorStream, type ChatMessage } from "@/lib/curator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** SSE stream of the Curator's reply, grounded in the vault via a server-side tool loop. */
export async function POST(req: Request) {
  let body: { messages?: ChatMessage[]; model?: string; thinking?: boolean };
  try {
    body = await req.json();
  } catch {
    return new Response("invalid JSON", { status: 400 });
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      try {
        for await (const ev of curatorStream({ messages, model: body.model, thinking: body.thinking })) {
          send(ev);
          if (ev.type === "done" || ev.type === "error") break;
        }
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" },
  });
}
