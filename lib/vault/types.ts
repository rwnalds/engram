export interface NoteMeta {
  /** Relative POSIX path from the vault root, e.g. "decisions/foo-2026-07-09.md". */
  path: string;
  /** Filename without the .md extension (used for wikilink resolution). */
  slug: string;
  title: string;
  /** Top-level folder, or "root" for a file at the vault root. */
  folder: string;
  type?: string;
  tags: string[];
  /** Alternate names/synonyms for this note, from `aliases:`. Indexed like the title. */
  aliases: string[];
  status?: string;
  created?: string;
  updated?: string;
  frontmatter: Record<string, unknown>;
  mtimeMs: number;
}

export interface Note extends NoteMeta {
  /** Markdown body without frontmatter. */
  body: string;
  /** Full file content including frontmatter. */
  raw: string;
}

export interface RawLink {
  target: string;
  alias?: string;
  source: "body" | "related";
}

export interface GraphNode {
  id: string; // path
  label: string;
  folder: string;
  type?: string;
  degree: number;
}
export interface GraphEdge {
  source: string;
  target: string;
}
export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  title?: string;
  children?: TreeNode[];
}
