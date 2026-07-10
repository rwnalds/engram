"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Check } from "lucide-react";
import { fetcher } from "@/lib/client";
import { cn } from "@/lib/utils";
import { CURATOR_MODELS, DEFAULT_CAPTURE_MODEL } from "@/lib/models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type CuratorMode = "off" | "chat" | "full";

const CURATOR_MODES: { id: CuratorMode; label: string; blurb: string }[] = [
  { id: "off", label: "Off", blurb: "Engram never calls a model. A deterministic MCP server and dashboard." },
  { id: "chat", label: "Chat", blurb: "Ask questions of your vault in the dashboard. The model reads; it cannot write." },
  { id: "full", label: "Full", blurb: "Chat can edit notes, and agents can file rough dumps with brain_capture. Neither can delete." },
];

interface PublicSettings {
  appName: string;
  gitSyncEnabled: boolean;
  gitAuthorName: string;
  gitAuthorEmail: string;
  curatorModeFlag: CuratorMode;
  curatorMode: CuratorMode;
  captureModel: string;
  anthropicApiKeySet: boolean;
  githubClientId: string;
  githubClientSecretSet: boolean;
  envManaged: Record<string, boolean>;
}

function Field({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
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
  const [curator, setCurator] = useState<CuratorMode>("off");
  const [model, setModel] = useState<string>(DEFAULT_CAPTURE_MODEL);
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
    setCurator(data.curatorModeFlag);
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
      curatorMode: curator,
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
            <Label htmlFor="appName">App name</Label>
            <Input id="appName" value={appNameV} onChange={(e) => setAppName(e.target.value)} placeholder="Engram" />
          </Field>
        </section>

        {/* Git sync */}
        <section className="mt-6 space-y-4 border-t border-border pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">Git sync</h2>
              <p className="text-xs text-muted-foreground">Auto commit + push the active vault to its remote.</p>
            </div>
            <Switch checked={gitSync} onCheckedChange={setGitSync} />
          </div>
          {gitSync && (
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label htmlFor="gitName">Commit author name</Label>
                <Input id="gitName" value={gitName} onChange={(e) => setGitName(e.target.value)} placeholder="Engram" />
              </Field>
              <Field>
                <Label htmlFor="gitEmail">Commit author email</Label>
                <Input id="gitEmail" value={gitEmail} onChange={(e) => setGitEmail(e.target.value)} placeholder="engram@localhost" />
              </Field>
            </div>
          )}
        </section>

        {/* Curator */}
        <section className="mt-6 space-y-4 border-t border-border pt-6">
          <div>
            <h2 className="text-sm font-medium">Curator</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Whether Engram itself runs a model. It does <em>not</em> control whether your agents can
              edit the vault — a token&apos;s scope does, on the Connect page.
            </p>
          </div>

          <div className="inline-flex rounded-md border border-border p-0.5">
            {CURATOR_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setCurator(m.id)}
                className={cn(
                  "rounded px-4 py-1.5 text-xs font-medium transition-colors",
                  curator === m.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">{CURATOR_MODES.find((m) => m.id === curator)?.blurb}</p>

          {curator !== "off" && (
            <div className="space-y-3">
              <Field
                hint={
                  data.anthropicApiKeySet
                    ? "A key is set. Type a new value to replace it."
                    : envHint("anthropicApiKey") ?? "Required — your notes are sent to Anthropic on this key."
                }
              >
                <Label htmlFor="apiKey">
                  Anthropic API key {data.anthropicApiKeySet && <span className="text-primary">• set</span>}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="apiKey"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={data.anthropicApiKeySet ? "••••••••••••••••" : "sk-ant-…"}
                  />
                  {data.anthropicApiKeySet && (
                    <Button variant="outline" size="sm" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => clearSecret("clearAnthropicApiKey")}>
                      Remove
                    </Button>
                  )}
                </div>
              </Field>
              {curator === "full" && (
                <Field hint="Model used to auto-file rough dumps (brain_capture). Separate from the model you pick in the chat.">
                  <Label>Capture model</Label>
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a model" />
                    </SelectTrigger>
                    <SelectContent>
                      {CURATOR_MODELS.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              {!data.anthropicApiKeySet && !apiKey.trim() && (
                <p className="text-[11px] text-amber-500">The Curator stays off until an Anthropic key is saved.</p>
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
              <Label htmlFor="ghId">Client ID</Label>
              <Input id="ghId" value={ghId} onChange={(e) => setGhId(e.target.value)} placeholder="Iv1.…" />
            </Field>
            <Field hint={data.githubClientSecretSet ? "A secret is set. Type a new value to replace it." : undefined}>
              <Label htmlFor="ghSecret">
                Client secret {data.githubClientSecretSet && <span className="text-primary">• set</span>}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="ghSecret"
                  type="password"
                  value={ghSecret}
                  onChange={(e) => setGhSecret(e.target.value)}
                  placeholder={data.githubClientSecretSet ? "••••••••••••••••" : "secret"}
                />
                {data.githubClientSecretSet && (
                  <Button variant="outline" size="sm" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => clearSecret("clearGithubClientSecret")}>
                    Remove
                  </Button>
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
          <Button onClick={save} disabled={saving}>
            {saved && <Check size={14} />}
            {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
