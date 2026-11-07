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
import {
  renderD2, checkD2, convert, examples, shapes, openInEditor,
  THEMES, DARK_THEMES, LAYOUTS, EDITOR, BUDGET_3D, MAX_INLINE_SVG,
} from './tools.js';

// Sent to the client once, at connect: how to use these tools well. The 2D/3D
// question comes first because it changes what a good diagram looks like.
const instructions = `d2-blocks draws d2 diagrams two ways: flat (a classic 2D SVG) and 3D (every shape becomes a
physical model — a database is a server cabinet, a person a figure, a queue a transport tube — lit and orbitable,
in the editor at ${EDITOR}).

Before drawing for someone, ask whether they want the flat or the 3D view, unless they said. Then:
- Flat: any size d2 handles; render_d2 for an SVG file, open_in_editor with look "flat" to edit it.
- 3D: fewer, more meaningful shapes. Each object is 3–50 meshes, so keep it to about ${BUDGET_3D.shapes} objects,
  give every node a shape role (call shapes for what each becomes in 3D), keep nesting to 2–3 levels, and put
  detail in layers rather than one crowded board. Check with check_d2 look "3d" (it estimates the scene and
  advises), then hand over open_in_editor with look "3d". render_d2 cannot draw 3D: it needs WebGL.

Prefer a link from open_in_editor over a large SVG: the reader gets editable blocks and both views.`;

const server = new McpServer({ name: 'd2-blocks', version: '1.1.0' }, { instructions });

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const json = (v) => text(JSON.stringify(v, null, 2));
/** Tool errors go back as results the model can read and fix, not protocol errors. */
const guard = (fn) => async (args) => {
  try { return await fn(args); } catch (e) { return { ...text(e.message), isError: true }; }
};

const source = z.string().describe('d2 source text');
const look = z.enum(['flat', '3d']);

server.registerTool('render_d2', {
  title: 'Render d2',
  description: 'Compile d2 with the real d2 engine and return the flat (2D) SVG; for 3D use open_in_editor with look "3d". '
    + `SVGs over ${MAX_INLINE_SVG / 1024} KB (from ~30 shapes; d2 inlines its fonts) need \`out\`, a .svg path to write instead. `
    + 'On a syntax error, returns d2\'s message with line numbers; if the dagre layout crashes, retries with elk and says so. '
    + 'The SVG is d2\'s own output: markdown labels can carry raw HTML, so treat it as untrusted if the source was.',
  inputSchema: {
    source,
    theme: z.number().int().refine((v) => THEMES.includes(v), `one of ${THEMES.join(', ')}`).optional().describe('light theme id'),
    darkTheme: z.number().int().refine((v) => DARK_THEMES.includes(v), `one of ${DARK_THEMES.join(', ')}`).optional()
      .describe('dark theme id, used under prefers-color-scheme: dark'),
    layout: z.enum(LAYOUTS).optional(),
    sketch: z.boolean().optional().describe('hand-drawn look'),
    board: z.string().optional().describe('a layer/scenario/step path such as "layers.api"; omit for the root'),
    out: z.string().optional().describe('write the SVG to this .svg path and return its details instead of the SVG'),
  },
}, guard(async (args) => {
  const { svg, ...meta } = await renderD2(args);
  if (svg == null) return json(meta);
  const notes = [meta.note, meta.boards.length && `boards: ${meta.boards.join(', ')}`].filter(Boolean);
  return text(notes.map((n) => `<!-- ${n} -->\n`).join('') + svg);
}));

server.registerTool('check_d2', {
  title: 'Check d2',
  description: 'Whether d2 compiles; what the d2-blocks editor does to it (roundTrip: "exact", "reformatted" to canonical '
    + 'spacing with the same meaning, or "changed" — a bug); which parts stay as plain d2 text rather than editable '
    + 'blocks; shape/connection/board counts; and the layout used (elk if dagre crashed). With look "3d", also '
    + 'estimates the 3D scene (objects, draw calls) and advises on keeping it readable.',
  inputSchema: { source, look: look.optional().describe('the view it is meant for; "3d" adds the 3D estimate') },
}, guard(async (args) => json(await checkD2(args))));

server.registerTool('shapes', {
  title: 'Shapes and their 3D models',
  description: 'Every d2 shape the editor offers: its d2 name, the role it stands for, the physical model it becomes in '
    + 'the 3D view, and that model\'s mesh count. Use it to give nodes meaningful shapes, which matters most in 3D.',
  inputSchema: {},
}, guard(async () => json(shapes())));

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
    look: look.optional().describe('the view it opens in; omit to keep the reader\'s last choice'),
    layout: z.enum(LAYOUTS).optional().describe('layout engine; pass the one check_d2/render_d2 reported'),
    base: z.string().url().optional().describe('editor URL to link to instead, e.g. http://localhost:5173/d2-blocks/'),
  },
}, guard(async (args) => text(await openInEditor(args))));

await server.connect(new StdioServerTransport());
