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
  if (typeof DOMParser === 'undefined') return svg; // node: nothing mounts it there
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('The rendered diagram could not be parsed, so it was not displayed.');
  }
  for (const el of doc.querySelectorAll('*')) {
    if (UNSAFE_TAGS.has(el.localName.toLowerCase())) { el.remove(); continue; }
    for (const at of [...el.attributes]) {
      if (unsafeAttr(at.name, at.value)) el.removeAttributeNode(at);
    }
  }
  return new XMLSerializer().serializeToString(doc);
}
