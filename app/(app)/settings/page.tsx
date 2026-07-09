"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Check } from "lucide-react";
import { fetcher } from "@/lib/client";

interface PublicSettings {
  appName: string;
  gitSyncEnabled: boolean;
  gitAuthorName: string;
  gitAuthorEmail: string;
  harnessEnabledFlag: boolean;
  harnessEffective: boolean;
  captureModel: string;
  anthropicApiKeySet: boolean;
  githubClientId: string;
  githubClientSecretSet: boolean;
  envManaged: Record<string, boolean>;
}

const input =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:border-ring";
const label = "text-xs font-medium text-muted-foreground";

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? "bg-primary" : "bg-muted"}`}
    >
      <span className={`inline-block size-3.5 rounded-full bg-background transition-transform ${on ? "translate-x-4" : "translate-x-1"}`} />
    </button>
  );
}

function Field({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const { data } = useSWR<PublicSettings>("/api/settings", fetcher);
  const { mutate } = useSWRConfig();

  const [appNameV, setAppName] = useState("");
  const [gitSync, setGitSync] = useState(false);
  const [gitName, setGitName] = useState("");
  const [gitEmail, setGitEmail] = useState("");
  const [harness, setHarness] = useState(false);
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [ghId, setGhId] = useState("");
  const [ghSecret, setGhSecret] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Hydrate the form once settings arrive (secrets stay blank — write-only).
  useEffect(() => {
    if (!data) return;
    setAppName(data.appName);
    setGitSync(data.gitSyncEnabled);
    setGitName(data.gitAuthorName);
    setGitEmail(data.gitAuthorEmail);
    setHarness(data.harnessEnabledFlag);
    setModel(data.captureModel);
    setGhId(data.githubClientId);
  }, [data]);

  async function save() {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    const patch: Record<string, unknown> = {
      appName: appNameV,
      gitSyncEnabled: gitSync,
      gitAuthorName: gitName,
      gitAuthorEmail: gitEmail,
      harnessEnabled: harness,
      captureModel: model,
      githubClientId: ghId,
    };
    if (apiKey.trim()) patch.anthropicApiKey = apiKey.trim();
    if (ghSecret.trim()) patch.githubClientSecret = ghSecret.trim();
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      setApiKey("");
      setGhSecret("");
      mutate("/api/settings");
      mutate("/api/features");
      mutate("/api/github/status");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function clearSecret(field: "clearAnthropicApiKey" | "clearGithubClientSecret") {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [field]: true }),
    });
    mutate("/api/settings");
    mutate("/api/features");
  }

  if (!data) {
    return <div className="px-8 py-10 text-sm text-muted-foreground">Loading…</div>;
  }

  const envHint = (k: string) => (data.envManaged[k] ? "Currently inherited from an env var — saving here overrides it." : undefined);

  return (
    <div className="scrollbar-none h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Configure runtime behavior here instead of on the host — saved values override the matching
          env var and take effect without a redeploy. Secrets are stored encrypted at rest.
        </p>

        {/* General */}
        <section className="mt-8 space-y-4 border-t border-border pt-6">
          <h2 className="text-sm font-medium">General</h2>
          <Field hint={envHint("appName") ?? "Shown in the sidebar and browser tab."}>
            <span className={label}>App name</span>
            <input value={appNameV} onChange={(e) => setAppName(e.target.value)} placeholder="Engram" className={input} />
          </Field>
        </section>

        {/* Git sync */}
        <section className="mt-6 space-y-4 border-t border-border pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">Git sync</h2>
              <p className="text-xs text-muted-foreground">Auto commit + push the active vault to its remote.</p>
            </div>
            <Toggle on={gitSync} onChange={setGitSync} />
          </div>
          {gitSync && (
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <span className={label}>Commit author name</span>
                <input value={gitName} onChange={(e) => setGitName(e.target.value)} placeholder="Engram" className={input} />
              </Field>
              <Field>
                <span className={label}>Commit author email</span>
                <input value={gitEmail} onChange={(e) => setGitEmail(e.target.value)} placeholder="engram@localhost" className={input} />
              </Field>
            </div>
          )}
        </section>

        {/* AI capture / harness */}
        <section className="mt-6 space-y-4 border-t border-border pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">Curator</h2>
              <p className="text-xs text-muted-foreground">
                The in-app chat agent that reads your notes to answer, plus auto-filing of rough dumps
                (brain_capture). Off by default — runs on your Anthropic key.
              </p>
            </div>
            <Toggle on={harness} onChange={setHarness} />
          </div>
          {harness && (
            <div className="space-y-3">
              <Field
                hint={
                  data.anthropicApiKeySet
                    ? "A key is set. Type a new value to replace it."
                    : envHint("anthropicApiKey") ?? "Required to enable capture."
                }
              >
                <span className={label}>
                  Anthropic API key {data.anthropicApiKeySet && <span className="text-primary">• set</span>}
                </span>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={data.anthropicApiKeySet ? "••••••••••••••••" : "sk-ant-…"}
                    className={input}
                  />
                  {data.anthropicApiKeySet && (
                    <button
                      onClick={() => clearSecret("clearAnthropicApiKey")}
                      className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-destructive"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </Field>
              <Field>
                <span className={label}>Capture model</span>
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-haiku-4-5-20251001" className={input} />
              </Field>
              {harness && !data.anthropicApiKeySet && !apiKey.trim() && (
                <p className="text-[11px] text-amber-500">Capture stays off until an Anthropic key is saved.</p>
              )}
            </div>
          )}
        </section>

        {/* GitHub OAuth (repo connect) */}
        <section className="mt-6 space-y-4 border-t border-border pt-6">
          <div>
            <h2 className="text-sm font-medium">GitHub (repo connect)</h2>
            <p className="text-xs text-muted-foreground">
              OAuth app for the “Connect GitHub” flow in Workspaces. Optional — you can also add a repo by
              URL + token. Callback: <code className="rounded bg-muted px-1">{"<app-url>"}/api/github/callback</code>
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field hint={envHint("githubClientId")}>
              <span className={label}>Client ID</span>
              <input value={ghId} onChange={(e) => setGhId(e.target.value)} placeholder="Iv1.…" className={input} />
            </Field>
            <Field hint={data.githubClientSecretSet ? "A secret is set. Type a new value to replace it." : undefined}>
              <span className={label}>
                Client secret {data.githubClientSecretSet && <span className="text-primary">• set</span>}
              </span>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={ghSecret}
                  onChange={(e) => setGhSecret(e.target.value)}
                  placeholder={data.githubClientSecretSet ? "••••••••••••••••" : "secret"}
                  className={input}
                />
                {data.githubClientSecretSet && (
                  <button
                    onClick={() => clearSecret("clearGithubClientSecret")}
                    className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-destructive"
                  >
                    Remove
                  </button>
                )}
              </div>
            </Field>
          </div>
        </section>

        {/* Env-only note */}
        <section className="mt-6 border-t border-border pt-6">
          <p className="text-xs text-muted-foreground">
            Set on the host (bootstrap / security): <code className="rounded bg-muted px-1">AUTH_SECRET</code>,{" "}
            <code className="rounded bg-muted px-1">APP_URL</code>, <code className="rounded bg-muted px-1">ALLOWED_EMAILS</code>,{" "}
            <code className="rounded bg-muted px-1">GOOGLE_CLIENT_ID/SECRET</code>,{" "}
            <code className="rounded bg-muted px-1">ENGRAM_DATA_DIR</code>. These gate login itself, so they can’t live behind it.
          </p>
        </section>

        <div className="sticky bottom-0 mt-8 flex items-center gap-3 border-t border-border bg-background/80 py-4 backdrop-blur">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saved && <Check size={14} />}
            {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
