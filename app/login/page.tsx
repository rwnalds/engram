const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Cortex";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const msg =
    error === "not-allowed"
      ? "That account isn't on the allowlist."
      : error
        ? "Sign-in failed. Please try again."
        : null;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6">
      <div className="flex items-center gap-2">
        <div className="size-2 rounded-full bg-primary" />
        <span className="text-lg font-medium tracking-tight">{APP_NAME}</span>
      </div>
      <a
        href="/api/auth/login"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        Sign in with Google
      </a>
      {msg && <p className="text-sm text-destructive">{msg}</p>}
    </div>
  );
}
