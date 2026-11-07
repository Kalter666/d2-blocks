// Runs a packed MCP server the way a user does — `npx -y --package=<tarball or
// URL> d2-blocks-mcp` from
// an empty directory, nothing from this repo on its path — and drives it over
// stdio. Catches what the in-repo tests can't: a bundling mistake, a file left
// out of the package, a dependency that only resolved because the repo had it.
//
//   node scripts/smoke-mcp.mjs dist-mcp/d2-blocks-mcp.tgz
//   node scripts/smoke-mcp.mjs https://github.com/Kalter666/d2-blocks/releases/latest/download/d2-blocks-mcp.tgz
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const target = process.argv[2];
if (!target) throw new Error('usage: smoke-mcp.mjs <tarball path or URL>');
const pkg = /^https?:/.test(target) ? target : resolve(target);
const cwd = await mkdtemp(join(tmpdir(), 'd2-blocks-mcp-'));

const client = new Client({ name: 'smoke', version: '0' });
try {
  await client.connect(new StdioClientTransport({ command: 'npx', args: ['-y', `--package=${pkg}`, 'd2-blocks-mcp'], cwd, stderr: 'inherit' }));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    assert.notEqual(r.isError, true, `${name}: ${r.content?.[0]?.text}`);
    return r.content[0].text;
  };

  const { tools } = await client.listTools();
  assert.equal(tools.length, 6);
  assert.match(client.getInstructions(), /flat or the 3D view/);
  assert.match(await call('render_d2', { source: 'a -> b: smoke' }), /^<svg[\s\S]*smoke/);
  assert.equal(JSON.parse(await call('check_d2', { source: 'db: {shape: cylinder}', look: '3d' })).threeD.objects, 1);
  const [first] = JSON.parse(await call('examples', {}));
  assert.match(JSON.parse(await call('examples', { id: first.id })).source, /->/, 'examples shipped in the package');
  assert.match(await call('open_in_editor', { source: 'a', look: '3d' }), /#d2=.*&look=3d$/);
  console.log(`ok: ${tools.length} tools from ${target}`);
} finally {
  await client.close();
  await rm(cwd, { recursive: true, force: true });
}
