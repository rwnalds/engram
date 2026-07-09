"use client";

import { useEffect } from "react";

/**
 * Shared focus ring for keyboard-navigable items. Applied alongside `data-nav-item`.
 * focus-visible so a mouse click doesn't light it up, only keyboard focus.
 */
export const navItemClass = "outline-none focus-visible:ring-2 focus-visible:ring-ring/70";

/**
 * App-wide arrow-key navigation, opt-in per section. Call once (in the app layout); it adds a
 * single document listener. It only acts when focus is inside an element marked
 * `[data-arrow-nav]`, moving focus between that section's `[data-nav-item]` elements:
 *   ↑/↓            move up/down (also works from a single-line search input → into the list)
 *   Home/End       jump to first/last  (skipped while typing in an input)
 *   j/k            vim down/up         (skipped while typing in an input)
 * Enter is left to the item itself (links navigate, buttons toggle). Multi-line editors
 * (textarea / contenteditable) are never hijacked.
 */
export function useArrowNav() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (!active) return;
      if (active.tagName === "TEXTAREA" || active.isContentEditable) return; // leave editors alone
      const inInput = active.tagName === "INPUT";

      let dir: 1 | -1 | "first" | "last" | null = null;
      if (e.key === "ArrowDown") dir = 1;
      else if (e.key === "ArrowUp") dir = -1;
      else if (!inInput && e.key === "Home") dir = "first";
      else if (!inInput && e.key === "End") dir = "last";
      else if (!inInput && e.key === "j") dir = 1;
      else if (!inInput && e.key === "k") dir = -1;
      if (dir === null) return;

      const container = active.closest<HTMLElement>("[data-arrow-nav]");
      if (!container) return;
      const items = Array.from(container.querySelectorAll<HTMLElement>("[data-nav-item]")).filter(
        (n) => n.offsetParent !== null || n === active,
      );
      if (items.length === 0) return;

      const idx = items.indexOf(active);
      let next: number;
      if (dir === "first") next = 0;
      else if (dir === "last") next = items.length - 1;
      else if (dir === 1) next = idx < 0 ? 0 : Math.min(idx + 1, items.length - 1);
      else next = idx < 0 ? 0 : Math.max(idx - 1, 0);

      e.preventDefault();
      items[next]?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
