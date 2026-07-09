"use client";

import Link from "next/link";
import useSWR from "swr";
import { ArrowRight, Brain, Check, GitBranch, Plug } from "lucide-react";
import { fetcher } from "@/lib/client";
import { CuratorChat } from "@/components/curator-chat";

interface Repo {
  id: string;
  name: string;
  fullName?: string;
  active: boolean;
}
interface Sync {
  enabled: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  dirty?: number;
  error?: boolean;
}

/** One pillar row: what it is, its live state, and the action to set it up. */
function Pillar({
  icon,
  title,
  desc,
  state,
  ok,
  href,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  state?: string;
  ok?: boolean;
  href: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-ring"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          {state && (
            <span className={`inline-flex items-center gap-1 text-xs ${ok ? "text-emerald-500" : "text-muted-foreground"}`}>
              <span className={`size-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />
              {state}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground transition-colors group-hover:text-foreground">
        {ok ? <Check size={13} /> : null}
        {cta}
        <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

const APP_NAME_FALLBACK = process.env.NEXT_PUBLIC_APP_NAME || "Engram";

export default function Home() {
  const { data: repos } = useSWR<{ repos: Repo[]; active: Repo | null }>("/api/repos", fetcher);
  const { data: sync } = useSWR<Sync>("/api/sync", fetcher, { refreshInterval: 10000 });
  const { data: feat } = useSWR<{ harness?: boolean; mcpAuthRequired?: boolean; appName?: string }>("/api/features", fetcher);
  const { data: tok } = useSWR<{ tokens: { id: string }[] }>("/api/tokens", fetcher);

  const active = repos?.active ?? null;
  const appName = feat?.appName || APP_NAME_FALLBACK;
  const tokenCount = tok?.tokens?.length ?? 0;

  const syncState = !active
    ? "sample vault"
    : sync?.enabled === false
      ? "sync off"
      : sync?.error
        ? "sync error"
        : sync?.ahead || sync?.behind || sync?.dirty
          ? `${sync?.dirty || 0} local · ↑${sync?.ahead || 0} ↓${sync?.behind || 0}`
          : "synced";

  // Curator on → the home is a chat window over your brain.
  if (feat?.harness) return <CuratorChat />;

  return (
    <div className="scrollbar-none h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-8 py-12">
        <div>
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-primary" />
            <h1 className="text-lg font-semibold tracking-tight">{appName}</h1>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            A second brain your agents read and write — a git repo of markdown, live over MCP.
          </p>
        </div>

        <div className="space-y-2.5">
          <Pillar
            icon={<GitBranch size={16} />}
            title="Vault"
            ok={!!active}
            state={active ? `${active.name} · ${syncState}` : "not connected"}
            desc={active ? "Your notes live in this git repo — versioned, synced, portable." : "Connect a git repo of markdown — the source of truth for humans and agents."}
            href="/workspaces"
            cta={active ? "Manage" : "Connect a repo"}
          />
          <Pillar
            icon={<Plug size={16} />}
            title="Agents"
            ok={tokenCount > 0}
            state={tokenCount > 0 ? `${tokenCount} token${tokenCount === 1 ? "" : "s"}` : "none yet"}
            desc="Point Claude Code, Cursor, Hermes, or Claude.ai at the MCP endpoint to read + write this brain."
            href="/connect"
            cta={tokenCount > 0 ? "Manage" : "Connect an agent"}
          />
          <Pillar
            icon={<Brain size={16} />}
            title="Curator"
            ok={!!feat?.harness}
            state={feat?.harness ? "on" : "off"}
            desc="A chat agent that reads your notes to answer, and files rough dumps into the right place. Runs on your Anthropic key."
            href="/settings"
            cta={feat?.harness ? "Configure" : "Enable"}
          />
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Select a note, or press{" "}
          <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px]">⌘K</kbd> to search.
        </p>
      </div>
    </div>
  );
}
