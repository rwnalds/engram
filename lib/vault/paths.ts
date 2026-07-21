import path from "node:path";

/**
 * Resolve a vault-relative path to an absolute one, refusing anything that escapes the vault.
 *
 * The write path has always had this guard. The read path did not, and `getNote` takes its
 * argument straight from `brain_read` — so `brain_read({ path: "../../../../etc/passwd" })`
 * read whatever the process could read. `brain_read` is a READ-scoped tool, which made this
 * reachable with a read-only token: the exact token you hand an agent you don't fully trust,
 * and the one the README promises is safe. On a deployed instance the reachable set included
 * /proc/self/environ (AUTH_SECRET, OAuth client secrets, the Anthropic key) and the token
 * hashes under ENGRAM_DATA_DIR.
 *
 * Every filesystem access derived from caller input goes through here. `path.resolve` collapses
 * `..` before the check, so no traversal survives it, and the prefix test uses path.sep to avoid
 * matching a sibling directory that merely shares a name prefix (`/vault-backup` vs `/vault`).
 */
export function resolveInVault(vaultDir: string, relPath: string): string {
  const root = path.resolve(vaultDir);
  const abs = path.resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`path escapes the vault: ${relPath}`);
  }
  return abs;
}

/** Non-throwing variant for read paths that already return null on a miss. */
export function tryResolveInVault(vaultDir: string, relPath: string): string | null {
  try {
    return resolveInVault(vaultDir, relPath);
  } catch {
    return null;
  }
}
