"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { fetcher } from "@/lib/client";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

/** A read-only token cannot mutate the vault — the write tools are not even listed to it. */
type TokenScope = "read" | "write";

interface TokenMeta {
  id: string;
  name: string;
  created: string;
  scope: TokenScope;
}

/** The name + scope + create controls, shared by the inline (desktop) and dialog (mobile) forms. */
function TokenFields({
  newName,
  setNewName,
  scope,
  setScope,
  creating,
  onCreate,
  className,
}: {
  newName: string;
  setNewName: (v: string) => void;
  scope: TokenScope;
  setScope: (s: TokenScope) => void;
  creating: boolean;
  onCreate: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center", className)}>
      <input
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onCreate()}
        placeholder="Token name"
        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground sm:w-56 sm:flex-none"
      />
      <div className="flex items-center gap-2">
        <div className="inline-flex shrink-0 rounded-md border border-border p-0.5" role="group" aria-label="Token scope">
          {(["read", "write"] as const).map((sc) => (
            <button
              key={sc}
              type="button"
              onClick={() => setScope(sc)}
              title={
                sc === "read"
                  ? "The agent can search and read your notes, but cannot change them."
                  : "The agent can create, edit, move and delete notes."
              }
              className={cn(
                "rounded px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                scope === sc ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {sc}
            </button>
          ))}
        </div>
        <button
          onClick={onCreate}
          disabled={creating}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create"}
        </button>
      </div>
    </div>
  );
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
  const [scope, setScope] = useState<TokenScope>("write");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [agent, setAgent] = useState("claude-code");

  const mcp = origin ? `${origin}/api/mcp` : "…";
  const needsToken = feat?.mcpAuthRequired !== false;
  const tokenForCmd = justCreated?.token ?? "<MCP_TOKEN>";
  const tokenLine = needsToken || justCreated ? ` \\\n  --header "Authorization: Bearer ${tokenForCmd}"` : "";
  const claudeCmd = `claude mcp add --transport http engram ${mcp}${tokenLine}`;
  const jsonConfig = `{
  "mcpServers": {
    "engram": {
      "url": "${mcp}",
      "headers": { "Authorization": "Bearer ${tokenForCmd}" }
    }
  }
}`;
  const hermes = `mcp_servers:\n  engram:\n    url: ${mcp}\n    headers:\n      Authorization: "Bearer ${tokenForCmd}"`;

  // One dropdown, one set of instructions — beats a wall of near-identical config blocks.
  const AGENTS: { id: string; label: string; instruction: React.ReactNode; snippet: string }[] = [
    { id: "claude-code", label: "Claude Code", instruction: "Run in a terminal, then the brain_* tools are available in your sessions:", snippet: claudeCmd },
    { id: "cursor", label: "Cursor", instruction: <>Add to <code className="rounded bg-muted px-1">~/.cursor/mcp.json</code> (or a project <code className="rounded bg-muted px-1">.cursor/mcp.json</code>):</>, snippet: jsonConfig },
    { id: "claude-desktop", label: "Claude Desktop", instruction: <>Settings → Developer → Edit Config, add to <code className="rounded bg-muted px-1">claude_desktop_config.json</code>:</>, snippet: jsonConfig },
    { id: "windsurf", label: "Windsurf", instruction: <>Add to <code className="rounded bg-muted px-1">~/.codeium/windsurf/mcp_config.json</code>:</>, snippet: jsonConfig },
    { id: "cline", label: "Cline", instruction: "Cline → MCP Servers → Configure, add:", snippet: jsonConfig },
    { id: "hermes", label: "Hermes", instruction: <>Add to <code className="rounded bg-muted px-1">~/.hermes/config.yaml</code>:</>, snippet: hermes },
    { id: "codex", label: "Codex", instruction: <>Add an HTTP MCP server pointing at the endpoint below, with header <code className="rounded bg-muted px-1">Authorization: Bearer &lt;token&gt;</code>.</>, snippet: mcp },
    { id: "other", label: "Other MCP client", instruction: <>Add a streamable-HTTP MCP server with this URL{needsToken || justCreated ? <> and header <code className="rounded bg-muted px-1">Authorization: Bearer &lt;token&gt;</code></> : null}:</>, snippet: mcp },
  ];
  const selected = AGENTS.find((a) => a.id === agent) ?? AGENTS[0];

  async function create() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName.trim() || "token", scope }),
      });
      const d = await res.json();
      if (d.token) setJustCreated({ name: d.name, token: d.token });
      setNewName("");
      setDialogOpen(false);
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

  const tokens = tokData?.tokens ?? [];
  const fieldProps = { newName, setNewName, scope, setScope, creating, onCreate: create };

  return (
    <div className="scrollbar-none h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Connect an agent</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Point any MCP client at this brain. Agents read + write over the tools — nothing keeps a
          local copy of the vault. MCP connection is configured on the agent, not here.
        </p>

        {/* Token management first */}
        <section className="mt-8 space-y-3">
          <div>
            <h2 className="text-sm font-medium">Access tokens</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Give each teammate or agent its own MCP key. Shown once at creation — copy it then.
              Revoke anytime. (Dashboard login is separate, set via env on deploy.)
            </p>
          </div>

          {/* Inline creator on desktop; a button + dialog on mobile. */}
          <TokenFields {...fieldProps} className="hidden md:flex" />
          <div className="md:hidden">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <button className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
                  <Plus size={15} /> New token
                </button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New access token</DialogTitle>
                </DialogHeader>
                <TokenFields {...fieldProps} />
              </DialogContent>
            </Dialog>
          </div>

          {justCreated && (
            <div className="space-y-1 rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">
                New token for <span className="text-foreground">{justCreated.name}</span> — copy it now, it won&apos;t be shown again:
              </p>
              <Copyable text={justCreated.token} />
            </div>
          )}

          {tokens.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Scope</th>
                    <th className="hidden px-3 py-2 font-medium sm:table-cell">Created</th>
                    <th className="px-3 py-2 text-right font-medium">Revoke</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((t) => (
                    <tr key={t.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">{t.name}</td>
                      <td className="px-3 py-2">
                        <span className={cn("text-xs", t.scope === "read" ? "text-muted-foreground" : "text-foreground")}>
                          {t.scope === "read" ? "read-only" : "read & write"}
                        </span>
                      </td>
                      <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{new Date(t.created).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => revoke(t.id)}
                          title="Revoke"
                          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-destructive"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No tokens yet — the MCP is {needsToken ? "gated by env MCP_TOKEN" : "open (local)"}.
            </p>
          )}
        </section>

        {/* One dropdown instead of a section per client. */}
        <section className="mt-8 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-medium">Connect</h2>
            <Select value={agent} onValueChange={setAgent}>
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue placeholder="Choose your agent" />
              </SelectTrigger>
              <SelectContent>
                {AGENTS.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-sm text-muted-foreground">{selected.instruction}</p>
          <Copyable text={selected.snippet} />
        </section>
      </div>
    </div>
  );
}
