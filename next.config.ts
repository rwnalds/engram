import { fileURLToPath } from "node:url";
import path from "node:path";
import type { NextConfig } from "next";

const allowedDevOrigins = [
  "*.ts.net",
  ...(process.env.ALLOWED_DEV_ORIGINS
    ? process.env.ALLOWED_DEV_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : []),
];

const nextConfig: NextConfig = {
  allowedDevOrigins,
  // Pin the workspace root to the app dir (there are stray lockfiles above it).
  turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) },
  // The vault (markdown, source of truth) lives outside the app dir and is read
  // at runtime via fs from VAULT_DIR — never bundled.
  serverExternalPackages: ["simple-git", "gray-matter", "chokidar"],
  // OAuth discovery lives at well-known paths; map them to the API routes.
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/protected-resource" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/protected-resource" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/authorization-server" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/authorization-server" },
    ];
  },
};

export default nextConfig;
