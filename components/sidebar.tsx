"use client";

import useSWR, { useSWRConfig } from "swr";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Search, FilePlus, Zap } from "lucide-react";
import { fetcher, type TreeNode } from "@/lib/client";
import { Tree } from "./tree";
import { WorkspaceSwitcher } from "./workspace-switcher";

const FALLBACK_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Engram";

export function Sidebar() {
  const { data } = useSWR<{ tree: TreeNode }>("/api/tree", fetcher, { refreshInterval: 5000 });
  const { data: feat } = useSWR<{ harness?: boolean; appName?: string }>("/api/features", fetcher);
  const appName = feat?.appName || FALLBACK_NAME;
  const { mutate } = useSWRConfig();
  const pathname = usePathname();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [dump, setDump] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const activePath = pathname.startsWith("/n/") ? decodeURIComponent(pathname.slice(3)) : undefined;

  function refreshTo(path?: string) {
    mutate("/api/tree");
    mutate("/api/notes");
    if (path) router.push(`/n/${path}`);
  }

  async function create() {
    const p = name.trim();
    if (!p) {
      setCreating(false);
      return;
    }
    const slug = p.split("/").pop()?.replace(/\.md$/i, "") ?? p;
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: p, body: `# ${slug}\n` }),
    });
    const d = await res.json().catch(() => ({}));
    setCreating(false);
    setName("");
    if (d.path) refreshTo(d.path);
  }

  async function capture() {
    const t = dump.trim();
    if (!t) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: t }),
      });
      const d = await res.json();
      if (res.ok && d.path) {
        setCapturing(false);
        setDump("");
        refreshTo(d.path);
      } else {
        setErr(d.error || "capture failed");
      }
    } catch {
      setErr("capture failed");
    } finally {
      setBusy(false);
    }
  }

  const iconBtn = "inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground";

  return (
    <aside className="flex h-dvh w-64 shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Hidden on mobile — the mobile top bar already shows the app name + search. */}
      <div className="hidden h-12 shrink-0 items-center gap-2 px-3 md:flex">
        <div className="size-2 rounded-full bg-primary" />
        <span className="text-sm font-medium tracking-tight">{appName}</span>
      </div>

      <WorkspaceSwitcher />

      <div className="flex gap-1 px-2 pb-2 pt-2 md:pt-0">
        <button
          onClick={() => (window as unknown as { __openPalette?: () => void }).__openPalette?.()}
          className="hidden flex-1 items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground md:flex"
        >
          <Search size={13} /> Search
          <kbd className="ml-auto font-mono text-[10px] opacity-60">⌘K</kbd>
        </button>
        {feat?.harness && (
          <button onClick={() => { setCapturing((c) => !c); setCreating(false); }} title="Quick capture" className={iconBtn}>
            <Zap size={14} />
          </button>
        )}
        <button onClick={() => { setCreating((c) => !c); setCapturing(false); }} title="New note" className={iconBtn}>
          <FilePlus size={14} />
        </button>
      </div>

      {creating && (
        <div className="px-2 pb-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") { setCreating(false); setName(""); }
            }}
            placeholder="folder/name.md"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
      )}

      {capturing && (
        <div className="px-2 pb-2">
          <textarea
            autoFocus
            value={dump}
            onChange={(e) => setDump(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) capture();
              if (e.key === "Escape") { setCapturing(false); setDump(""); setErr(""); }
            }}
            placeholder="Dump a rough note — the brain files it into the right place…"
            rows={4}
            className="scrollbar-none w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground"
          />
          <div className="mt-1 flex items-center gap-2">
            <button
              onClick={capture}
              disabled={busy}
              className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Filing…" : "File it"}
            </button>
            <span className="text-[10px] text-muted-foreground">⌘↵</span>
            {err && <span className="truncate text-[10px] text-destructive">{err}</span>}
          </div>
        </div>
      )}

      <nav className="scrollbar-none flex-1 overflow-y-auto px-1 pb-2">
        {data ? (
          <Tree tree={data.tree} activePath={activePath} />
        ) : (
          <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>
        )}
      </nav>
    </aside>
  );
}
