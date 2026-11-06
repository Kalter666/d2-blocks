// A diagram carried in a URL fragment: `#d2=<base64url(deflate-raw(source))>`.
// The fragment never reaches a server (GitHub Pages logs nothing of it), and
// both ends are platform APIs — CompressionStream exists in browsers and node —
// so the MCP server's editor links and the app read the same format.
//
// A link is someone else's input. What it decodes to is treated like pasted d2
// (parsed, and sanitized on render); the size cap stops a small link inflating
// into something that hangs the tab.

export const PREFIX = '#d2=';
export const MAX_SOURCE = 512 * 1024; // bytes of d2, decompressed

const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

const toBase64Url = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** The fragment for `source`, `#d2=` included. */
export async function encode(source) {
  return PREFIX + toBase64Url(await pipe(new TextEncoder().encode(source), new CompressionStream('deflate-raw')));
}

/**
 * The d2 source in a `#d2=` fragment; null when `hash` isn't one. Throws on a
 * fragment that is corrupt or decodes past MAX_SOURCE.
 */
export async function decode(hash) {
  if (!hash?.startsWith(PREFIX)) return null;
  const stream = new Blob([fromBase64Url(hash.slice(PREFIX.length))]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  // Read incrementally, so an inflating bomb is stopped at the cap rather than
  // after it has filled memory.
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > MAX_SOURCE) throw new Error(`The linked diagram is over ${MAX_SOURCE / 1024} KB, so it was not opened.`);
    chunks.push(chunk);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(await new Blob(chunks).arrayBuffer());
}
