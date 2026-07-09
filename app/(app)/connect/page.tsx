"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Check, Copy, Trash2 } from "lucide-react";
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

interface TokenMeta {
  id: string;
  name: string;
  created: string;
}

export default function ConnectPage() {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const { data: feat } = useSWR<{ mcpAuthRequired?: boolean; harness?: boolean }>("/api/features", fetcher);
  const { data: tokData } = useSWR<{ tokens: TokenMeta[] }>("/api/tokens", fetcher);
  const { mutate } = useSWRConfig();

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<{ name: string; token: string } | null>(null);

  const mcp = origin ? `${origin}/api/mcp` : "…";
  const needsToken = feat?.mcpAuthRequired !== false;
  const tokenForCmd = justCreated?.token ?? "<MCP_TOKEN>";
  const tokenLine = needsToken || justCreated ? ` \\\n  --header "Authorization: Bearer ${tokenForCmd}"` : "";
  const claudeCmd = `claude mcp add --transport http cortex ${mcp}${tokenLine}`;
  const hermes = `mcp_servers:\n  cortex:\n    url: ${mcp}\n    headers:\n      Authorization: "Bearer ${tokenForCmd}"`;

  async function create() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName.trim() || "teammate" }),
      });
      const d = await res.json();
      if (d.token) setJustCreated({ name: d.name, token: d.token });
      setNewName("");
      mutate("/api/tokens");
      mutate("/api/features");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    await fetch(`/api/tokens/${id}`, { method: "DELETE" });
    mutate("/api/tokens");
    mutate("/api/features");
  }

  return (
    <div className="scrollbar-none h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Connect an agent</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Point any MCP client at this brain. Agents read + write over the tools — nothing keeps a
          local copy of the vault. MCP connection is configured on the agent, not here.
        </p>

        <section className="mt-8 space-y-2">
          <h2 className="text-sm font-medium">MCP endpoint</h2>
          <Copyable text={mcp} />
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="text-sm font-medium">Team access tokens</h2>
          <p className="text-sm text-muted-foreground">
            Give each teammate or agent its own MCP key. Shown once at creation — copy it then. Revoke
            anytime. (Dashboard login is separate, set via env on deploy.)
          </p>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="name (e.g. Timur)"
              className="w-56 rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground"
            />
            <button
              onClick={create}
              disabled={creating}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create token"}
            </button>
          </div>

          {justCreated && (
            <div className="space-y-1 rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">
                New token for <span className="text-foreground">{justCreated.name}</span> — copy it now, it won&apos;t be shown again:
              </p>
              <Copyable text={justCreated.token} />
            </div>
          )}

          {tokData?.tokens && tokData.tokens.length > 0 ? (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {tokData.tokens.map((t) => (
                <li key={t.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>
                    {t.name}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {new Date(t.created).toLocaleDateString()}
                    </span>
                  </span>
                  <button
                    onClick={() => revoke(t.id)}
                    title="Revoke"
                    className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No tokens yet — the MCP is {needsToken ? "gated by env MCP_TOKEN" : "open (local)"}.
            </p>
          )}
        </section>

        <section className="mt-8 space-y-2">
          <h2 className="text-sm font-medium">Claude Code</h2>
          <Copyable text={claudeCmd} />
          <p className="text-xs text-muted-foreground">Run in a terminal; then the brain_* tools are available in your Claude Code sessions.</p>
        </section>

        <section className="mt-6 space-y-2">
          <h2 className="text-sm font-medium">Hermes — ~/.hermes/config.yaml</h2>
          <Copyable text={hermes} />
        </section>

        <section className="mt-6 space-y-2">
          <h2 className="text-sm font-medium">Cursor / other MCP clients</h2>
          <p className="text-sm text-muted-foreground">
            Add an HTTP MCP server with URL <code className="rounded bg-muted px-1">{mcp}</code>
            {(needsToken || justCreated) && (
              <> and header <code className="rounded bg-muted px-1">Authorization: Bearer &lt;token&gt;</code></>
            )}
            .
          </p>
        </section>
      </div>
    </div>
  );
}
