import { MCP_TOKEN } from "@/lib/config";
import { harnessEnabled } from "@/lib/settings";
import { hasAnyToken, resolveToken, type TokenScope } from "@/lib/tokens";
import { oauthEnabled, verifyAccessToken, wwwAuthenticate } from "@/lib/oauth";
import { withActor } from "@/lib/actor";
import { TOOL_MAP, visibleTools } from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";

const PROTOCOL = "2025-06-18";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/** The authenticated caller: a name for the audit trail, and what it may do. */
interface Caller {
  name: string;
  scope: TokenScope;
}

function rpc(id: Json, result?: Json, error?: Json) {
  const msg: Json = { jsonrpc: "2.0", id: id ?? null };
  if (error) msg.error = error;
  else msg.result = result;
  return msg;
}

async function handleMessage(msg: Json, caller: Caller): Promise<Json | null> {
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
        serverInfo: { name: "engram", version: "0.1.0" },
      });
    case "ping":
      return rpc(id, {});
    case "tools/list": {
      const tools = visibleTools(caller.scope === "write", harnessEnabled());
      return rpc(id, {
        tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
    }
    case "tools/call": {
      const tool = TOOL_MAP.get(params?.name);
      if (!tool) return rpc(id, undefined, { code: -32602, message: `unknown tool: ${params?.name}` });
      if (tool.write && caller.scope !== "write") {
        return rpc(id, undefined, {
          code: -32001,
          message: `${tool.name} mutates the vault, and this token is read-only. Ask the operator for a write token.`,
        });
      }
      if (tool.name === "brain_capture" && !harnessEnabled()) {
        return rpc(id, undefined, { code: -32601, message: "brain_capture is off — the operator has not enabled it." });
      }
      try {
        // Stamp every write this call causes with the caller's name, for the git audit trail.
        const out = await withActor(caller.name, () => tool.handler(params?.arguments ?? {}));
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

/**
 * Resolve a credential to a caller, or null when it is not valid. A named per-teammate token
 * carries its own scope; the shared env token and OAuth sessions are full-access, and an
 * unauthenticated local instance (no auth configured at all) is treated as the operator.
 */
async function authenticate(token: string, authRequired: boolean): Promise<Caller | null> {
  if (!authRequired) return { name: "local", scope: "write" };
  if (!token) return null;
  if (MCP_TOKEN !== "" && token === MCP_TOKEN) return { name: "shared-token", scope: "write" };
  const named = resolveToken(token);
  if (named) return { name: named.name, scope: named.scope };
  if (oauthEnabled() && (await verifyAccessToken(token))) return { name: "oauth", scope: "write" };
  return null;
}

/** 401 that also advertises the OAuth flow (WWW-Authenticate) so connectors can discover it. */
function unauthorized(): Response {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (oauthEnabled()) headers["WWW-Authenticate"] = wwwAuthenticate();
  return new Response(JSON.stringify(rpc(null, undefined, { code: -32001, message: "unauthorized" })), { status: 401, headers });
}

export async function POST(req: Request) {
  // Enforce auth when any is configured (env MCP_TOKEN, a team token, or OAuth). Open
  // locally when nothing is set. On failure, advertise OAuth so Claude.ai can connect.
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const authRequired = MCP_TOKEN !== "" || hasAnyToken() || oauthEnabled();
  const caller = await authenticate(token, authRequired);
  if (!caller) return unauthorized();

  let body: Json;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(rpc(null, undefined, { code: -32700, message: "parse error" }), 400);
  }

  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleMessage(m, caller)))).filter(Boolean);
    return out.length === 0 ? new Response(null, { status: 202 }) : jsonResponse(out);
  }
  const res = await handleMessage(body, caller);
  return res ? jsonResponse(res) : new Response(null, { status: 202 });
}

// This server is request/response only (no server-initiated SSE stream). When OAuth is on,
// answer probes with a 401 that advertises the flow so connectors can discover it.
export function GET() {
  if (oauthEnabled()) {
    return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": wwwAuthenticate() } });
  }
  return new Response("Method Not Allowed", { status: 405 });
}
