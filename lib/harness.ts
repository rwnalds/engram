import { agentStream, captureContext, type Manifest } from "@/lib/agent";
import { anthropicApiKey, captureModel, harnessEnabled } from "@/lib/settings";
import { currentActor } from "@/lib/actor";

export interface CaptureResult extends Manifest {
  /** One sentence from the loop on what it did and why. */
  summary: string;
  /** The note a caller should open — the primary thing this capture produced. */
  path: string;
}

/**
 * `brain_capture` — hand over a rough dump and let the vault file it.
 *
 * This used to be a single blind model call: pick a path, write the note, overwrite whatever
 * lived there. It now runs the shared agent loop, which must search before it files, must read
 * a note before overwriting it, may archive but never delete, and reports a manifest of what it
 * actually touched — because the caller delegated the decision and deserves to see the outcome.
 */
export async function captureNote(rough: string): Promise<CaptureResult> {
  if (!harnessEnabled())
    throw new Error("brain_capture is off — set the Curator to Full in Settings (needs an Anthropic API key).");
  if (!anthropicApiKey()) throw new Error("Anthropic API key not set (Settings → Curator).");
  if (!rough.trim()) throw new Error("Nothing to capture.");

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Today is ${today}.\n\n${captureContext()}\n\nRough note to file:\n"""\n${rough}\n"""`;

  let summary = "";
  let manifest: Manifest = { created: [], updated: [], appended: [], moved: [] };
  let failure = "";

  for await (const ev of agentStream({
    profile: "capture",
    messages: [{ role: "user", content: prompt }],
    canWrite: true,
    model: captureModel(),
    maxTurns: 8,
    // Credit the agent that handed us the dump, not the loop that filed it.
    actor: `${currentActor()} via capture`,
  })) {
    if (ev.type === "text") summary += ev.text;
    else if (ev.type === "manifest") manifest = ev.manifest;
    else if (ev.type === "error") failure = ev.message;
  }

  if (failure) throw new Error(failure);

  // The dashboard opens one note after a capture; prefer what was created, then what was changed.
  const primary =
    manifest.created[0] ?? manifest.updated[0] ?? manifest.appended[0] ?? manifest.moved[0] ?? "";
  if (!primary) {
    throw new Error(`capture wrote nothing. The model said: ${summary.trim() || "(nothing)"}`);
  }
  return { ...manifest, summary: summary.trim(), path: primary };
}
