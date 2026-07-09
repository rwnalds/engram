"use client";

import { useEffect } from "react";

/** Scopes graph-render errors to this segment so a crash here doesn't blank the whole app. */
export default function GraphError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[graph] render error", error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm text-muted-foreground">The graph hit a snag rendering.</p>
      <button
        onClick={reset}
        className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
      >
        Reload graph
      </button>
    </div>
  );
}
