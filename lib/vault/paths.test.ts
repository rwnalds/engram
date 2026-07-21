import { describe, expect, test } from "bun:test";
import path from "node:path";
import { resolveInVault, tryResolveInVault } from "./paths";

/**
 * Regression tests for the read-path traversal.
 *
 * `getNote` joined the caller's path onto the vault dir with no escape check, and `brain_read`
 * passes its argument straight through — so a READ-scoped token could read any file the process
 * could, including /proc/self/environ. These pin the guard that closed it.
 */

const VAULT = "/srv/vault";

describe("resolveInVault", () => {
  test("resolves an ordinary note", () => {
    expect(resolveInVault(VAULT, "docs/pricing.md")).toBe(path.join(VAULT, "docs/pricing.md"));
  });

  test("allows the vault root itself", () => {
    expect(resolveInVault(VAULT, ".")).toBe(VAULT);
  });

  test("refuses a parent-directory escape", () => {
    expect(() => resolveInVault(VAULT, "../secrets.txt")).toThrow(/escapes the vault/);
  });

  test("refuses a deep escape — the /etc/passwd case", () => {
    expect(() => resolveInVault(VAULT, "../../../../../../etc/passwd")).toThrow(/escapes the vault/);
  });

  test("refuses an escape hidden mid-path", () => {
    expect(() => resolveInVault(VAULT, "docs/../../etc/passwd")).toThrow(/escapes the vault/);
  });

  test("refuses /proc/self/environ — the credential-leak path", () => {
    expect(() => resolveInVault(VAULT, "../../../proc/self/environ")).toThrow(/escapes the vault/);
  });

  test("refuses a sibling directory that merely shares a name prefix", () => {
    // /srv/vault-backup must not pass a naive startsWith(root) check.
    expect(() => resolveInVault(VAULT, "../vault-backup/notes.md")).toThrow(/escapes the vault/);
  });

  test("an absolute path is contained, not honoured", () => {
    // path.resolve would escape on a truly absolute arg, so the guard has to catch it.
    expect(() => resolveInVault(VAULT, "/etc/passwd")).toThrow(/escapes the vault/);
  });

  test("a note whose name merely contains dots is fine", () => {
    expect(resolveInVault(VAULT, "docs/v1.2.3-notes.md")).toBe(path.join(VAULT, "docs/v1.2.3-notes.md"));
  });
});

describe("tryResolveInVault", () => {
  test("returns the path when safe", () => {
    expect(tryResolveInVault(VAULT, "a.md")).toBe(path.join(VAULT, "a.md"));
  });

  test("returns null instead of throwing on an escape", () => {
    expect(tryResolveInVault(VAULT, "../../etc/passwd")).toBeNull();
  });
});
