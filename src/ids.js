// Pure, so node tests import the very function the canvas uses. It used to live
// in d2.js, which spawns the worker on import, so compile.test.js kept its own
// copy of the decoder — and an edit to the real one passed every test while
// silently breaking hover linking and 3D colours.

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#34;': '"', '&#39;': "'" };
const unescapeXml = (s) => s.replace(/&(?:amp|lt|gt|#34|#39);/g, (e) => ENTITIES[e]);

/**
 * d2 tags every shape and connection <g> with base64(xml-escaped(id)) as its
 * first class, url-safe alphabet. Decoding what's in the document beats encoding
 * a guess — the escaping rules are d2's, not ours. Throws on a token that isn't
 * base64 (d2's own `shape` class, or something else entirely).
 */
export function decodeId(token) {
  const bytes = Uint8Array.from(atob(token.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  return unescapeXml(new TextDecoder().decode(bytes));
}

/**
 * Returns both directions: byId to light a shape up, idByEl to answer "what is
 * the pointer over?". A container's <g> wraps its children's, so that question
 * has to be answered by walking *up* from the event target — scanning the map
 * would report the outermost container every time.
 */
export function index(root) {
  const byId = new Map();
  const idByEl = new Map();
  for (const g of root.querySelectorAll('g[class]')) {
    const token = g.getAttribute('class').split(' ')[0];
    if (token === 'shape' || !token) continue;
    try {
      const id = decodeId(token);
      byId.set(id, g);
      idByEl.set(g, id);
    } catch { /* not one of ours */ }
  }
  return { byId, idByEl };
}
