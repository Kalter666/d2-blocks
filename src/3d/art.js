// Everything in 3D that is a picture rather than a solid: label plaques drawn
// into canvases, icons fetched as textures, and d2's own drawing of a table,
// class, code block or formula rasterised off the hidden SVG.
import * as THREE from 'three';
import { markdownHint } from '../md.js';

// -------------------------------------------------------------------- labels

const FONT = (px, style = {}) =>
  `${style.italic ? 'italic ' : ''}${style.bold === false ? 500 : 700} ${px}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;

/**
 * A label is a sprite, so it faces the camera from every angle — text lying on
 * the floor is unreadable the moment the camera tilts.
 */
export function plaque(text, px = 30, style = {}) {
  let line = String(text).split('\n')[0].slice(0, 60);
  if (style.transform === 'uppercase') line = line.toUpperCase();
  else if (style.transform === 'lowercase') line = line.toLowerCase();
  else if (style.transform === 'capitalize') line = line.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = FONT(px, style);
  const w = Math.ceil(probe.measureText(line).width) + 34;
  const h = px + 22;

  const c = document.createElement('canvas');
  c.width = w * 2; c.height = h * 2; // drawn at 2x so it stays crisp close up
  const g = c.getContext('2d');
  g.scale(2, 2);
  g.font = FONT(px, style);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const ink = style.color ?? '#f7f8fa';
  const inkColor = new THREE.Color().setStyle(ink);
  const inkLuminance = inkColor.r * 0.2126 + inkColor.g * 0.7152 + inkColor.b * 0.0722;
  const lightInk = inkLuminance > 0.38;
  g.fillStyle = lightInk ? 'rgba(17, 23, 31, 0.94)' : 'rgba(248, 249, 251, 0.94)';
  g.strokeStyle = style.stroke ?? (lightInk ? '#8aa4ba' : '#66717c');
  g.lineWidth = 1.5;
  g.beginPath();
  g.roundRect(0.75, 0.75, w - 1.5, h - 1.5, 8);
  g.fill();
  g.globalAlpha = 0.42;
  g.stroke();
  g.globalAlpha = 1;
  g.fillStyle = ink;
  g.fillText(line, w / 2, h / 2 + 1);
  if (style.underline) {
    g.fillRect(w * 0.12, h * 0.78, w * 0.76, Math.max(1, px * 0.055));
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: true,
  }));
  sprite.renderOrder = 10;
  sprite.scale.set(w * 0.6, h * 0.6, 1); // canvas pixels → d2's own units
  return sprite;
}

/**
 * A markdown label as a click-to-open pair: a short `name · ¶` badge, and the
 * panel with the first line of the text. One is visible at a time; Scene.svelte's
 * click handler swaps them and remembers `open`. The caller seats both (where
 * depends on the panel's own size), via `place(position)`.
 */
export function mdDisclosure(id, name, label, style, size, open) {
  const badge = plaque(`${name} · ¶`, 20, style);
  const panel = plaque(`${name} · ${markdownHint(label).text}`, size, style);
  badge.userData = { id, mdHint: true };
  panel.userData = { id, mdHint: true };
  badge.visible = !open;
  panel.visible = open;
  const place = (p) => { badge.position.copy(p); panel.position.copy(p); };
  return { badge, panel, place };
}

// ------------------------------------------------------------ borrowed art

/** d2 serialises an icon as Go's url.URL; only web and inline images are loaded. */
export function iconUrl(icon) {
  if (!icon) return null;
  const url = typeof icon === 'string' ? icon
    : `${icon.Scheme}:${icon.Host ? `//${icon.Host}` : ''}${icon.Opaque || icon.Path}${icon.RawQuery ? `?${icon.RawQuery}` : ''}`;
  return /^(https?:|data:image\/)/i.test(url) ? url : null;
}

const PANELS = new Set(['sql_table', 'class', 'code']);
export const isPanel = (s) => PANELS.has(s.type) || (s.type === 'text' && s.language === 'latex');
export const SLAB = 10;

/** Draw an image onto a canvas texture; an SVG with no intrinsic size is drawn square. */
function imageTexture(img, w = 256, h = 256) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const iw = img.naturalWidth || w, ih = img.naturalHeight || h;
  const k = Math.min(w / iw, h / ih);
  g.drawImage(img, (w - iw * k) / 2, (h - ih * k) / 2, iw * k, ih * k);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * The loaders that outlive one rebuild. `shared` is the skins' set (a loaded
 * icon is shared too), `lookup(id)` finds a shape's <g> in the hidden SVG, and
 * `invalidate()` asks for a frame once a late texture lands.
 */
export function createArt({ shared, lookup, invalidate }) {
  // One request per icon URL for the life of the page, shared by every rebuild.
  // A host without CORS fails to load rather than tainting the WebGL canvas.
  const icons = new Map();
  function iconTexture(url) {
    // no-store: the hidden SVG's <image> already fetched it without CORS, and
    // that cached copy would be handed back here and refused.
    if (!icons.has(url)) icons.set(url, fetch(url, { mode: 'cors', cache: 'no-store' })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((blob) => new Promise((resolve) => {
        const src = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(src);
          const t = imageTexture(img);
          shared.add(t);
          resolve(t);
        };
        img.onerror = () => { URL.revokeObjectURL(src); resolve(null); };
        img.src = src;
      }))
      .catch(() => null));
    return icons.get(url);
  }

  /**
   * d2 already draws tables, classes, code and maths properly, so the 3D panel
   * shows that drawing instead of re-implementing it: the hidden SVG is cloned
   * down to this one shape, cropped to it and rasterised.
   */
  function snapshot(s) {
    const g = lookup(s.id);
    const svg = g?.closest('svg.d2-svg');
    if (!svg) return Promise.resolve(null);
    const token = g.getAttribute('class').split(' ')[0];
    const copy = svg.cloneNode(true);
    for (const n of [...copy.children]) {
      if (n.localName === 'style') continue;
      if (n.localName === 'g' && n.getAttribute('class')?.split(' ')[0] === token) continue;
      n.remove();
    }
    const k = Math.min(3, 2048 / Math.max(s.width, s.height)); // texels per d2 unit
    const [w, h] = [Math.round(s.width * k), Math.round(s.height * k)];
    copy.setAttribute('viewBox', `${s.pos.x} ${s.pos.y} ${s.width} ${s.height}`);
    copy.setAttribute('width', w);
    copy.setAttribute('height', h);
    const url = URL.createObjectURL(new Blob(
      [new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' },
    ));
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(imageTexture(img, w, h)); };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  /** Put a late texture on a material, unless the rebuild that made it is gone. */
  function whenLoaded(promise, material, own = false) {
    promise.then((t) => {
      if (!t) return;
      if (material.userData.gone) { if (own) t.dispose(); return; }
      material.map = t;
      material.color?.set(0xffffff);
      material.opacity = 1;
      material.needsUpdate = true;
      invalidate();
    });
  }

  /** A camera-facing picture, `w`×`h` d2 units, standing with its foot at the origin. */
  function picture(url, w, h, id) {
    const material = new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(w, h, 1);
    sprite.position.y = h / 2;
    sprite.userData = { id };
    whenLoaded(iconTexture(url), material);
    return sprite;
  }

  /** A low slab with d2's own drawing of the shape laid on its top face. */
  function panelBody(s, M) {
    const g = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(s.width, SLAB, s.height), M.cap());
    slab.position.y = SLAB / 2;
    g.add(slab);
    const face = new THREE.MeshBasicMaterial({ color: 0x1a222b, transparent: true, toneMapped: false });
    const top = new THREE.Mesh(new THREE.PlaneGeometry(s.width, s.height), face);
    top.rotation.x = -Math.PI / 2;
    top.position.y = SLAB + 0.3;
    g.add(top);
    whenLoaded(snapshot(s), face, true);
    return g;
  }

  return { picture, panelBody };
}
