// Anything in d2's SVG that could *run* once the canvas mounts it with {@html}.
//
// d2 copies raw HTML out of a markdown label straight into a <foreignObject>, so
// `x: |md <img src=y onerror="…"> |` in a pasted diagram would otherwise execute
// on this origin. A `<script>` inserted this way never runs, but an event handler
// attribute does, which is the hole that matters.
//
// Its own module rather than part of d2.js: that one opens a wasm worker on
// import, which a test can't do.
const UNSAFE_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'form']);
// SMIL can *write* an attribute after the walk below has checked it:
// `<a><set attributeName="href" to="javascript:…"/></a>` arms the link on load.
// d2 animates with CSS, never SMIL, so dropping these when they target a URL
// attribute costs nothing.
const ANIMATES = new Set(['set', 'animate', 'animatemotion', 'animatetransform']);
const SAFE_URL = /^(?:https?:|mailto:|#|data:image\/(?:png|jpeg|gif|webp);)/;

export function unsafeAttr(name, value = '') {
  const n = name.toLowerCase();
  if (n.startsWith('on')) return true;
  if (n !== 'href' && n !== 'xlink:href' && n !== 'src') return false;
  // Control characters and whitespace are ignored when a URL is resolved, so
  // `java\nscript:` is a live scheme. Strip them before deciding, as a browser does.
  return !SAFE_URL.test(value.replace(/[\u0000-\u0020]/g, '').toLowerCase());
}

/** Strip those, using the browser's own parser rather than a regex over markup. */
export function sanitize(svg) {
  // Fails open only where nothing can mount the result. Anywhere else (a worker,
  // a new caller) a missing DOMParser must be loud, not a silent pass-through.
  if (typeof DOMParser === 'undefined') {
    if (typeof process !== 'undefined' && process.versions?.node) return svg;
    throw new Error('sanitize() needs DOMParser; refusing to pass the SVG through unchecked.');
  }
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('The rendered diagram could not be parsed, so it was not displayed.');
  }
  for (const el of doc.querySelectorAll('*')) {
    const tag = el.localName.toLowerCase();
    if (UNSAFE_TAGS.has(tag)) { el.remove(); continue; }
    if (ANIMATES.has(tag) && /^(?:xlink:)?href$|^src$/i.test(el.getAttribute('attributeName') ?? '')) { el.remove(); continue; }
    for (const at of [...el.attributes]) {
      if (unsafeAttr(at.name, at.value)) el.removeAttributeNode(at);
    }
  }
  return new XMLSerializer().serializeToString(doc);
}
