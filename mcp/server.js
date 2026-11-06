#!/usr/bin/env node
// d2-blocks as an MCP server (stdio). The tools are in tools.js; this file only
// describes them to the client and maps results onto MCP content.
//
//   claude mcp add d2-blocks -- node /path/to/d2-blocks/mcp/server.js
//
// .mcp.json at the repo root registers it for Claude Code sessions in this repo.
// stdout is the protocol channel: never console.log here, use console.error.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { renderD2, checkD2, convert, examples, openInEditor, THEMES, DARK_THEMES, LAYOUTS, EDITOR } from './tools.js';

const server = new McpServer({ name: 'd2-blocks', version: '1.0.0' });

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const json = (v) => text(JSON.stringify(v, null, 2));
/** Tool errors go back as results the model can read and fix, not protocol errors. */
const guard = (fn) => async (args) => {
  try { return await fn(args); } catch (e) { return { ...text(e.message), isError: true }; }
};

const source = z.string().describe('d2 source text');

server.registerTool('render_d2', {
  title: 'Render d2',
  description: 'Compile d2 with the real d2 engine and return the SVG. On a syntax error, returns d2\'s message with line numbers. '
    + 'The SVG is d2\'s own output: markdown labels can carry raw HTML, so treat it as untrusted if the source was.',
  inputSchema: {
    source,
    theme: z.number().int().refine((v) => THEMES.includes(v), `one of ${THEMES.join(', ')}`).optional().describe('light theme id'),
    darkTheme: z.number().int().refine((v) => DARK_THEMES.includes(v), `one of ${DARK_THEMES.join(', ')}`).optional()
      .describe('dark theme id, used under prefers-color-scheme: dark'),
    layout: z.enum(LAYOUTS).optional(),
    sketch: z.boolean().optional().describe('hand-drawn look'),
    board: z.string().optional().describe('a layer/scenario/step path such as "layers.api"; omit for the root'),
  },
}, guard(async (args) => {
  const { svg, boards } = await renderD2(args);
  const note = boards.length ? `<!-- boards: ${boards.join(', ')} -->\n` : '';
  return text(note + svg);
}));

server.registerTool('check_d2', {
  title: 'Check d2',
  description: 'Whether d2 compiles; what the d2-blocks editor does to it (roundTrip: "exact", "reformatted" to canonical '
    + 'spacing with the same meaning, or "changed" — a bug); which parts stay as plain d2 text rather than editable '
    + 'blocks; and shape/connection/board counts.',
  inputSchema: { source },
}, guard(async (args) => json(await checkD2(args))));

server.registerTool('convert', {
  title: 'Convert mermaid ⇄ d2',
  description: 'Convert a mermaid flowchart to d2, or d2 to a mermaid flowchart. Best-effort, not lossless: only flowcharts '
    + 'are supported, and d2 features mermaid lacks are dropped.',
  inputSchema: {
    from: z.enum(['mermaid', 'd2']).describe('the language of `source`'),
    source: z.string(),
  },
}, guard(async (args) => text(convert(args))));

server.registerTool('examples', {
  title: 'Example diagrams',
  description: 'The d2 examples bundled with d2-blocks (architecture, data, cloud, security…). With no id, lists them; '
    + 'with an id, returns that example\'s d2 source.',
  inputSchema: { id: z.string().optional() },
}, guard(async (args) => json(await examples(args))));

server.registerTool('open_in_editor', {
  title: 'Open in d2-blocks',
  description: `A link that opens the d2 in the d2-blocks visual editor (${EDITOR}), as editable blocks with a live `
    + 'flat and 3D view. The diagram travels in the URL fragment, so it is never sent to a server.',
  inputSchema: {
    source,
    base: z.string().url().optional().describe('editor URL to link to instead, e.g. http://localhost:5173/d2-blocks/'),
  },
}, guard(async (args) => text(await openInEditor(args))));

await server.connect(new StdioServerTransport());
