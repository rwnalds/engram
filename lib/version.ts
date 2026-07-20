import pkg from "@/package.json";

/**
 * The one place the version is read from.
 *
 * It was hardcoded in both MCP server entry points and in package.json and server.json — four
 * copies, three of them invisible to the release workflow's version gate. `serverInfo.version`
 * is what every connected client reports, so a stale literal there means an agent tells you it's
 * talking to 0.1.0 forever. Now only package.json and server.json are hand-maintained, and the
 * release gate compares those two against the tag.
 */
export const VERSION: string = pkg.version;
