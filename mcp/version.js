// The MCP server's version: what clients see, and the GitHub release it ships
// in (tag mcp-v<VERSION>). Its own module so the build can read it without
// importing tools.js, which starts the d2 worker.
export const VERSION = '1.1.1';
