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
/**
 * The stdio server speaks JSON-RPC on stdin/stdout and never opens a port. Deployed to a PaaS as a
 * web service it fails like this: it prints "ready", reads EOF from a stdin nothing is attached to,
 * exits 0 — and the platform reports a *successful* deploy whose URL 502s forever. Nothing in the
 * logs looks wrong, which is what makes it expensive: engram's own Railway instance sat broken on
 * exactly this, deployed from the wrong one of the two published images.
 *
 * The two are not interchangeable:
 *   ghcr.io/rwnalds/engram      stdio — Claude Desktop, Cursor, registries   (Dockerfile.mcp)
 *   ghcr.io/rwnalds/engram-app  HTTP  — dashboard + /api/mcp, what a PaaS runs (Dockerfile)
 *
 * So refuse, loudly and non-zero, when we can tell we're a web service on a PaaS: a crashed deploy
 * with an explanation beats a green one that never answers. Only unambiguous platform markers
 * count — PORT is an ordinary local env var and must never trip this. Running the stdio server
 * inside a deployed container is legitimate, so ENGRAM_ALLOW_STDIO_ON_PAAS=1 overrides.
 */
const PAAS_MARKERS: ReadonlyArray<readonly [envVar: string, platform: string]> = [
  ["RAILWAY_ENVIRONMENT", "Railway"],
  ["RENDER", "Render"],
  ["FLY_APP_NAME", "Fly.io"],
  ["DYNO", "Heroku"],
  ["KOYEB_APP_NAME", "Koyeb"],
];

function refuseIfDeployedAsWebService() {
  if (process.env.ENGRAM_ALLOW_STDIO_ON_PAAS) return;
  const marker = PAAS_MARKERS.find(([envVar]) => process.env[envVar]);
  if (!marker) return;

  console.error(
    [
      "",
      `[engram] Refusing to start: this is the stdio MCP image, running on ${marker[1]}.`,
      "",
      "  It serves JSON-RPC over stdin/stdout and never opens a port, so a web service built from",
      "  it can only 502 — and by exiting 0 it would report a deploy that 'succeeded'.",
      "",
      "  Deploy the app image instead:  ghcr.io/rwnalds/engram-app:latest",
      "    dashboard + HTTP MCP at /api/mcp · healthcheck /api/health · volume mounted at /data",
      "",
      "  Meant to run the stdio server inside a deployed container? Set ENGRAM_ALLOW_STDIO_ON_PAAS=1",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

async function main() {
  refuseIfDeployedAsWebService();

  const vaultArg = process.argv[2];
  if (vaultArg) process.env.VAULT_DIR = vaultArg;
  // Local mode: never touch git, never require an Anthropic key for introspection.
  process.env.GIT_SYNC_ENABLED = "false";

  const { TOOLS } = await import("@/lib/mcp/tools");
  const { callTool } = await import("@/lib/mcp/call");
  const { VERSION } = await import("@/lib/version");
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");

  const server = new Server({ name: "engram", version: VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    // Via callTool, so this transport validates arguments against each tool's inputSchema exactly
    // like the HTTP route. Dispatching straight to `tool.handler` is what let a `brain_append`
    // carrying its payload under the wrong key write a blank line and report success.
    const out = await callTool(req.params.name, req.params.arguments ?? {});
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
