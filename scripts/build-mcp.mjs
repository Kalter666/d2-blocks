// Builds the MCP server into one self-contained package in dist-mcp/, packed as
// dist-mcp/d2-blocks-mcp.tgz for a GitHub release (.github/workflows/mcp-release.yml):
//
//   npx -y --package=https://github.com/Kalter666/d2-blocks/releases/latest/download/d2-blocks-mcp.tgz d2-blocks-mcp
//
// Everything — the app modules the tools use, the MCP SDK's stdio parts, zod,
// three — is bundled into server.js. Only the d2 engine stays a dependency: it
// ships a wasm binary and spawns a worker from its own files, so it can't be
// inlined. ponytail: three is bundled whole-ish (~0.5 MB) for the 3D cost table;
// precompute that table at build time if the bundle size ever matters.
import { build } from 'rolldown';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { VERSION } from '../mcp/version.js';

const root = new URL('../', import.meta.url);
const out = new URL('dist-mcp/', root);
const app = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const d2 = JSON.parse(await readFile(new URL('node_modules/@terrastruct/d2/package.json', root), 'utf8')).version;

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  input: new URL('mcp/server.js', root).pathname,
  platform: 'node',
  external: ['@terrastruct/d2'],
  output: { file: new URL('server.js', out).pathname, format: 'esm', minify: true },
  logLevel: 'warn',
});

await cp(new URL('src/examples/', root), new URL('examples/', out), {
  recursive: true,
  filter: (src) => !src.endsWith('.js'),
});

await writeFile(new URL('package.json', out), `${JSON.stringify({
  name: 'd2-blocks-mcp',
  version: VERSION,
  description: 'MCP server for d2-blocks: render and check d2, 3D-aware shape guidance, links into the visual editor.',
  license: app.license,
  homepage: app.homepage,
  repository: app.repository,
  type: 'module',
  bin: { 'd2-blocks-mcp': 'server.js' },
  files: ['server.js', 'examples/'],
  engines: { node: '>=20' },
  // Exact, the version the tests ran against: d2's output changes between releases.
  dependencies: { '@terrastruct/d2': d2 },
}, null, 2)}\n`);

execFileSync('npm', ['pack', '--silent'], { cwd: out, stdio: ['ignore', 'pipe', 'inherit'] });
await rename(new URL(`d2-blocks-mcp-${VERSION}.tgz`, out), new URL('d2-blocks-mcp.tgz', out));
console.log(`dist-mcp/d2-blocks-mcp.tgz (v${VERSION}, d2 ${d2})`);
