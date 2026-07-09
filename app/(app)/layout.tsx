"use client";

import { Sidebar } from "@/components/sidebar";
import { CommandPalette } from "@/components/command-palette";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <main className="relative flex-1 overflow-hidden">{children}</main>
      <CommandPalette />
    </div>
  );
}
