"use client";

import useSWR, { useSWRConfig } from "swr";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Search, Network, FilePlus } from "lucide-react";
import { fetcher, type TreeNode } from "@/lib/client";
import { Tree } from "./tree";
import { ThemeToggle } from "./theme-toggle";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Cortex";

export function Sidebar() {
  const { data } = useSWR<{ tree: TreeNode }>("/api/tree", fetcher, { refreshInterval: 5000 });
  const { mutate } = useSWRConfig();
  const pathname = usePathname();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const activePath = pathname.startsWith("/n/") ? decodeURIComponent(pathname.slice(3)) : undefined;

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
    if (d.path) {
      mutate("/api/tree");
      mutate("/api/notes");
      router.push(`/n/${d.path}`);
    }
  }

  return (
    <aside className="flex h-dvh w-64 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <div className="size-2 rounded-full bg-primary" />
        <span className="text-sm font-medium tracking-tight">{APP_NAME}</span>
      </div>
      <div className="flex gap-1 px-2 pb-2">
        <button
          onClick={() => (window as unknown as { __openPalette?: () => void }).__openPalette?.()}
          className="flex flex-1 items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Search size={13} /> Search
          <kbd className="ml-auto font-mono text-[10px] opacity-60">⌘K</kbd>
        </button>
        <button
          onClick={() => setCreating((c) => !c)}
          title="New note"
          className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground"
        >
          <FilePlus size={14} />
        </button>
        <Link
          href="/graph"
          title="Graph"
          className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground"
        >
          <Network size={14} />
        </Link>
      </div>
      {creating && (
        <div className="px-2 pb-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") {
                setCreating(false);
                setName("");
              }
            }}
            placeholder="folder/name.md"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
      )}
      <nav className="scrollbar-none flex-1 overflow-y-auto px-1">
        {data ? (
          <Tree tree={data.tree} activePath={activePath} />
        ) : (
          <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>
        )}
      </nav>
      <div className="flex items-center justify-end border-t border-border px-2 py-1.5">
        <ThemeToggle />
      </div>
    </aside>
  );
}
