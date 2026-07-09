// Runs once when the server starts. Used to clone the remote vault into VAULT_DIR
// on first boot (production). No-op unless GIT_SYNC_ENABLED + GIT_REMOTE are set.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureVaultRepo } = await import("@/lib/git");
  await ensureVaultRepo();
}
