"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
} from "d3-force";
import { fetcher, folderColor, type Graph } from "@/lib/client";

interface SimNode {
  id: string;
  label: string;
  folder: string;
  degree: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}
interface SimLink {
  source: SimNode | string;
  target: SimNode | string;
}

const nodeRadius = (d: SimNode) => 3 + Math.sqrt(d.degree) * 1.8;

export function GraphView() {
  const { data } = useSWR<Graph>("/api/graph", fetcher);
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);

  const [dims, setDims] = useState({ w: 800, h: 600 });
  const [, setTick] = useState(0);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ id: string | null; moved: boolean }>({ id: null, moved: false });
  const pan = useRef<{ active: boolean; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDims({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!data) return;
    const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
    const links: SimLink[] = data.edges.map((e) => ({ source: e.source, target: e.target }));
    nodesRef.current = nodes;
    linksRef.current = links;
    const sim = forceSimulation<SimNode>(nodes)
      .force("link", forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(55).strength(0.35))
      .force("charge", forceManyBody().strength(-140))
      .force("center", forceCenter(dims.w / 2, dims.h / 2))
      .force("collide", forceCollide<SimNode>().radius((d) => nodeRadius(d) + 4));
    sim.on("tick", () => setTick((t) => (t + 1) % 1_000_000));
    simRef.current = sim;
    return () => {
      sim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    simRef.current?.force("center", forceCenter(dims.w / 2, dims.h / 2));
    simRef.current?.alpha(0.3).restart();
  }, [dims.w, dims.h]);

  function toSim(clientX: number, clientY: number) {
    const rect = wrapRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k };
  }

  // Native, non-passive wheel listener so preventDefault actually stops the
  // browser page-zoom (Mac trackpad pinch arrives as ctrlKey+wheel).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.ctrlKey ? Math.exp(-e.deltaY * 0.012) : e.deltaY < 0 ? 1.1 : 0.9;
      setView((v) => {
        const k = Math.min(4, Math.max(0.2, v.k * factor));
        return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const nodes = nodesRef.current;
  const links = linksRef.current;

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full touch-none overflow-hidden overscroll-none"
      onPointerDown={(e) => {
        pan.current = { active: true, x: e.clientX - view.x, y: e.clientY - view.y };
      }}
      onPointerMove={(e) => {
        if (drag.current.id) {
          drag.current.moved = true;
          const p = toSim(e.clientX, e.clientY);
          const n = nodes.find((nn) => nn.id === drag.current.id);
          if (n) {
            n.fx = p.x;
            n.fy = p.y;
            simRef.current?.alphaTarget(0.3).restart();
          }
        } else if (pan.current?.active) {
          // Capture now — the setView updater runs later (batched), by which point a
          // pointerup may have nulled pan.current (crash: "can't access property x").
          const px = pan.current.x;
          const py = pan.current.y;
          setView((v) => ({ ...v, x: e.clientX - px, y: e.clientY - py }));
        }
      }}
      onPointerUp={() => {
        if (drag.current.id) {
          const n = nodes.find((nn) => nn.id === drag.current.id);
          if (n) {
            n.fx = null;
            n.fy = null;
          }
          simRef.current?.alphaTarget(0);
          drag.current = { id: null, moved: false };
        }
        pan.current = null;
      }}
    >
      <svg width={dims.w} height={dims.h} className="block cursor-grab active:cursor-grabbing">
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {links.map((l, i) => {
            const s = l.source as SimNode;
            const t = l.target as SimNode;
            if (s.x == null || t.x == null) return null;
            return (
              <line
                key={i}
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke="currentColor"
                className="text-border"
                strokeWidth={0.6 / view.k}
                opacity={0.6}
              />
            );
          })}
          {nodes.map((n) => {
            if (n.x == null) return null;
            const r = nodeRadius(n);
            const showLabel = hover === n.id || n.degree >= 6;
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`}>
                <circle
                  r={r}
                  fill={folderColor(n.folder)}
                  stroke="var(--background)"
                  strokeWidth={1 / view.k}
                  className="cursor-pointer"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    drag.current = { id: n.id, moved: false };
                  }}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    if (!drag.current.moved) router.push(`/n/${n.id}`);
                    const nn = nodes.find((x) => x.id === n.id);
                    if (nn) {
                      nn.fx = null;
                      nn.fy = null;
                    }
                    simRef.current?.alphaTarget(0);
                    drag.current = { id: null, moved: false };
                  }}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
                />
                {showLabel && (
                  <text
                    x={r + 3}
                    y={3}
                    fontSize={11 / view.k}
                    className="pointer-events-none select-none fill-foreground"
                  >
                    {n.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="pointer-events-none absolute bottom-3 left-3 text-xs text-muted-foreground">
        {nodes.length} notes · {links.length} links · scroll to zoom, drag to pan
      </div>
    </div>
  );
}
