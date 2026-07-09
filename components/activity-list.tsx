"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, FileText, GitCommit } from "lucide-react";
import { timeAgo } from "@/lib/utils";
import { navItemClass } from "@/lib/use-arrow-nav";

export interface ActivityEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
}

interface CommitFile {
  status: string;
  path: string;
  oldPath?: string;
  diff: string;
  additions: number;
  deletions: number;
  binary: boolean;
}
interface CommitDetail {
  hash: string;
  message: string;
  author: string;
  date: string;
  files: CommitFile[];
  truncated: boolean;
}
type DetailState = CommitDetail | "loading" | "error" | undefined;

const STATUS_META: Record<string, { label: string; className: string }> = {
  A: { label: "added", className: "bg-emerald-500/15 text-emerald-500" },
  M: { label: "modified", className: "bg-amber-500/15 text-amber-500" },
  D: { label: "deleted", className: "bg-destructive/15 text-destructive" },
  R: { label: "renamed", className: "bg-blue-500/15 text-blue-400" },
  C: { label: "copied", className: "bg-blue-500/15 text-blue-400" },
  T: { label: "changed", className: "bg-muted text-muted-foreground" },
};

function diffLineClass(line: string): string {
  if (line.startsWith("@@")) return "text-blue-400 bg-blue-500/5";
  if (line.startsWith("+")) return "text-emerald-500 bg-emerald-500/5";
  if (line.startsWith("-")) return "text-destructive bg-destructive/5";
  return "text-muted-foreground";
}

/** Drop git metadata lines (diff --git / index / mode / ---/+++), keep hunks + content. */
function hunkLines(diff: string): string[] {
  return diff.split("\n").filter((l) => {
    if (/^diff --git /.test(l)) return false;
    if (/^index [0-9a-f]/.test(l)) return false;
    if (/^(new|deleted) file mode /.test(l)) return false;
    if (/^(old|new) mode /.test(l)) return false;
    if (/^similarity index /.test(l)) return false;
    if (/^(rename|copy) (from|to) /.test(l)) return false;
    if (/^--- /.test(l)) return false;
    if (/^\+\+\+ /.test(l)) return false;
    return true;
  });
}

function noteHref(f: CommitFile): string | null {
  return f.status !== "D" && f.path.toLowerCase().endsWith(".md") ? `/n/${f.path}` : null;
}

/** One file's diff card — status header + clean, colored hunks. */
function FileDiff({ f }: { f: CommitFile }) {
  const meta = STATUS_META[f.status] ?? STATUS_META.T;
  const href = noteHref(f);
  const lines = hunkLines(f.diff);
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.className}`} title={meta.label}>
            {meta.label}
          </span>
          <span className="truncate font-mono text-xs">{f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs">
          {(f.additions > 0 || f.deletions > 0) && (
            <span className="whitespace-nowrap">
              <span className="text-emerald-500">+{f.additions}</span> <span className="text-destructive">−{f.deletions}</span>
            </span>
          )}
          {href && (
            <Link href={href} className="inline-flex items-center gap-1 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground">
              <FileText size={12} /> Open
            </Link>
          )}
        </div>
      </div>
      {f.binary ? (
        <p className="px-3 py-2.5 text-xs text-muted-foreground">Binary file — not shown.</p>
      ) : lines.length === 0 ? (
        <p className="px-3 py-2.5 text-xs text-muted-foreground">No textual changes.</p>
      ) : (
        <div className="overflow-x-auto">
          <pre className="w-max min-w-full py-2 font-mono text-[11.5px] leading-relaxed">
            {lines.map((line, j) => (
              <div key={j} className={`px-3 ${diffLineClass(line)}`}>
                {line || " "}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}

function CommitFiles({ detail }: { detail: CommitDetail }) {
  if (detail.files.length === 0) return <p className="text-xs text-muted-foreground">No file changes.</p>;
  return (
    <div className="space-y-3">
      {detail.files.map((f, i) => (
        <FileDiff key={`${f.path}-${i}`} f={f} />
      ))}
      {detail.truncated && <p className="text-[11px] text-muted-foreground">Diff truncated — open the notes to see full content.</p>}
    </div>
  );
}

/** A commit feed for the vault — shared by the home preview and the full Activity page.
 *  Each row toggles an inline, per-file diff view (default collapsed, lazy-loaded on first open). */
export function ActivityList({ entries, empty }: { entries: ActivityEntry[]; empty?: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, DetailState>>({});

  async function toggle(hash: string) {
    const next = new Set(open);
    if (next.has(hash)) {
      next.delete(hash);
      setOpen(next);
      return;
    }
    next.add(hash);
    setOpen(next);
    if (details[hash] && details[hash] !== "error") return; // already loaded
    setDetails((d) => ({ ...d, [hash]: "loading" }));
    try {
      const res = await fetch(`/api/activity/${hash}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as CommitDetail;
      setDetails((d) => ({ ...d, [hash]: data }));
    } catch {
      setDetails((d) => ({ ...d, [hash]: "error" }));
    }
  }

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {empty ?? "No activity yet — changes agents and teammates make to your vault will show up here."}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {entries.map((e, i) => {
        const isOpen = open.has(e.hash);
        const detail = details[e.hash];
        return (
          <li key={`${e.hash}-${i}`} className="py-2.5">
            <button onClick={() => toggle(e.hash)} data-nav-item className={`group flex w-full items-start gap-3 rounded-md text-left ${navItemClass}`}>
              <span className="mt-0.5 shrink-0 text-muted-foreground">
                <GitCommit size={15} className={isOpen ? "hidden" : "block"} />
                <ChevronRight size={15} className={isOpen ? "block rotate-90 transition-transform" : "hidden"} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm group-hover:text-foreground">{e.message}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {e.author} · <span className="font-mono">{e.hash}</span> · {timeAgo(e.date)}
                </span>
              </span>
            </button>
            {isOpen && (
              <div className="mt-2.5 ml-[27px]">
                {detail === "loading" && <p className="text-xs text-muted-foreground">Loading changes…</p>}
                {detail === "error" && <p className="text-xs text-destructive">Couldn&apos;t load this commit&apos;s changes.</p>}
                {detail && detail !== "loading" && detail !== "error" && <CommitFiles detail={detail} />}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
