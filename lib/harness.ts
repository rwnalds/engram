import { ANTHROPIC_API_KEY, CAPTURE_MODEL, HARNESS_ENABLED } from "@/lib/config";
import { getTree, listNotes, readVaultFile } from "@/lib/vault/store";
import { writeNote } from "@/lib/vault/write";

export interface CaptureResult {
  path: string;
  title: string;
  reasoning?: string;
}

/** Distinct top-level folders currently in the vault. */
function folderList(): string[] {
  const set = new Set<string>();
  for (const n of listNotes()) if (n.folder !== "root") set.add(n.folder);
  for (const c of getTree().children ?? []) if (c.type === "dir") set.add(c.name);
  return [...set].sort();
}

const SYSTEM = `You file rough notes into a markdown "second brain". Given the vault's SCHEMA and its current folders, decide where a rough note belongs and rewrite it as a clean, well-structured note.

Return ONLY a JSON object, no prose, no code fences:
{"path":"folder/kebab-slug.md","frontmatter":{"title":"...","type":"...","tags":["..."],"status":"...","created":"YYYY-MM-DD"},"body":"markdown body","reasoning":"one short sentence on why this path"}

Rules:
- Follow the SCHEMA conventions. Prefer an EXISTING folder when it fits; only invent a new folder if clearly needed.
- kebab-case slug. Dailies -> daily/YYYY-MM-DD.md. Decisions -> decisions/<topic>-YYYY-MM-DD.md. People -> people/<first>[-<org>].md. Clients -> clients/<slug>/<slug>.md.
- Keep the user's facts; just structure them. Body must NOT repeat the title as a leading H1 and must NOT include frontmatter.`;

function extractJson(text: string): { path: string; frontmatter?: Record<string, unknown>; body?: string; reasoning?: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("model returned no JSON");
  return JSON.parse(text.slice(start, end + 1));
}

/** Take a rough dump, let the model decide the path + frontmatter, and write the note. */
export async function captureNote(rough: string): Promise<CaptureResult> {
  if (!HARNESS_ENABLED)
    throw new Error("brain_capture is off — set HARNESS_ENABLED=true and ANTHROPIC_API_KEY to enable the auto-filing harness");
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const today = new Date().toISOString().slice(0, 10);
  const schema = readVaultFile("SCHEMA.md") ?? "(no SCHEMA.md)";
  const user = `Today is ${today}.\nExisting folders: ${folderList().join(", ") || "(none yet)"}\n\nSCHEMA:\n${schema}\n\nRough note to file:\n"""\n${rough}\n"""`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CAPTURE_MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text: string = data?.content?.[0]?.text ?? "";
  const parsed = extractJson(text);
  if (!parsed.path) throw new Error("model did not return a path");

  const savedPath = await writeNote(parsed.path, parsed.body ?? "", parsed.frontmatter ?? {});
  return {
    path: savedPath,
    title: (parsed.frontmatter?.title as string) ?? savedPath,
    reasoning: parsed.reasoning,
  };
}
