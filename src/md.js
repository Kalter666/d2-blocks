// A deliberately small markdown <-> HTML bridge, sized to exactly what the
// rich-text toolbar can produce: headings, bold, italic, code, links, lists,
// paragraphs. Markdown is the stored truth; the HTML only exists so a
// contenteditable can show it.
//
// Nothing it doesn't recognise is transformed — a table, an image, raw HTML or
// a nested list survives as literal text. `rich()` is the guarantee: it refuses
// the WYSIWYG whenever a round-trip would change a single byte, and the caller
// shows a plain textarea instead.

// ---------------------------------------------------------------- md -> html

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Order is alternation order: a code span wins, so `**` inside one stays literal.
// Emphasis requires non-space on both sides (CommonMark's left-flanking rule),
// or prose like "5 * 3 * 2" would come back italicised.
const INLINE = /`([^`]+)`|\*\*(\S(?:[\s\S]*?\S)?)\*\*|\*(\S(?:[^*]*\S)?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
const SAFE_URL = /^(https?:\/\/|mailto:|#|\/|\.{0,2}\/)/i;

function inline(s) {
  let out = '';
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    out += esc(s.slice(last, m.index));
    if (m[1] != null) out += `<code>${esc(m[1])}</code>`;
    else if (m[2] != null) out += `<strong>${inline(m[2])}</strong>`;
    else if (m[3] != null) out += `<em>${inline(m[3])}</em>`;
    // An unsafe scheme isn't sanitised into a broken link — it's left as the
    // literal text it was, which is both harmless and lossless.
    else if (SAFE_URL.test(m[5])) out += `<a href="${esc(m[5])}">${inline(m[4])}</a>`;
    else out += esc(m[0]);
    last = m.index + m[0].length;
  }
  return out + esc(s.slice(last));
}

const STARTS_BLOCK = /^(#{1,3} |- |\d+\. )/;

export function toHtml(md) {
  const lines = md.split('\n');
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;

    const h = /^(#{1,3}) (.*)$/.exec(l);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }

    if (/^- /.test(l)) {
      const items = [];
      while (i < lines.length && /^- /.test(lines[i])) items.push(`<li>${inline(lines[i++].slice(2))}</li>`);
      i--;
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\d+\. /.test(l)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(`<li>${inline(lines[i++].replace(/^\d+\. /, ''))}</li>`);
      }
      i--;
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !STARTS_BLOCK.test(lines[i])) para.push(inline(lines[i++]));
    i--;
    out.push(`<p>${para.join('<br>')}</p>`);
  }

  return out.join('');
}

// ---------------------------------------------------------------- html -> md

// ponytail: a tag scanner, not an HTML parser. It only ever sees toHtml's own
// output or a contenteditable's, both of which are well-formed; unknown tags are
// transparent and stray closers are ignored, so the worst case is losing markup
// this bridge couldn't express anyway.
const TAG = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z][\w-]*)([^>]*)>/g;
const VOID = new Set(['br', 'img', 'hr', 'input', 'wbr', 'meta', 'link', 'base', 'col', 'source', 'track', 'area', 'embed', 'param']);
const BLOCK = new Set(['p', 'div', 'ul', 'ol', 'h1', 'h2', 'h3']);

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unesc = (s) => s.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(parseInt(e[1] === 'x' || e[1] === 'X' ? e.slice(2) : e.slice(1), e[1] === 'x' || e[1] === 'X' ? 16 : 10));
  return ENT[e.toLowerCase()] ?? m;
});

const attr = (attrs, name) => {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs ?? '');
  return m ? unesc(m[2] ?? m[3] ?? m[4]) : '';
};

function parseHtml(html) {
  const root = { children: [] };
  const stack = [root];
  let last = 0;

  for (const m of html.matchAll(TAG)) {
    if (m.index > last) stack.at(-1).children.push({ text: html.slice(last, m.index) });
    last = m.index + m[0].length;
    if (m[2] === undefined) continue; // comment

    const tag = m[2].toLowerCase();
    if (m[1]) {
      const at = stack.findLastIndex((n) => n.tag === tag);
      if (at > 0) stack.length = at;
      continue;
    }

    const node = { tag, attrs: m[3] ?? '', children: [] };
    stack.at(-1).children.push(node);
    if (!VOID.has(tag) && !/\/\s*$/.test(m[3] ?? '')) stack.push(node);
  }

  if (html.length > last) stack.at(-1).children.push({ text: html.slice(last) });
  return root;
}

function inlineMd(nodes) {
  let s = '';
  for (const n of nodes) {
    if (n.text !== undefined) { s += unesc(n.text); continue; }
    const inner = inlineMd(n.children);
    const t = inner.trim();
    switch (n.tag) {
      case 'br': s += '\n'; break;
      // execCommand leaves empty <b>/<i> shells behind when you toggle twice.
      case 'strong': case 'b': s += t && `**${t}**`; break;
      case 'em': case 'i': s += t && `*${t}*`; break;
      case 'code': s += t && `\`${t}\``; break;
      case 'a': { const href = attr(n.attrs, 'href'); s += href ? `[${inner}](${href})` : inner; break; }
      default: s += inner;
    }
  }
  return s;
}

const HEAD = { h1: '# ', h2: '## ', h3: '### ' };

function blockMd(nodes) {
  const out = [];
  let para = [];
  const flush = () => {
    if (para.join('').trim()) out.push(para.join('').trim());
    para = [];
  };

  for (const n of nodes) {
    if (n.text !== undefined) { para.push(unesc(n.text)); continue; }

    if (HEAD[n.tag]) { flush(); out.push(HEAD[n.tag] + inlineMd(n.children).trim()); continue; }

    if (n.tag === 'ul' || n.tag === 'ol') {
      flush();
      const items = n.children.filter((c) => c.tag === 'li');
      out.push(items.map((li, i) => (n.tag === 'ul' ? '- ' : `${i + 1}. `) + inlineMd(li.children).trim()).join('\n'));
      continue;
    }

    if (n.tag === 'p' || n.tag === 'div') {
      flush();
      // Browsers nest divs freely; recurse rather than flatten them into one line.
      // Not trimmed — a paragraph's leading whitespace is content (`  - nested`).
      if (n.children.some((c) => BLOCK.has(c.tag))) out.push(...blockMd(n.children));
      else out.push(inlineMd(n.children));
      continue;
    }

    if (n.tag === 'br') { para.push('\n'); continue; }

    // Some wrapper we don't model — a <section>, or the <meta> a paste arrives
    // wrapped in. Descend if it holds blocks, otherwise treat it as inline.
    if (n.children.some((c) => BLOCK.has(c.tag))) { flush(); out.push(...blockMd(n.children)); continue; }
    para.push(inlineMd([n]));
  }

  flush();
  return out;
}

export const toMd = (html) => blockMd(parseHtml(html).children).filter((b) => b.trim()).join('\n\n');

/**
 * Is this markdown safe to hand to the WYSIWYG? True only when the bridge
 * reproduces it byte-for-byte, so editing can never silently rewrite text it
 * didn't understand. False is not an error — the caller shows a textarea.
 */
export const rich = (md) => toMd(toHtml(md)) === md;
