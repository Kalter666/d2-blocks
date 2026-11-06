// What each 3D family is made of, and the canvases that paint it. Data and
// painting only run when called, so node can import this for the table checks
// in models.test.js; the painting itself needs a DOM canvas.
import * as THREE from 'three';

/**
 * What each kind of thing is made of. Everything is drawn procedurally into a
 * canvas — no image assets to ship or fetch.
 *
 * Albedo stays near-greyscale on purpose: `map` multiplies the material colour,
 * so d2's own fill (and any style.fill block) still decides the hue and the
 * texture only adds the detail. Anything that should glow regardless of the
 * fill — drive LEDs, port lights — goes in the emissive map instead, which is
 * added rather than multiplied.
 *
 * `tile` is in world units, not UVs, so a big shape and a small one get the
 * same size bands rather than the pattern stretching to fit.
 */
// Kept close together on purpose: a wide range multiplied by a light fill
// blows the highlights to white and crushes the seams to black.
const STEEL = [[0, '#dde4ec'], [0.13, '#c2cad4'], [0.52, '#96a0ac'], [0.88, '#c8d0da'], [1, '#7b8593']];
const MATTE = [[0, '#f2f4f7'], [0.5, '#d3d8de'], [1, '#aeb5bd']];
const GLOSS = [[0, '#ffffff'], [0.22, '#e8edf3'], [0.55, '#a9b3c0'], [1, '#e2e8ef']];
// Painted plate rather than bare steel: flatter, so the tank's hoops and
// rivets do the reading instead of a mirror finish.
const PAINT = [[0, '#f2f1ec'], [0.24, '#dcd9d1'], [0.62, '#a8a9a5'], [1, '#c6c6c1']];

export const SKIN = {
  // A database is a stack of drive bays: metal rims, a status strip, a bay door.
  db: { bands: 4, base: STEEL, seam: 'rgba(3,7,12,0.8)', tile: [96, 62], metal: 0.85, rough: 0.24,
    led: { color: '#3dff9f', y: 0.7, h: 0.09 }, bay: { color: '#2f7bff', x: 0.06, w: 0.2, y: 0.16, h: 0.44, per: 2 },
    dots: [{ x: 0.86, y: 0.36, color: '#cfe6ff' }], cap: 'rings' },
  // Storage is a tank, so: painted plate, riveted hoop seams, a hazard band.
  volume: { bands: 4, base: PAINT, seam: 'rgba(3,7,12,0.5)', tile: [78, 90], metal: 0.4, rough: 0.46,
    rivets: 'rgba(255,255,255,0.4)', tape: 'rgba(255,190,60,0.35)', cap: 'rings' },
  queue: { bands: 3, base: STEEL, seam: 'rgba(3,7,12,0.6)', tile: [72, 54], metal: 0.7, rough: 0.3,
    chevrons: { color: 'rgba(255,255,255,0.55)', glow: '#7ee7ff' }, cap: 'rings' },
  // A service is rack kit: vent slots and a couple of status lights.
  service: { bands: 2, base: STEEL, seam: 'rgba(3,7,12,0.55)', tile: [84, 58], metal: 0.72, rough: 0.34,
    vents: 5, dots: [{ x: 0.08, y: 0.3, color: '#3dff9f' }, { x: 0.15, y: 0.3, color: '#ffc24d' }], cap: 'grid' },
  gateway: { bands: 2, base: STEEL, seam: 'rgba(3,7,12,0.6)', tile: [80, 56], metal: 0.8, rough: 0.26,
    bay: { color: '#7ee7ff', x: 0.1, w: 0.12, y: 0.28, h: 0.4, per: 4 }, cap: 'grid' },
  package: { bands: 2, base: MATTE, seam: 'rgba(60,40,20,0.35)', tile: [80, 60], metal: 0.05, rough: 0.85,
    tape: 'rgba(190,160,110,0.55)', cap: 'grid' },
  // Only the indicator's housing wears this; its lens is glass, not a map.
  state: { bands: 2, base: GLOSS, seam: 'rgba(3,7,12,0.35)', tile: [110, 40], metal: 0.55, rough: 0.22,
    cap: 'sheen' },
  startstop: { bands: 1, base: STEEL, tile: [100, 52], metal: 0.68, rough: 0.34, cap: 'sheen' },
  person: { bands: 1, base: MATTE, tile: [40, 40], metal: 0.0, rough: 0.95, weave: true, cap: 'sheen' },
  cloud: { bands: 1, base: [[0, '#ffffff'], [0.6, '#eef4fb'], [1, '#dbe6f2']], tile: [140, 110],
    metal: 0.0, rough: 0.55, cap: 'sheen' },
  decision: { bands: 2, base: MATTE, seam: 'rgba(3,7,12,0.5)', tile: [70, 50], metal: 0.3, rough: 0.45,
    hazard: { a: 'rgba(255,190,60,0.75)', b: 'rgba(30,30,30,0.35)', glow: '#ffbe3c' }, cap: 'sheen' },
  file: { bands: 1, base: [[0, '#eed09a'], [1, '#ba8740']], tile: [80, 64],
    metal: 0, rough: 0.9, cap: 'rules' },
  screen: { bands: 1, base: GLOSS, tile: [110, 60], metal: 0.48, rough: 0.28, cap: 'sheen' },
  note: { bands: 1, base: [[0, '#f3d86b'], [1, '#c99e32']], tile: [80, 64],
    metal: 0, rough: 0.9, cap: 'rules' },
  component: { bands: 1, base: [[0, '#86ad98'], [1, '#4e7d66']], tile: [64, 64],
    metal: 0.12, rough: 0.62, cap: 'grid' },
  io: { bands: 1, base: MATTE, seam: 'rgba(3,7,12,0.3)', tile: [96, 64],
    metal: 0.48, rough: 0.34, cap: 'sheen' },
  process: { bands: 2, base: STEEL, seam: 'rgba(3,7,12,0.48)', tile: [90, 54],
    metal: 0.72, rough: 0.34, cap: 'grid' },
  pad: { bands: 1, base: [[0, '#dfe8f4'], [1, '#b9c9dc']], tile: [64, 64], metal: 0.2, rough: 0.6, cap: 'grid' },
  block: { bands: 2, base: STEEL, seam: 'rgba(3,7,12,0.45)', tile: [84, 60], metal: 0.6, rough: 0.4, cap: 'grid' },
};

// Dark-mode identity colours are intentionally brighter and farther apart
// than D2's dark SVG palettes. Theme colour remains as a restrained tint;
// an explicit style.fill still takes full control.
export const DARK_FAMILY = {
  pad: 0x33475c,
  block: 0x2864b0,
  service: 0x1670ce,
  db: 0x50677d,
  volume: 0xa96525,
  queue: 0x12685f,
  package: 0xac6c2e,
  state: 0xd99218,
  startstop: 0x536b82,
  person: 0x326bc1,
  cloud: 0xa9c7d8,
  decision: 0xc88e18,
  gateway: 0x7051bd,
  file: 0xb57a2d,
  screen: 0x315f82,
  note: 0xc8a91c,
  component: 0x19865a,
  io: 0x365f80,
  process: 0xb55b27,
};

const S = 256;
const sheet = () => {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  return [c, c.getContext('2d')];
};

function sideMaps(spec) {
  const [ac, a] = sheet();  // albedo
  const [ec, e] = sheet();  // emissive: black except what should glow
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);

  const bh = S / spec.bands;
  for (let i = 0; i < spec.bands; i++) {
    const y = i * bh;

    const grad = a.createLinearGradient(0, y, 0, y + bh);
    for (const [stop, col] of spec.base) grad.addColorStop(stop, col);
    a.fillStyle = grad;
    a.fillRect(0, y, S, bh);

    if (spec.weave) {
      a.strokeStyle = 'rgba(0,0,0,0.07)'; a.lineWidth = 1;
      for (let p = 0; p < S; p += 6) {
        a.beginPath(); a.moveTo(p, y); a.lineTo(p, y + bh); a.stroke();
        a.beginPath(); a.moveTo(0, y + (p % bh)); a.lineTo(S, y + (p % bh)); a.stroke();
      }
    }

    if (spec.vents) {
      a.fillStyle = 'rgba(10,16,26,0.55)';
      for (let v = 0; v < spec.vents; v++) {
        const vy = y + bh * (0.42 + v * 0.1);
        a.beginPath(); a.roundRect(S * 0.3, vy, S * 0.62, bh * 0.06, 3); a.fill();
      }
    }

    if (spec.chevrons) {
      a.strokeStyle = spec.chevrons.color; a.lineWidth = 5;
      e.strokeStyle = spec.chevrons.glow; e.lineWidth = 5;
      for (let x = -S; x < S * 2; x += 46) {
        for (const g of [a, e]) {
          g.beginPath();
          g.moveTo(x, y + bh * 0.72); g.lineTo(x + 20, y + bh * 0.42); g.lineTo(x + 40, y + bh * 0.72);
          g.stroke();
        }
      }
    }

    if (spec.hazard) {
      for (let x = -S; x < S * 2; x += 40) {
        for (const [g, col] of [[a, spec.hazard.a], [e, spec.hazard.glow]]) {
          g.fillStyle = col;
          g.beginPath();
          g.moveTo(x, y + bh); g.lineTo(x + 18, y + bh); g.lineTo(x + 38, y); g.lineTo(x + 20, y);
          g.closePath(); g.fill();
        }
      }
      a.fillStyle = spec.hazard.b;
      a.fillRect(0, y, S, bh * 0.14);
    }

    if (spec.rivets) {
      a.fillStyle = spec.rivets;
      for (let x = 7; x < S; x += 17) {
        for (const ry of [y + bh * 0.09, y + bh * 0.91]) {
          a.beginPath(); a.arc(x, ry, 2, 0, Math.PI * 2); a.fill();
        }
      }
    }

    if (spec.tape) {
      a.fillStyle = spec.tape;
      a.fillRect(0, y + bh * 0.46, S, bh * 0.1);
    }

    if (spec.bay) {
      const { color, x, w, y: by, h, per } = spec.bay;
      for (let n = 0; n < per; n++) {
        const bx = S * (x + n / per);
        const rect = [bx, y + bh * by, S * w, bh * h];
        a.fillStyle = 'rgba(12,18,28,0.75)';
        a.beginPath(); a.roundRect(rect[0] - 3, rect[1] - 3, rect[2] + 6, rect[3] + 6, 4); a.fill();
        for (const [g, col] of [[a, color], [e, color]]) {
          g.fillStyle = col;
          g.beginPath(); g.roundRect(...rect, 3); g.fill();
        }
      }
    }

    if (spec.led) {
      const ly = y + bh * spec.led.y, lh = Math.max(2, bh * spec.led.h);
      for (const g of [a, e]) { g.fillStyle = spec.led.color; g.fillRect(0, ly, S, lh); }
    }

    for (const d of spec.dots ?? []) {
      for (const g of [a, e]) {
        g.fillStyle = d.color;
        g.beginPath(); g.arc(S * d.x, y + bh * d.y, 4, 0, Math.PI * 2); g.fill();
      }
    }

    if (spec.seam) {
      a.fillStyle = spec.seam;
      a.fillRect(0, y + bh - 3, S, 3);
    }
  }

  // A floor of emission everywhere, so hovering visibly flares even the
  // families that have no lights of their own to turn up.
  e.fillStyle = 'rgba(120,170,220,0.05)';
  e.fillRect(0, 0, S, S);

  return { albedo: ac, emissive: ec };
}

function capMap(spec) {
  const [c, g] = sheet();
  const grad = g.createLinearGradient(0, 0, S, S);
  for (const [stop, col] of spec.base) grad.addColorStop(stop, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);

  if (spec.cap === 'rings') {
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    for (let r = 8; r < S; r += 7) {
      g.lineWidth = r % 21 === 8 ? 2 : 1;
      g.beginPath(); g.arc(S / 2, S / 2, r, 0, Math.PI * 2); g.stroke();
    }
    g.fillStyle = 'rgba(40,52,68,0.35)';
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.16, 0, Math.PI * 2); g.fill();
  } else if (spec.cap === 'grid') {
    g.strokeStyle = 'rgba(20,30,45,0.16)'; g.lineWidth = 1;
    for (let p = 0; p <= S; p += 32) {
      g.beginPath(); g.moveTo(p + 0.5, 0); g.lineTo(p + 0.5, S); g.stroke();
      g.beginPath(); g.moveTo(0, p + 0.5); g.lineTo(S, p + 0.5); g.stroke();
    }
  } else if (spec.cap === 'rules') {
    g.strokeStyle = 'rgba(40,70,120,0.2)'; g.lineWidth = 2;
    for (let p = 40; p < S; p += 34) {
      g.beginPath(); g.moveTo(30, p); g.lineTo(S - 30, p); g.stroke();
    }
  } else {
    const sheen = g.createRadialGradient(S * 0.32, S * 0.28, 4, S * 0.5, S * 0.5, S * 0.7);
    sheen.addColorStop(0, 'rgba(255,255,255,0.75)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sheen;
    g.fillRect(0, 0, S, S);
  }
  return c;
}

/**
 * The texture caches for one renderer. `maxAnisotropy` is read lazily because
 * the first textures are asked for while the renderer is still being set up.
 * `shared` lists every texture several materials hold, so dispose() skips them.
 */
export function createSkins(maxAnisotropy = () => 4) {
  // Painted once per family and shared by every shape of that kind, so a diagram
  // of forty databases uploads one set of textures, not forty.
  const skins = new Map();
  function skin(family) {
    if (!skins.has(family)) {
      const spec = SKIN[family];
      skins.set(family, { ...sideMaps(spec), cap: capMap(spec), spec });
    }
    return skins.get(family);
  }

  /**
   * The same canvas at a given repeat. Extruded outlines get UVs in raw world
   * units, so they want 1/tile; primitives get normalised 0..1 UVs, so they want
   * a count. Same pixels either way — clones share the image.
   */
  const shared = new Set();
  const tiles = new Map();
  const patternTiles = new Map();
  function tex(family, which, rx, ry) {
    const key = `${family}|${which}|${rx}|${ry}`;
    if (!tiles.has(key)) {
      const t = new THREE.CanvasTexture(skin(family)[which]);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      // Oblique textured faces otherwise crawl as the camera orbits. Use the
      // renderer's real limit but stop at eight; higher values cost bandwidth
      // without a useful difference at these texture sizes.
      t.anisotropy = Math.min(8, maxAnisotropy());
      t.repeat.set(rx, ry);
      tiles.set(key, t);
      shared.add(t);
    }
    return tiles.get(key);
  }

  const worldTex = (family, which) => {
    const [u, v] = SKIN[family].tile;
    return tex(family, which, 1 / u, which === 'cap' ? 1 / u : 1 / v);
  };

  /** A style.fill-pattern becomes subtle physical relief on the 3D material. */
  function patternTex(kind) {
    if (!kind || kind === 'none') return null;
    if (!patternTiles.has(kind)) {
      const c = document.createElement('canvas');
      c.width = c.height = 96;
      const g = c.getContext('2d');
      g.fillStyle = '#777'; g.fillRect(0, 0, 96, 96);
      g.fillStyle = '#ddd'; g.strokeStyle = '#ddd'; g.lineWidth = 5;
      if (kind === 'dots') {
        for (let y = 12; y < 96; y += 24) for (let x = 12; x < 96; x += 24) {
          g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
        }
      } else if (kind === 'lines') {
        for (let p = -96; p < 192; p += 24) {
          g.beginPath(); g.moveTo(p, 0); g.lineTo(p + 96, 96); g.stroke();
        }
      } else {
        for (let i = 0; i < 650; i++) {
          const v = kind === 'paper' ? 130 + Math.random() * 55 : Math.random() * 255;
          g.fillStyle = `rgb(${v} ${v} ${v})`;
          g.fillRect(Math.random() * 96, Math.random() * 96, kind === 'paper' ? 5 : 2, 1);
        }
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(4, 4);
      t.anisotropy = Math.min(8, maxAnisotropy());
      patternTiles.set(kind, t);
      shared.add(t);
    }
    return patternTiles.get(kind);
  }

  return { tex, worldTex, patternTex, shared };
}
