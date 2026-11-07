// The server as a client sees it: spawned over stdio, speaking MCP. Catches
// what tools.test.js can't — a schema the SDK rejects, a stray console.log
// corrupting stdout, a tool error thrown as a protocol error.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'test', version: '0' });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [new URL('./server.js', import.meta.url).pathname],
}));
after(() => client.close());

const call = (name, args) => client.callTool({ name, arguments: args });

test('lists the tools, and tells the agent to ask flat or 3D', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['check_d2', 'convert', 'examples', 'open_in_editor', 'render_d2', 'shapes']);
  assert.match(client.getInstructions(), /ask whether they want the flat or the 3D view/);
});

test('a render comes back as SVG text', async () => {
  const r = await call('render_d2', { source: 'a -> b', sketch: true });
  assert.equal(r.isError, undefined);
  assert.match(r.content[0].text, /<svg/);
});

test('a d2 error is a readable tool result, not a protocol failure', async () => {
  const r = await call('render_d2', { source: 'a -> {' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /line 1/);
});

test('arguments are validated against the app\'s own settings', async () => {
  const r = await call('render_d2', { source: 'a', theme: 12345 });
  assert.equal(r.isError, true);
});

test('check_d2 answers in JSON', async () => {
  const r = await call('check_d2', { source: 'a -> b' });
  assert.equal(JSON.parse(r.content[0].text).roundTrip, 'exact');
});
