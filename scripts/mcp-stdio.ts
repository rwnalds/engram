/**
 * Engram — standalone stdio MCP server (local mode).
 *
 * The dashboard serves MCP over HTTP for a self-hosted, multi-agent team. This is the other mode:
 * a plain stdio MCP server over a local folder of markdown, for a single machine — Claude Desktop,
 * Cursor, `npx`, or a registry's Docker introspection (Glama/Smithery only need it to start and
 * answer tools/list). Same brain_* tools; no HTTP, no auth, no git.
 *
 *   bun scripts/mcp-stdio.ts [vault-dir]     # local (repo uses bun)
 *   tsx scripts/mcp-stdio.ts [vault-dir]     # node (what Glama's mcp-proxy runs)
 *
 * Defaults to the bundled sample-vault when no dir is given. VAULT_DIR env also works.
 * No top-level await: tsx runs on Node in CJS mode, where TLA is unsupported. The vault dir must
 * be resolved into env BEFORE the tools module loads (config reads it at import), so imports are
 * dynamic, inside main().
 */
async function main() {
  const vaultArg = process.argv[2];
  if (vaultArg) process.env.VAULT_DIR = vaultArg;
  // Local mode: never touch git, never require an Anthropic key for introspection.
  process.env.GIT_SYNC_ENABLED = "false";

  const { TOOLS, TOOL_MAP } = await import("@/lib/mcp/tools");
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");

  const server = new Server({ name: "engram", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOL_MAP.get(req.params.name);
    if (!tool) throw new Error(`unknown tool: ${req.params.name}`);
    const out = await tool.handler(req.params.arguments ?? {});
    const text = typeof out === "string" ? out : JSON.stringify(out, null, 2);
    return { content: [{ type: "text", text }] };
  });

  // stderr only — stdout is the JSON-RPC channel and must stay clean.
  console.error(`[engram] stdio MCP server ready · vault: ${process.env.VAULT_DIR ?? "(bundled sample-vault)"}`);

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("[engram] stdio server failed:", err);
  process.exit(1);
});

export {};
