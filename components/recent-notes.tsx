"use client";

import Link from "next/link";
import useSWR from "swr";
import { fetcher, folderColor } from "@/lib/client";
import { useRecents } from "@/lib/recents";
import { navItemClass } from "@/lib/use-arrow-nav";

/** "Jump back in" — the notes you viewed most recently (from localStorage). Renders nothing when empty. */
export function RecentNotes({ heading = "Jump back in", limit = 6 }: { heading?: string; limit?: number }) {
  const recents = useRecents();
  // Hide recents that aren't in the current vault (deleted, or a different workspace) so a
  // stale entry never leads to a 404. Reuses the cached notes list (SWR dedupes it).
  const { data: all } = useSWR<{ notes: { path: string }[] }>("/api/notes", fetcher);
  const valid = all ? new Set(all.notes.map((n) => n.path)) : null;
  const items = (valid ? recents.filter((r) => valid.has(r.path)) : recents).slice(0, limit);
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">{heading}</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((r) => {
          const folder = r.folder || (r.path.includes("/") ? r.path.split("/")[0] : "root");
          return (
            <Link
              key={r.path}
              href={`/n/${r.path}`}
              data-nav-item
              className={`flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 transition-colors hover:border-ring ${navItemClass}`}
            >
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: folderColor(folder) }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{r.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{folder}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
