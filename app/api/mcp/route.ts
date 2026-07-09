import { HARNESS_ENABLED, MCP_TOKEN } from "@/lib/config";
import { TOOLS, TOOL_MAP } from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";

const PROTOCOL = "2025-06-18";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function rpc(id: Json, result?: Json, error?: Json) {
  const msg: Json = { jsonrpc: "2.0", id: id ?? null };
  if (error) msg.error = error;
  else msg.result = result;
  return msg;
}

async function handleMessage(msg: Json): Promise<Json | null> {
  const method: string | undefined = msg?.method;
  const id = msg?.id;
  const params = msg?.params;
  if (!method) return null;
  if (method.startsWith("notifications/")) return null; // notifications get no response

  switch (method) {
    case "initialize":
      return rpc(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "cortex", version: "0.1.0" },
      });
    case "ping":
      return rpc(id, {});
    case "tools/list": {
      // Hide the auto-filing harness unless it's turned on (agents file notes themselves).
      const tools = TOOLS.filter((t) => t.name !== "brain_capture" || HARNESS_ENABLED);
      return rpc(id, {
        tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
    }
    case "tools/call": {
      const tool = TOOL_MAP.get(params?.name);
      if (!tool) return rpc(id, undefined, { code: -32602, message: `unknown tool: ${params?.name}` });
      try {
        const out = await tool.handler(params?.arguments ?? {});
        const text = typeof out === "string" ? out : JSON.stringify(out, null, 2);
        return rpc(id, { content: [{ type: "text", text }] });
      } catch (e) {
        return rpc(id, { content: [{ type: "text", text: `Error: ${(e as Error)?.message ?? e}` }], isError: true });
      }
    }
    default:
      return rpc(id, undefined, { code: -32601, message: `method not found: ${method}` });
  }
}

function jsonResponse(body: Json, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request) {
  // Enforce the bearer only when a token is configured (open locally when unset).
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (MCP_TOKEN && token !== MCP_TOKEN) {
    return jsonResponse(rpc(null, undefined, { code: -32001, message: "unauthorized" }), 401);
  }

  let body: Json;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(rpc(null, undefined, { code: -32700, message: "parse error" }), 400);
  }

  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handleMessage))).filter(Boolean);
    return out.length === 0 ? new Response(null, { status: 202 }) : jsonResponse(out);
  }
  const res = await handleMessage(body);
  return res ? jsonResponse(res) : new Response(null, { status: 202 });
}

// This server is request/response only (no server-initiated SSE stream).
export function GET() {
  return new Response("Method Not Allowed", { status: 405 });
}
