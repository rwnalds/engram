import { AUTH_DISABLED, AUTH_SECRET, HARNESS_ENABLED, MCP_TOKEN } from "@/lib/config";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    harness: HARNESS_ENABLED,
    mcpAuthRequired: MCP_TOKEN !== "",
    dashboardAuthRequired: !AUTH_DISABLED && AUTH_SECRET !== "",
  });
}
