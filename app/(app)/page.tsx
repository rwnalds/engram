"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Brain, Check, GitBranch, Plug, Search, Settings as SettingsIcon } from "lucide-react";
import { fetcher, folderColor } from "@/lib/client";
import { navItemClass } from "@/lib/use-arrow-nav";
import { CuratorChat } from "@/components/curator-chat";
import { ActivityList, type ActivityEntry } from "@/components/activity-list";
import { RecentNotes } from "@/components/recent-notes";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

interface Repo {
  id: string;
  name: string;
  fullName?: string;
  active: boolean;
}
interface Settings {
  gitSyncEnabled: boolean;
  curatorModeFlag: "off" | "chat" | "full";
  anthropicApiKeySet: boolean;
}
interface Stats {
  notes: number;
  folders: number;
  links: number;
}
interface Hit {
  path: string;
  title: string;
  folder: string;
  type?: string;
}

const iconBox = "flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground";
const APP_NAME_FALLBACK = process.env.NEXT_PUBLIC_APP_NAME || "Engram";

function StatusDot({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${ok ? "text-emerald-500" : "text-muted-foreground"}`}>
      <span className={`size-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />
      {label}
    </span>
  );
}

function PillarBody({ icon, title, desc, state, ok }: { icon: React.ReactNode; title: string; desc: string; state?: string; ok?: boolean }) {
  return (
    <>
      <div className={iconBox}>{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          {state && <StatusDot ok={ok} label={state} />}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
    </>
  );
}

function LinkPillar(props: { icon: React.ReactNode; title: string; desc: string; state?: string; ok?: boolean; href: string; cta: string }) {
  return (
    <Link href={props.href} className="block">
      <Card className="group flex-row items-center gap-4 p-4 transition-colors hover:border-ring">
        <PillarBody icon={props.icon} title={props.title} desc={props.desc} state={props.state} ok={props.ok} />
        <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground transition-colors group-hover:text-foreground">
          {props.ok ? <Check size={13} /> : null}
          {props.cta}
          <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </Card>
    </Link>
  );
}

function TogglePillar(props: { icon: React.ReactNode; title: string; desc: string; state?: string; ok?: boolean; on: boolean; onToggle: (v: boolean) => void; footer?: React.ReactNode }) {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center gap-4 p-4">
        <PillarBody icon={props.icon} title={props.title} desc={props.desc} state={props.state} ok={props.ok} />
        <Switch checked={props.on} onCheckedChange={props.onToggle} />
      </div>
      {props.footer && <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">{props.footer}</div>}
    </Card>
  );
}

export default function Home() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { data: repos } = useSWR<{ repos: Repo[]; active: Repo | null }>("/api/repos", fetcher);
  const { data: feat } = useSWR<{ curator?: "off" | "chat" | "full"; harness?: boolean; mcpAuthRequired?: boolean; appName?: string }>("/api/features", fetcher);
  const { data: tok } = useSWR<{ tokens: { id: string }[] }>("/api/tokens", fetcher);
  const { data: settings } = useSWR<Settings>("/api/settings", fetcher);
  const { data: activity } = useSWR<{ activity: ActivityEntry[] }>("/api/activity?limit=8", fetcher, { refreshInterval: 15000 });
  const { data: stats } = useSWR<Stats>("/api/stats", fetcher);

  const active = repos?.active ?? null;
  const appName = feat?.appName || APP_NAME_FALLBACK;
  const tokenCount = tok?.tokens?.length ?? 0;

  // Toggle state mirrors saved settings; hydrate once they arrive.
  const [gitSyncOn, setGitSyncOn] = useState(false);
  const [curatorMode, setCuratorMode] = useState<"off" | "chat" | "full">("off");
  useEffect(() => {
    if (!settings) return;
    setGitSyncOn(settings.gitSyncEnabled);
    setCuratorMode(settings.curatorModeFlag);
  }, [settings]);

  // Inline search over the vault.
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses the home search (when not already typing somewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return;
      if (searchRef.current) {
        e.preventDefault();
        searchRef.current.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const d = await r.json();
        if (seq === searchSeq.current) setResults(d.results ?? []);
      } catch {
        if (seq === searchSeq.current) setResults([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  async function patch(body: Record<string, unknown>, ...keys: string[]) {
    await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    for (const k of keys) mutate(k);
  }
  function toggleGitSync(v: boolean) {
    setGitSyncOn(v);
    patch({ gitSyncEnabled: v }, "/api/settings", "/api/sync");
  }
  // The quick toggle only ever reaches "chat" — granting the Curator write access is a
  // deliberate choice, made on the Settings page.
  function toggleCurator(v: boolean) {
    const next = v ? "chat" : "off";
    setCuratorMode(next);
    patch({ curatorMode: next }, "/api/settings", "/api/features");
  }

  const recent = activity?.activity ?? [];
  const curatorOn = curatorMode !== "off";
  const curatorNeedsKey = curatorOn && !settings?.anthropicApiKeySet;

  // ── Nothing set up yet (no vault, Curator off) → focused onboarding. ──
  if (!active && (feat?.curator ?? "off") === "off") {
    return (
      <div className="scrollbar-none h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-2xl flex-col px-8 py-12">
          <div className="my-auto space-y-6">
            <div>
              <div className="flex items-center gap-2">
                <div className="size-2 rounded-full bg-primary" />
                <h1 className="text-lg font-semibold tracking-tight">{appName}</h1>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">
                A second brain your agents read and write — a git repo of markdown, live over MCP. Connect a vault to begin.
              </p>
            </div>
            <div className="space-y-2.5">
              <LinkPillar
                icon={<GitBranch size={16} />}
                title="Vault"
                ok={false}
                state="not connected"
                desc="Connect a git repo of markdown — the source of truth for humans and agents. Start here."
                href="/workspaces"
                cta="Connect a repo"
              />
              <LinkPillar
                icon={<Plug size={16} />}
                title="Agents"
                ok={tokenCount > 0}
                state={tokenCount > 0 ? `${tokenCount} token${tokenCount === 1 ? "" : "s"}` : "none yet"}
                desc="Point Claude Code, Cursor, Hermes, or Claude.ai at the MCP endpoint to read + write this brain."
                href="/connect"
                cta={tokenCount > 0 ? "Manage" : "Connect an agent"}
              />
              <TogglePillar
                icon={<Brain size={16} />}
                title="Curator"
                ok={false}
                state={curatorNeedsKey ? "needs API key" : "off · optional"}
                desc="An optional chat agent that reads your notes to answer. Turn it on anytime; it starts read-only."
                on={curatorOn}
                onToggle={toggleCurator}
                footer={
                  curatorNeedsKey ? (
                    <>
                      Add your Anthropic API key in{" "}
                      <Link href="/settings" className="text-foreground underline underline-offset-2">Settings</Link> to activate it.
                    </>
                  ) : undefined
                }
              />
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Press <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px]">⌘K</kbd> to search the sample vault.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Set up → a persistent toolbar (git sync + Curator, always here) over the mode content. ──
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-2.5">
        <div className="flex items-center gap-2">
          <div className="size-2 rounded-full bg-primary" />
          <span className="text-sm font-medium">{appName}</span>
        </div>
        {stats && (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {stats.notes} notes · {stats.folders} folders · {stats.links} links
          </span>
        )}
        <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5" title="Auto commit + push the vault to its remote">
            <Switch size="sm" checked={gitSyncOn} onCheckedChange={toggleGitSync} aria-label="Git sync" />
            <span>Git sync</span>
          </div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
            title="Engram's built-in harness — its own agent over your vault. Agents' write access is set per token, on Connect."
          >
            <span>
              Curator ·{" "}
              <span className={curatorOn ? "text-foreground" : undefined}>{feat?.curator ?? curatorMode}</span>
              {curatorNeedsKey && <span className="text-amber-500"> · needs key</span>}
            </span>
          </Link>
          <Link href="/settings" className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
            <SettingsIcon size={13} /> Settings
          </Link>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {feat?.harness ? (
          <CuratorChat />
        ) : (
          <div className="scrollbar-none h-full overflow-y-auto">
            <div data-arrow-nav className="mx-auto max-w-2xl px-8 py-10">
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && results.length > 0) {
                      e.preventDefault();
                      router.push(`/n/${results[0].path}`);
                    }
                  }}
                  data-nav-item
                  placeholder="Search your brain…"
                  className="h-11 pl-9 text-sm"
                  aria-label="Search your brain"
                />
              </div>

              {q.trim() ? (
                <div className="mt-3 overflow-hidden rounded-lg border border-border">
                  {results.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-muted-foreground">{searching ? "Searching…" : "No matches."}</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {results.slice(0, 10).map((r) => (
                        <li key={r.path}>
                          <Link href={`/n/${r.path}`} data-nav-item className={`flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-accent/60 ${navItemClass}`}>
                            <span className="size-1.5 shrink-0 rounded-full" style={{ background: folderColor(r.folder) }} />
                            <span className="truncate text-sm">{r.title}</span>
                            <span className="ml-auto max-w-[45%] shrink-0 truncate font-mono text-xs text-muted-foreground">{r.path}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <div className="mt-8 space-y-8">
                  <RecentNotes heading="Jump back in" />
                  {recent.length > 0 && (
                    <section>
                      <div className="mb-1 flex items-center justify-between">
                        <h2 className="text-sm font-medium">Recent activity</h2>
                        <Link href="/activity" className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
                          View all <ArrowRight size={12} />
                        </Link>
                      </div>
                      <ActivityList entries={recent} />
                    </section>
                  )}
                  <p className="text-center text-[11px] text-muted-foreground/70">
                    <kbd className="rounded border border-border px-1 font-mono">/</kbd> search ·{" "}
                    <kbd className="rounded border border-border px-1 font-mono">↑</kbd>
                    <kbd className="rounded border border-border px-1 font-mono">↓</kbd> navigate ·{" "}
                    <kbd className="rounded border border-border px-1 font-mono">↵</kbd> open
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
