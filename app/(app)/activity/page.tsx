"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/client";
import { ActivityList, type ActivityEntry } from "@/components/activity-list";

/** Full vault activity — every recent commit (agents + humans) to the connected repo. */
export default function ActivityPage() {
  const { data, isLoading } = useSWR<{ activity: ActivityEntry[] }>("/api/activity?limit=100", fetcher, {
    refreshInterval: 15000,
  });

  return (
    <div className="scrollbar-none h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          What agents and teammates have done to your brain, straight from the vault&apos;s git history.
        </p>
        <div className="mt-8" data-arrow-nav>
          {isLoading && !data ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <ActivityList entries={data?.activity ?? []} />
          )}
        </div>
      </div>
    </div>
  );
}
