"use client";

import { ActivityBar } from "@/components/activity-bar";
import { Sidebar } from "@/components/sidebar";
import { CommandPalette } from "@/components/command-palette";
import { useArrowNav } from "@/lib/use-arrow-nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  useArrowNav();
  return (
    <div className="flex h-dvh overflow-hidden">
      <ActivityBar />
      <Sidebar />
      <main className="relative flex-1 overflow-hidden">{children}</main>
      <CommandPalette />
    </div>
  );
}
