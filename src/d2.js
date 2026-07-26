import { D2 } from '@terrastruct/d2';

// One instance, one worker, for the life of the page.
const d2 = new D2();

/** Compile + render. Throws with d2's own message on a syntax error. */
export async function draw(src, { layout = 'dagre', themeID = 0, sketch = false } = {}) {
  const r = await d2.compile(src || '', { layout, themeID, sketch, center: true, pad: 24 });
  const svg = await d2.render(r.diagram, { ...r.renderOptions, noXMLTag: true });
  return { svg, diagram: r.diagram };
}

/**
 * d2 tags every shape and connection <g> with base64(xml-escaped(id)).
 * Decoding what's in the document beats encoding a guess — the escaping rules
 * are d2's, not ours. See compile.test.js for the verification.
 *
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
      const bytes = Uint8Array.from(atob(token.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      const id = unescapeXml(new TextDecoder().decode(bytes));
      byId.set(id, g);
      idByEl.set(g, id);
    } catch { /* not one of ours */ }
  }
  return { byId, idByEl };
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#34;': '"', '&#39;': "'" };
const unescapeXml = (s) => s.replace(/&(?:amp|lt|gt|#34|#39);/g, (e) => ENTITIES[e]);
