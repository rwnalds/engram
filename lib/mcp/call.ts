import { TOOL_MAP, type Tool } from "./tools";

/**
 * The dispatch boundary: validate a tool call's arguments against the tool's OWN inputSchema,
 * then run it.
 *
 * Why this exists — the 2026-08-06 incident. `brain_append` takes `text`; its siblings
 * `brain_write` and `brain_edit` take `content`. A caller sent `content` to `brain_append`.
 * Nothing validated arguments, so the handler destructured `text` as `undefined`,
 * `String(undefined ?? "")` collapsed to `""`, and the note was "appended" with a single blank
 * line — five times, each reported as `{ ok: true }`. The vault's own git history is the receipt:
 * five commits, `+1 line (0 non-blank)` each.
 *
 * Handlers coerce with `String(x)`, which turns a missing argument into the string "undefined" —
 * that is how `brain_move` without `to` renamed a live note to `undefined.md` and reported success.
 * Coercion cannot be made safe one handler at a time; the schema is the contract, so it is
 * enforced here, once, before any handler runs.
 *
 * Strict about unknown keys on purpose. An argument the server silently ignores is an argument the
 * caller believed it had sent, and this failure mode is exactly that bug with a different name.
 * The error names the parameters the tool does accept, so a model can retry correctly first time.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Args = Record<string, any>;

interface PropSchema {
  type?: string;
}
interface ToolSchema {
  properties?: Record<string, PropSchema>;
  required?: string[];
}

/** MCP reserves `_`-prefixed keys for protocol metadata; they are not tool arguments. */
const isMeta = (k: string) => k.startsWith("_");

function typeMatches(expected: string | undefined, value: unknown): boolean {
  switch (expected) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    default:
      return true; // no declared type — nothing to check
  }
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Check `args` against `tool.inputSchema`. Returns an error message for the caller, or null when
 * the call is well-formed. The message is written for a model that has to fix its own call.
 */
export function validateArgs(tool: Tool, args: Args): string | null {
  const schema = tool.inputSchema as ToolSchema;
  const props = schema.properties ?? {};
  const accepted = Object.keys(props);
  const acceptedList = accepted.length > 0 ? accepted.join(", ") : "(none)";

  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return `${tool.name}: \`arguments\` must be an object with ${acceptedList}.`;
  }

  // Unknown keys first: when a caller sends `content` to a tool that wants `text`, naming the
  // mistake beats reporting the resulting "missing required" further down.
  const unknown = Object.keys(args).filter((k) => !isMeta(k) && !(k in props));
  if (unknown.length > 0) {
    return (
      `${tool.name} does not accept ${unknown.map((k) => `\`${k}\``).join(", ")}. ` +
      `Its parameters are: ${acceptedList}. Nothing was written — re-send the call with the ` +
      `payload under the right parameter name.`
    );
  }

  for (const key of schema.required ?? []) {
    const v = args[key];
    if (v === undefined || v === null) {
      return `${tool.name} requires \`${key}\`, which was missing. Its parameters are: ${acceptedList}. Nothing was written.`;
    }
  }

  for (const [key, value] of Object.entries(args)) {
    if (isMeta(key) || value === undefined || value === null) continue;
    const expected = props[key]?.type;
    if (!typeMatches(expected, value)) {
      return `${tool.name}: \`${key}\` must be a ${expected}, got ${describeType(value)}. Nothing was written.`;
    }
  }

  return null;
}

/**
 * Look up a tool, validate its arguments, and run it. Throws on an unknown tool or a call that
 * does not satisfy the tool's schema — the MCP route turns a throw into an `isError` result, so a
 * rejected call is visible to the caller instead of being reported as a successful write.
 *
 * Scope enforcement stays in the route: it depends on the authenticated caller, not the arguments.
 */
export async function callTool(name: string, args: Args): Promise<unknown> {
  const tool = TOOL_MAP.get(name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  const problem = validateArgs(tool, args ?? {});
  if (problem) throw new Error(problem);
  return await tool.handler(args ?? {});
}
