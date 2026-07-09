"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Check, Copy } from "lucide-react";
import { fetcher } from "@/lib/client";

function Copyable({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="scrollbar-none overflow-x-auto whitespace-pre rounded-lg border border-border bg-muted px-4 py-3 font-mono text-xs">
        {text}
      </pre>
      <button
        onClick={() => {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        aria-label="Copy"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

export default function ConnectPage() {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const { data: feat } = useSWR<{ mcpAuthRequired?: boolean; harness?: boolean }>("/api/features", fetcher);

  const mcp = origin ? `${origin}/api/mcp` : "…";
  const needsToken = feat?.mcpAuthRequired !== false;
  const tokenLine = needsToken ? ` \\\n  --header "Authorization: Bearer <MCP_TOKEN>"` : "";
  const claudeCmd = `claude mcp add --transport http cortex ${mcp}${tokenLine}`;
  const hermes = `mcp_servers:\n  cortex:\n    url: ${mcp}\n    headers:\n      Authorization: "Bearer <MCP_TOKEN>"`;

  return (
    <div className="scrollbar-none h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Connect an agent</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Point any MCP client at this brain. Agents read + write over the tools below — nothing
          keeps a local copy of the vault. MCP connection is configured on the agent, not here.
        </p>

        <section className="mt-8 space-y-2">
          <h2 className="text-sm font-medium">MCP endpoint</h2>
          <Copyable text={mcp} />
        </section>

        <section className="mt-6 space-y-2">
          <h2 className="text-sm font-medium">Claude Code</h2>
          <Copyable text={claudeCmd} />
          <p className="text-xs text-muted-foreground">Run in a terminal. Then the brain_* tools are available in your Claude Code sessions.</p>
        </section>

        <section className="mt-6 space-y-2">
          <h2 className="text-sm font-medium">Hermes — ~/.hermes/config.yaml</h2>
          <Copyable text={hermes} />
        </section>

        <section className="mt-6 space-y-2">
          <h2 className="text-sm font-medium">Cursor / other MCP clients</h2>
          <p className="text-sm text-muted-foreground">
            Add an HTTP MCP server with URL <code className="rounded bg-muted px-1">{mcp}</code>
            {needsToken && (
              <> and header <code className="rounded bg-muted px-1">Authorization: Bearer &lt;MCP_TOKEN&gt;</code></>
            )}
            .
          </p>
        </section>

        <p className="mt-8 text-xs text-muted-foreground">
          {needsToken
            ? "The MCP requires the MCP_TOKEN bearer set on the server."
            : "Auth is off locally — no token needed. Set MCP_TOKEN before exposing this publicly."}
        </p>
      </div>
    </div>
  );
}
