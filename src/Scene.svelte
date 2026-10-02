<script>
  // 3D mode is a real renderer, not a skin. d2 still compiles the diagram and
  // lays it out; this reads the geometry out of the compiled result and builds
  // actual solids from it — extruded outlines, lit, shadowed, orbitable.
  //
  // The SVG stays in the DOM (hidden) for two reasons: Download SVG still works,
  // and resolved theme/style values are read off it, so d2's palette table never
  // has to be duplicated here.
  import * as THREE from 'three';
  import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
  import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
  import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
  import { unsafeAttr } from './sanitize.js';
  import { app } from './store.svelte.js';
  import { keys } from './blocks.js';
  import { markdownHint } from './md.js';
  import { t } from './i18n/index.svelte.js';
  import { familyOf, heightOf, bodyFor, resolvedType } from './models.js';

  let { maps } = $props();

  let canvas = $state(null);
  let tip = $state(null); // { text, x, y } — a hovered tooltip, in stage pixels
  let box = $state(null);
  let world = null; // everything three owns, once it exists
  // Set once, never read inside the effect that sets it: `ready++` would be a
  // read and a write of the same state, which re-runs init on its own output.
  let ready = $state(false);

  const BG = 0x0b1017;
  const HOVER = new THREE.Color(0x7dd3fc); // the tint a hovered object takes on
  const DARK_BG = 0x121c26; // dark-theme objects need separation from the stage
  const PAD = heightOf('', 0, 0, true); // a container platform's thickness
  const darkAppearance = () => app.appearance === 'dark'
    || (app.appearance === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);

  // -------------------------------------------------------------------- labels

  const FONT = (px, style = {}) =>
    `${style.italic ? 'italic ' : ''}${style.bold === false ? 500 : 700} ${px}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;

  /**
   * A label is a sprite, so it faces the camera from every angle — text lying on
   * the floor is unreadable the moment the camera tilts.
   */
  function plaque(text, px = 30, style = {}) {
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

  // ------------------------------------------------------------------- skins

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

  const SKIN = {
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
    paper: { bands: 1, base: [[0, '#ffffff'], [1, '#e9edf3']], tile: [80, 64], metal: 0.0, rough: 0.7,
      rules: 5, cap: 'rules' },
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
  const DARK_FAMILY = {
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
    paper: 0xcabfa8,
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

      if (spec.rules) {
        a.strokeStyle = 'rgba(40,70,120,0.22)'; a.lineWidth = 2;
        for (let r = 1; r <= spec.rules; r++) {
          const ry = y + (bh * r) / (spec.rules + 1);
          a.beginPath(); a.moveTo(S * 0.12, ry); a.lineTo(S * 0.88, ry); a.stroke();
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
      t.anisotropy = Math.min(8, world?.renderer.capabilities.getMaxAnisotropy() ?? 4);
      t.repeat.set(rx, ry);
      tiles.set(key, t);
      shared.add(t);
    }
    return tiles.get(key);
  }

  /** World-unit tiling, for the extruded outlines. */
  /** Blend a fill toward black — trim, recesses, the gaps between drives. */
  const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

  /**
   * PBR texture maps multiply their pixels by material colour. Very dark d2
   * theme swatches therefore become black after texturing and tone mapping.
   * Preserve hue/saturation but keep shells inside a readable studio range.
   */
  function studioColor(value, minLight = 0.27, maxLight = 0.78) {
    const color = new THREE.Color(value);
    const hsl = {};
    color.getHSL(hsl);
    color.setHSL(hsl.h, Math.max(0.16, hsl.s), Math.min(maxLight, Math.max(minLight, hsl.l)));
    return color;
  }

  function naturalColor(value, darkScene) {
    const color = new THREE.Color(value);
    if (!darkScene) return color;
    const hsl = {};
    color.getHSL(hsl);
    // Lift near-black rubber, bezels and steel without turning them grey or
    // erasing the contrast between those details and the main shell.
    color.setHSL(hsl.h, hsl.s, Math.max(0.065, hsl.l));
    return color;
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
      t.anisotropy = Math.min(8, world?.renderer.capabilities.getMaxAnisotropy() ?? 4);
      patternTiles.set(kind, t);
      shared.add(t);
    }
    return patternTiles.get(kind);
  }


  /**
   * A current travelling through an illuminated rail set into the conduit.
   * There are no marching decals or floating particles: direction is a smooth
   * voltage wave. The rails wind around the conduit and slowly rotate, so an
   * orbiting camera always sees part of the current instead of finding a dark
   * side where a fixed longitudinal strip is hidden behind the cable.
   */
  function currentMaterial(forwardColor, backwardColor, forward, backward) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uForwardColor: { value: new THREE.Color(forwardColor) },
        uBackwardColor: { value: new THREE.Color(backwardColor) },
        uForward: { value: forward ? 1 : 0 },
        uBackward: { value: backward ? 1 : 0 },
        uStartSocket: { value: backward ? 1 : 0 },
        uEndSocket: { value: forward ? 1 : 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform vec3 uForwardColor;
        uniform vec3 uBackwardColor;
        uniform float uForward;
        uniform float uBackward;
        uniform float uStartSocket;
        uniform float uEndSocket;

        float rail(float centre) {
          float around = min(abs(vUv.y - centre), 1.0 - abs(vUv.y - centre));
          return 1.0 - smoothstep(0.025, 0.105, around);
        }

        float windingRail(float direction, float phase) {
          // Two opposite strands form a shallow helix. Advancing the centre
          // makes the current circle the cable; the length term keeps several
          // illuminated crossings visible even when the camera looks end-on.
          float centre = fract(
            vUv.x * 2.35 - uTime * 0.34 * direction + phase
          );
          return max(rail(centre), rail(fract(centre + 0.5)));
        }

        float voltage(float direction, float phase) {
          float x = vUv.x * 15.0 - uTime * 4.6 * direction + phase;
          // A pronounced but clean travelling pulse: one smooth envelope rather
          // than mixed-frequency noise, so it surges without looking scratched.
          float wave = 0.5 + 0.5 * sin(x);
          return 0.2 + 0.76 * wave * wave;
        }

        void main() {
          // Forward and reverse currents spiral in opposite directions. Each
          // has an antipodal strand, guaranteeing a lit face from every orbit
          // angle while retaining distinct colours on bidirectional cables.
          float f = uForward * windingRail(1.0, 0.0) * voltage(1.0, 0.0);
          float b = uBackward * windingRail(-1.0, 0.25) * voltage(-1.0, 2.1);
          // The cable continues into the metal socket, but its light dies before
          // that junction. Without this feather the final bright texels formed
          // a visibly clipped ring at the arrow tail.
          float socketFade = 1.0;
          socketFade *= mix(1.0, smoothstep(0.0, 0.065, vUv.x), uStartSocket);
          socketFade *= mix(1.0, smoothstep(0.0, 0.065, 1.0 - vUv.x), uEndSocket);
          f *= socketFade;
          b *= socketFade;
          float energy = max(f, b);
          float hot = smoothstep(0.62, 0.94, energy);
          vec3 currentColor = (uForwardColor * f + uBackwardColor * b)
            / max(0.001, f + b);
          gl_FragColor = vec4(currentColor * (1.02 + hot * 0.82), energy * 0.94);
        }
      `,
      transparent: true,
      depthWrite: false,
      // Keep the luminous skin decisively in front of the metal conduit. This
      // prevents depth-buffer speckling along bends without disabling occlusion.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
  }

  const poly = (pts, Kind = THREE.Shape) => new Kind(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  /** A rectangle `t` wide along the segment a→b, for bars and crow's-foot prongs. */
  const bar = ([ax, ay], [bx, by], t) => {
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const [nx, ny] = [(-(by - ay) / len) * t / 2, ((bx - ax) / len) * t / 2];
    return poly([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]]);
  };
  /** An outline-only head is the filled one with a smaller copy cut out of it. */
  const hollow = (outer, inner) => { outer.holes.push(inner); return outer; };
  const circle = (r, Kind = THREE.Shape) => new Kind().absarc(0, 0, r, 0, Math.PI * 2, false);

  /**
   * d2's arrowheads as flat outlines, centred at the origin and pointing local
   * +Y: triangles, diamonds, circles, boxes, crosses and crow's feet, filled or
   * hollow. Each is a list of shapes, since a crow's foot is several strokes.
   */
  function headShapes(kind, L, W) {
    const shaft = W / 2;
    const scaled = (pts, k) => pts.map(([x, y]) => [x * k, y * k]);
    const diamond = [[0, L / 2], [W / 2, 0], [0, -L / 2], [-W / 2, 0]];
    const box = [[-W / 2, -W / 2], [W / 2, -W / 2], [W / 2, W / 2], [-W / 2, W / 2]];
    const tri = [[-W / 2, -L * 0.3], [W / 2, -L * 0.3], [0, L / 2]];
    const stub = bar([0, -L / 2], [0, 0], shaft); // carries the cable's line into a free-standing head
    const crow = [[-W / 2, L / 2], [0, L / 2], [W / 2, L / 2]].map((tip) => bar([0, -L * 0.1], tip, 3));
    const cross = (y) => bar([-W / 2, y], [W / 2, y], 3.4);
    switch (kind) {
      case 'diamond': return [stub, hollow(poly(diamond), poly(scaled(diamond, 0.5), THREE.Path))];
      case 'filled-diamond': return [stub, poly(diamond)];
      case 'circle': return [stub, hollow(circle(W / 2), circle(W / 4, THREE.Path))];
      case 'filled-circle': return [stub, circle(W / 2)];
      case 'box': return [stub, hollow(poly(box), poly(scaled(box, 0.5), THREE.Path))];
      case 'filled-box': return [stub, poly(box)];
      case 'unfilled-triangle': return [stub, hollow(poly(tri), poly(scaled(tri, 0.45), THREE.Path))];
      case 'cross': return [bar([-W / 2, -L / 2], [W / 2, L / 2], 3.4), bar([W / 2, -L / 2], [-W / 2, L / 2], 3.4)];
      case 'cf-one': return [bar([0, -L / 2], [0, L / 2], 3), cross(L * 0.15)];
      case 'cf-one-required': return [bar([0, -L / 2], [0, L / 2], 3), cross(L * 0.15), cross(-L * 0.15)];
      case 'cf-many': return [bar([0, -L / 2], [0, 0], 3), ...crow];
      case 'cf-many-required': return [bar([0, -L / 2], [0, 0], 3), ...crow, cross(-L * 0.3)];
      default: { // triangle, arrow: a wayfinding arrow
        // The shaft is wider than the conduit and its luminous skin. Matching them
        // exactly made the rubber appear to poke through the arrow at oblique views.
        const s = W / 2;
        return [poly([[-s / 2, -L / 2], [s / 2, -L / 2], [s / 2, L * 0.06], [W / 2, L * 0.06],
          [0, L / 2], [-W / 2, L * 0.06], [-s / 2, L * 0.06]])];
      }
    }
  }

  /** A beveled arrowhead of d2's `kind`, centred at the origin and pointing local +Y. */
  function arrowPlateGeometry(scale = 1, depth = 3.2, kind = 'triangle') {
    const s = headShapes(kind, 24 * scale, 18 * scale);
    const bevel = Math.min(1.2, depth * 0.25);
    const geo = new THREE.ExtrudeGeometry(s, {
      depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
      bevelSegments: 2, curveSegments: 4,
    });
    geo.translate(0, 0, -depth / 2);
    return geo;
  }

  function physicalArrow(position, direction, id, currentColor, kind) {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({
      color: 0x34424c, metalness: 0.82, roughness: 0.28, envMapIntensity: 1.2,
    });
    const outer = new THREE.Mesh(arrowPlateGeometry(1, 4, kind), metal);
    // Small connection shadows are subpixel at ordinary zoom and shimmer over
    // the ground. The larger architecture objects still anchor the scene.
    outer.castShadow = false;
    outer.receiveShadow = true;
    g.add(outer);

    // A short socket hides the cable termination inside real geometry. The
    // conduit ends within this collar instead of meeting the arrow on a nearly
    // coplanar edge, which previously exposed the glow shell as camera moved.
    const socket = new THREE.Mesh(
      // Open-ended is important: a closed rear disk intersects the incoming
      // rubber tube and flickers between the two surfaces at oblique angles.
      new THREE.CylinderGeometry(4.7, 5.2, 8, 20, 1, true),
      metal,
    );
    socket.position.y = -15.5;
    socket.castShadow = false;
    socket.receiveShadow = true;
    g.add(socket);

    // Put the secondary light on actual arrow hardware. A luminous collar on
    // the socket visually hands current from the cable to the face inserts;
    // unlike a billboard halo it cannot float away from the rubber when viewed
    // edge-on.
    const collarLight = new THREE.Mesh(
      new THREE.TorusGeometry(4.95, 0.48, 8, 24),
      new THREE.MeshBasicMaterial({ color: currentColor, toneMapped: false }),
    );
    collarLight.rotation.x = Math.PI / 2;
    collarLight.position.y = -13.4;
    g.add(collarLight);

    // Raised illuminated inserts on both faces keep direction readable while
    // orbiting. There is deliberately no enlarged transparent arrow around
    // them: that separate silhouette looked detached from the physical body.
    for (const side of [-1, 1]) {
      const insert = new THREE.Mesh(
        arrowPlateGeometry(0.66, 1.2, kind),
        new THREE.MeshBasicMaterial({ color: currentColor, toneMapped: false }),
      );
      insert.position.z = side * 2.75;
      g.add(insert);
    }

    g.position.copy(position);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    g.userData = { id };
    return g;
  }

  /**
   * Follow d2's routed polyline, but replace every hard elbow with a cubic
   * Bézier bend. Trimming is capped by each neighbouring segment, so short routes stay
   * inside their corridor instead of a spline bulging through nearby objects.
   */
  function roundedRoute(points, radius = 22) {
    const path = new THREE.CurvePath();
    if (points.length < 2) return path;
    let cursor = points[0].clone();

    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1], corner = points[i], next = points[i + 1];
      const before = corner.distanceTo(prev), after = corner.distanceTo(next);
      if (before < 0.001 || after < 0.001) continue;
      const trim = Math.min(radius, before * 0.38, after * 0.38);
      const incoming = corner.clone().sub(prev).normalize();
      const outgoing = next.clone().sub(corner).normalize();
      const enter = corner.clone().addScaledVector(incoming, -trim);
      const leave = corner.clone().addScaledVector(outgoing, trim);
      const handle = trim * 0.62;
      const controlIn = enter.clone().addScaledVector(incoming, handle);
      const controlOut = leave.clone().addScaledVector(outgoing, -handle);
      if (cursor.distanceTo(enter) > 0.001) path.add(new THREE.LineCurve3(cursor, enter));
      path.add(new THREE.CubicBezierCurve3(enter, controlIn, controlOut, leave));
      cursor = leave;
    }

    if (cursor.distanceTo(points.at(-1)) > 0.001) {
      path.add(new THREE.LineCurve3(cursor, points.at(-1).clone()));
    }
    return path;
  }

  /**
   * A cable along `curve`; with `dash` set, d2's stroke-dash, as separate lengths
   * of cable with gaps between them. Each length gets the whole 0..1 UV run, so
   * the current pulses within every dash rather than across the gaps.
   */
  function cableGeometry(curve, radius, segments, sides, dash) {
    if (!dash) return new THREE.TubeGeometry(curve, segments, radius, sides, false);
    const length = Math.max(1, curve.getLength());
    const on = 6 + dash * 2.5;
    const count = Math.min(60, Math.max(1, Math.round(length / (on * 1.8))));
    const pieces = [];
    for (let i = 0; i < count; i++) {
      const start = i / count;
      const piece = curveSection(curve, start, start + (1 / count) * 0.55);
      pieces.push(new THREE.TubeGeometry(piece, 4, radius, sides, false));
    }
    const merged = mergeGeometries(pieces);
    for (const p of pieces) p.dispose();
    return merged;
  }

  /** An arc-length section of a curve, used to stop conduit beneath arrowheads. */
  function curveSection(curve, start, end) {
    const section = new THREE.Curve();
    section.getPoint = (t, target = new THREE.Vector3()) =>
      target.copy(curve.getPointAt(THREE.MathUtils.lerp(start, end, t)));
    return section;
  }

  // --------------------------------------------------------------------- build

  const asNumber = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const usableColor = (value, fallback) =>
    value && value !== 'none' && !String(value).startsWith('url(') ? value : fallback;
  // d2 hands unset colours over as theme tokens (N1, B4, AA2…) and resolves them
  // only in the SVG. Anything else was written by someone: a style, a class, a var.
  const explicit = (v) => (v && v !== 'transparent' && !/^[A-Z]{1,2}\d$/.test(v) ? v : undefined);
  // ponytail: d2's default label sizes; an explicit size equal to one is ignored.
  const DEFAULT_FONT = new Set([16, 20, 24, 28]);

  /**
   * The style d2 actually resolved for a shape or connection. Read from the
   * compiled object, not the editor's style blocks, so classes, vars, globs and
   * imports all count; colours still come off the painted SVG, which is the only
   * place theme tokens are turned into the selected light/dark palette.
   */
  const paintOf = (o) => {
    const root = maps.byId.get(o.id);
    // Shapes keep their paint below `.shape`; connections are paths directly
    // inside their tagged group. Supporting both makes themed current possible.
    const el = root?.querySelector('.shape > :not([class*="-overlay"])')
      ?? root?.querySelector('path, polyline, line');
    const css = el ? getComputedStyle(el) : null;
    const text = root?.querySelector('text');
    const textCss = text ? getComputedStyle(text) : null;
    const fill = explicit(o.fill), stroke = explicit(o.stroke);
    return {
      fill: usableColor(fill, usableColor(css?.fill, el?.getAttribute('fill') ?? '#456b8c')),
      stroke: usableColor(stroke, usableColor(css?.stroke, el?.getAttribute('stroke') ?? '#93b8d4')),
      opacity: Math.min(1, Math.max(0, asNumber(o.opacity, 1))),
      strokeWidth: asNumber(o.strokeWidth, 2),
      pattern: o.fillPattern || root?.querySelector('[class$="-overlay"]')?.classList?.[0]?.replace('-overlay', ''),
      animated: !!o.animated,
      explicitFill: fill,
      explicitStroke: stroke,
      label: {
        color: usableColor(explicit(o.color), usableColor(textCss?.fill, '#f7f8fa')),
        stroke: usableColor(stroke, 'rgba(255,255,255,0.18)'),
        bold: o.bold,
        italic: o.italic,
        underline: o.underline,
        transform: textCss?.textTransform,
        size: o.fontSize && !DEFAULT_FONT.has(o.fontSize)
          ? Math.min(80, Math.max(16, o.fontSize * 1.75)) : null,
      },
    };
  };

  function applyStyle(body, visual) {
    const bump = patternTex(visual.pattern);
    const accent = studioColor(visual.stroke, visual.darkScene ? 0.64 : 0.5, 0.92);
    body.userData.animated = visual.animated;
    body.traverse((n) => {
      if (!n.isMesh) return;
      if (visual.shadow === false) n.castShadow = false;
      for (const m of Array.isArray(n.material) ? n.material : n.material ? [n.material] : []) {
        if (visual.opacity < 1) {
          m.transparent = true;
          m.opacity *= visual.opacity;
          // A translucent outer shell must not hide its own internal parts.
          m.depthWrite = false;
        }
        if (bump && m.userData.themePart
          && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) && !m.bumpMap) {
          m.bumpMap = bump;
          m.bumpScale = visual.pattern === 'grain' ? 0.55 : 1.1;
        }
        if (m.userData.themePart && m.emissive && visual.strokeWidth > 0) {
          m.emissive.copy(accent);
          m.emissiveIntensity = Math.max(m.emissiveIntensity ?? 0, Math.min(0.3, visual.strokeWidth * 0.026));
        }
        m.needsUpdate = true;
      }
    });
  }

  // ------------------------------------------------------------ borrowed art

  /** d2 serialises an icon as Go's url.URL; only web and inline images are loaded. */
  function iconUrl(icon) {
    if (!icon) return null;
    const url = typeof icon === 'string' ? icon
      : `${icon.Scheme}:${icon.Host ? `//${icon.Host}` : ''}${icon.Opaque || icon.Path}${icon.RawQuery ? `?${icon.RawQuery}` : ''}`;
    return /^(https?:|data:image\/)/i.test(url) ? url : null;
  }

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
    const g = maps.byId.get(s.id);
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
      world?.invalidate?.();
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

  const PANELS = new Set(['sql_table', 'class', 'code']);
  const isPanel = (s) => PANELS.has(s.type) || (s.type === 'text' && s.language === 'latex');
  const SLAB = 10;

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

  function build(diagram) {
    const group = new THREE.Group();
    const dashes = [];
    const mdPanels = new Map();
    if (!diagram?.shapes?.length) return { group, dashes, mdPanels, meta: new Map() };
    // The editor only knows the root board; a layer's ids can mean other shapes.
    const sourceShapes = new Map((app.board ? [] : keys(app.blocks)).map(({ key, name, shape, md }) =>
      [key, { name, shape, md }]));
    const typeOf = (shape) => resolvedType(shape.type, sourceShapes.get(shape.id));
    const meta = new Map(); // id → { tooltip, link }, for the pointer handlers
    const darkScene = darkAppearance();

    const ids = diagram.shapes.map((s) => s.id);
    const byId = new Map(diagram.shapes.map((s) => [s.id, s]));
    // A sequence diagram nests spans and notes *inside* actors, but draws them
    // beside the actor down its lifeline. Everything in one stands on the
    // diagram's own platform, and only its groups (d2 marks them `blend`) are
    // areas; an actor with spans is still an actor, not a platform.
    const sequenceOf = (id) => {
      for (let i = id.lastIndexOf('.'); i > 0; i = id.lastIndexOf('.', i - 1)) {
        const up = byId.get(id.slice(0, i));
        if (up?.type === 'sequence_diagram') return up;
      }
      return null;
    };
    const isContainer = (id) => {
      const s = byId.get(id);
      if (s?.type === 'sequence_diagram') return true;
      if (sequenceOf(id)) return !!s?.blend;
      return ids.some((o) => o.startsWith(`${id}.`));
    };
    const liftOf = (s) => {
      const seq = sequenceOf(s.id);
      return seq ? seq.level * PAD : ((s.level ?? 1) - 1) * PAD;
    };
    const depthOf = (s) => (s.type === 'image' ? s.height
      : isPanel(s) ? SLAB
        : heightOf(typeOf(s), s.width, s.height, isContainer(s.id)));

    // d2 lays out in screen coordinates; the model is centred so orbiting spins
    // around the diagram rather than around wherever d2 happened to put it.
    const bounds = new THREE.Box2();
    for (const s of diagram.shapes) {
      bounds.expandByPoint(new THREE.Vector2(s.pos?.x ?? 0, s.pos?.y ?? 0));
      bounds.expandByPoint(new THREE.Vector2((s.pos?.x ?? 0) + s.width, (s.pos?.y ?? 0) + s.height));
    }
    const mid = bounds.getCenter(new THREE.Vector2());
    const at = (x, y) => [x - mid.x, y - mid.y];

    for (const s of diagram.shapes) {
      const source = sourceShapes.get(s.id);
      const container = isContainer(s.id);
      const type = typeOf(s);
      const note = type === 'text' && !isPanel(s);
      const icon = iconUrl(s.icon);
      if (s.tooltip || s.link) meta.set(s.id, { tooltip: s.tooltip, link: s.link });
      const visual = paintOf(s);
      visual.darkScene = darkScene;
      const { fill, stroke } = visual;
      const family = container ? 'pad' : (SKIN[familyOf(type)] ? familyOf(type) : 'block');
      const themeShell = studioColor(fill, visual.explicitFill ? 0.23 : 0.3, 0.76);
      const shellColor = container && darkScene && !visual.explicitFill
        ? new THREE.Color(0x263746)
        : darkScene && !visual.explicitFill
          ? new THREE.Color(DARK_FAMILY[family] ?? DARK_FAMILY.block).lerp(themeShell, 0.18)
          : themeShell;
      const accentColor = container && darkScene && !visual.explicitStroke
        ? new THREE.Color(0x587790)
        : studioColor(stroke, darkScene ? 0.64 : 0.5, 0.92);
      const [cx, cz] = at((s.pos?.x ?? 0) + s.width / 2, (s.pos?.y ?? 0) + s.height / 2);
      // Children stand *on* their container's platform, not on the world floor —
      // otherwise every one of them is buried to the depth of the pad. d2's level
      // counts the nesting, and every platform is the same thickness.
      const lift = liftOf(s);

      // A note is borderless by definition — d2 draws it as bare markdown, so in
      // 3D it is its label and nothing else. Give it a body and it becomes a box,
      // which is the one thing the shape exists to avoid.
      if (note) {
        if (source?.md) {
          const summary = markdownHint(s.label);
          const badge = plaque(`${source.name} · ¶`, 20, visual.label);
          const panel = plaque(
            `${source.name} · ${summary.text}`,
            visual.label.size ?? 25,
            visual.label,
          );
          const open = world?.openMd?.has(s.id) ?? false;
          badge.visible = !open;
          panel.visible = open;
          badge.position.set(cx, lift + 24, cz);
          panel.position.copy(badge.position);
          badge.userData = panel.userData = { id: s.id, mdHint: true };
          mdPanels.set(s.id, { badge, panel });
          group.add(badge, panel);
        } else if (s.label) {
          const tag = plaque(s.label, visual.label.size ?? 30, visual.label);
          tag.position.set(cx, lift + 24, cz);
          tag.userData = { id: s.id };
          group.add(tag);
        }
        continue;
      }

      // A family added in models.js without a skin here would otherwise take the
      // whole scene down; a plain one is a better failure than a black canvas.
      const spec = SKIN[family];
      const glow = container ? (darkScene ? 0.08 : 0.32) : 1;
      const depth = depthOf(s);
      const markThemed = (material) => {
        material.userData.themePart = true;
        return material;
      };

      // The palette every body draws from. `band` is the family skin at a UV
      // count rather than in world units, because a primitive's UVs are 0..1;
      // `lid`/`wall` are the same skin tiled in world units, for the extrusions.
      const M = {
        band: (rx, ry) => markThemed(new THREE.MeshStandardMaterial({
          color: shellColor, map: tex(family, 'albedo', rx, ry),
          emissive: new THREE.Color(0xffffff), emissiveMap: tex(family, 'emissive', rx, ry),
          emissiveIntensity: glow, metalness: spec.metal, roughness: spec.rough, envMapIntensity: 1.0,
        })),
        cap: () => markThemed(new THREE.MeshStandardMaterial({
          color: shellColor, map: tex(family, 'cap', 1, 1),
          emissive: accentColor, emissiveIntensity: 0.075,
          metalness: spec.metal, roughness: spec.rough, envMapIntensity: 1.0,
        })),
        metal: (m, r) => new THREE.MeshStandardMaterial({
          color: naturalColor(0x7d8994, darkScene), metalness: m, roughness: r,
          envMapIntensity: darkScene ? 1.35 : 1.0,
        }),
        dark: (k) => new THREE.MeshStandardMaterial({
          color: naturalColor(0x202832, darkScene).multiplyScalar(0.7 + k * 0.45),
          metalness: 0.5, roughness: 0.58, envMapIntensity: darkScene ? 1.0 : 0.8,
        }),
        gloss: () => markThemed(new THREE.MeshStandardMaterial({
          color: shellColor, metalness: 0.2, roughness: 0.14,
          emissive: accentColor, emissiveIntensity: 0.075, envMapIntensity: 1.0,
        })),
        matte: () => markThemed(new THREE.MeshStandardMaterial({
          color: shellColor, metalness: 0.02, roughness: 0.85,
          emissive: accentColor, emissiveIntensity: 0.075, envMapIntensity: 0.7,
        })),
        // Real objects need materials that are allowed to keep their natural
        // colour. The diagram fill still owns the main shell; these are for
        // cardboard, paper, rubber, skin, glass and other identifying details.
        surface: (color, metalness = 0.02, roughness = 0.68) => new THREE.MeshStandardMaterial({
          color: naturalColor(color, darkScene), metalness, roughness,
          envMapIntensity: metalness > 0.4 ? (darkScene ? 1.4 : 1.15) : (darkScene ? 0.95 : 0.75),
        }),
        primary: (color, metalness = 0.02, roughness = 0.68) => {
          const natural = naturalColor(color, darkScene);
          const themeColor = shellColor;
          const resolved = visual.explicitFill ? themeColor : natural.lerp(themeColor, 0.32);
          return markThemed(new THREE.MeshStandardMaterial({
            color: resolved, metalness, roughness, envMapIntensity: metalness > 0.4 ? 1.15 : 0.75,
          }));
        },
        glass: (color = 0xbfe9ff, opacity = 0.68) => new THREE.MeshPhysicalMaterial({
          color, metalness: 0, roughness: 0.12, transmission: 0.18,
          transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
          clearcoat: 1, clearcoatRoughness: 0.08,
          envMapIntensity: 1.25,
        }),
        led: (c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }),
        lid: () => markThemed(new THREE.MeshStandardMaterial({
          color: shellColor, map: worldTex(family, 'cap'),
          emissive: new THREE.Color(0xffffff), emissiveMap: worldTex(family, 'emissive'),
          emissiveIntensity: glow, metalness: spec.metal, roughness: spec.rough, envMapIntensity: 1.0,
        })),
        wall: () => markThemed(new THREE.MeshStandardMaterial({
          color: shellColor, map: worldTex(family, 'albedo'),
          emissive: new THREE.Color(0xffffff), emissiveMap: worldTex(family, 'emissive'),
          emissiveIntensity: glow, metalness: spec.metal, roughness: spec.rough, envMapIntensity: 1.0,
        })),
        // A crisp lit edge, so a container reads as a bounded area from any angle.
        rim: (geo) => {
          const edge = new THREE.LineSegments(
            new THREE.EdgesGeometry(geo, 25),
            new THREE.LineBasicMaterial({
              color: accentColor, transparent: true,
              opacity: container ? (darkScene ? 0.46 : 0.7) : 0.92,
              toneMapped: false,
            }),
          );
          edge.rotation.x = -Math.PI / 2;
          edge.position.y = 0.4;
          return edge;
        },
      };

      const body = s.type === 'image'
        ? (icon ? picture(icon, s.width, s.height, s.id) : new THREE.Group())
        : isPanel(s) ? panelBody(s, M)
          : bodyFor({ type, width: s.width, height: s.height, container }, M);

      // add, not set: bodyFor already seated it on the floor and centred it.
      body.position.x += cx;
      body.position.y += lift;
      body.position.z += cz;
      body.userData = { ...body.userData, id: s.id, glow };
      body.traverse((n) => {
        if (!n.isMesh) return;
        // LEDs, keys and other tiny parts created unstable subpixel shadows and
        // multiplied the shadow pass. Keep shadows for substantial opaque parts.
        n.geometry.computeBoundingSphere();
        const materials = Array.isArray(n.material) ? n.material : [n.material];
        const opaque = materials.every((material) => !material.transparent && material.opacity >= 1);
        n.castShadow = !container && opaque && (n.geometry.boundingSphere?.radius ?? 0) >= 4;
        n.receiveShadow = true;
        n.frustumCulled = false;
      });
      applyStyle(body, visual);
      group.add(body);

      // An icon floats over its object; a group's sits in the platform's corner
      // so the children standing on it don't hide it.
      if (icon && s.type !== 'image') {
        const size = Math.min(72, Math.min(s.width, s.height) * (container ? 0.3 : 0.5));
        const badge = picture(icon, size, size, s.id);
        badge.position.add(container
          ? new THREE.Vector3(cx - s.width / 2 + size * 0.7, lift + depth + 4, cz - s.height / 2 + size * 0.7)
          : new THREE.Vector3(cx, lift + depth + 6, cz - s.height * 0.15));
        group.add(badge);
      }

      // A table, class, code block or formula carries its label in its drawing.
      if ((s.label || source?.md) && !isPanel(s)) {
        const summary = source?.md ? markdownHint(s.label) : null;
        const tag = source?.md
          ? plaque(`${source.name} · ${summary.text}`, visual.label.size ?? 25, visual.label)
          : plaque(s.label, visual.label.size ?? (container ? 32 : 30), visual.label);
        // A billboard centred over the footprint is intersected by its own body
        // and, for groups, by the children standing on the platform. Seat every
        // plaque just beyond the front edge instead. It remains depth-tested, so
        // orbiting behind the object hides it naturally rather than showing it
        // through the body.
        const verticalClearance = tag.scale.y * 0.56;
        const frontClearance = Math.max(5, tag.scale.y * 0.14);
        tag.position.set(
          cx,
          // d2 captions a picture underneath it; anywhere higher covers it.
          lift + (s.type === 'image' ? 0 : depth) + verticalClearance,
          cz + s.height / 2 + frontClearance,
        );
        tag.userData = { id: s.id };
        if (source?.md) {
          const badge = plaque(`${source.name} · ¶`, 20, visual.label);
          badge.position.copy(tag.position);
          badge.userData = { id: s.id, mdHint: true };
          tag.userData.mdHint = true;
          const open = world?.openMd?.has(s.id) ?? false;
          badge.visible = !open;
          tag.visible = open;
          mdPanels.set(s.id, { badge, panel: tag });
          group.add(badge, tag);
        } else {
          group.add(tag);
        }
      }
    }

    // Connections float a little off the floor so they read as links between
    // objects rather than as markings painted on the ground.
    const LIFT = 16;
    const solid = new Map(diagram.shapes.map((s) => {
      const [x, z] = at((s.pos?.x ?? 0) + s.width / 2, (s.pos?.y ?? 0) + s.height / 2);
      const base = liftOf(s);
      return [s.id, {
        x, z, base, top: base + depthOf(s),
        half: { x: s.width / 2, z: s.height / 2 },
      }];
    }));

    /** The point on a shape's footprint edge nearest `p` — where a link should leave it. */
    const rimOf = (box, p) => {
      const dx = [p.x - (box.x - box.half.x), (box.x + box.half.x) - p.x];
      const dz = [p.z - (box.z - box.half.z), (box.z + box.half.z) - p.z];
      const near = Math.min(...dx, ...dz);
      if (near === dx[0]) return new THREE.Vector3(box.x - box.half.x, 0, p.z);
      if (near === dx[1]) return new THREE.Vector3(box.x + box.half.x, 0, p.z);
      if (near === dz[0]) return new THREE.Vector3(p.x, 0, box.z - box.half.z);
      return new THREE.Vector3(p.x, 0, box.z + box.half.z);
    };

    for (const c of diagram.connections ?? []) {
      const from = solid.get(c.src), to = solid.get(c.dst);
      // Connections are present in d2's SVG map too, so their resolved stroke
      // follows the selected light/dark theme just like shape accents do.
      const connectionPaint = paintOf(c);
      const currentColor = studioColor(
        connectionPaint.stroke,
        darkScene ? 0.67 : 0.53,
        darkScene ? 0.96 : 0.9,
      );
      // Ride above whichever end stands higher, so a link between two boxes on a
      // platform runs over the platform rather than through it.
      const floor = Math.max(from?.base ?? 0, to?.base ?? 0) + LIFT;
      const flat = (c.route ?? []).map((p) => {
        const [x, z] = at(p.x, p.y);
        return new THREE.Vector3(x, floor, z);
      });
      if (flat.length < 2) continue;
      // d2 routes in 2D, where a container-to-child line is a short hop across
      // the container's own floor. In 3D that hop starts inside the solids
      // standing on it, so the line appears to come out of nowhere.
      const down = c.dst?.startsWith(`${c.src}.`);   // container → child
      const up = c.src?.startsWith(`${c.dst}.`);     // child → container
      const nested = down || up;

      let pts;
      if (nested && from && to) {
        // Off the platform's rim, over, and down onto the child's roof.
        //
        // Not d2's own route point: inside a container that lands wherever the 2D
        // router liked, which is often right beside a sibling — so the line looks
        // like it comes out of *that* box rather than out of the group. Leaving
        // from the nearest point on the platform's perimeter is unambiguous.
        const [outer, inner] = down ? [from, to] : [to, from];
        const lid = new THREE.Vector3(inner.x, inner.top + 4, inner.z);
        const rim = rimOf(outer, lid).setY(outer.top + 3);
        const apex = Math.max(outer.top, inner.top) + 40;
        const mid = rim.clone().lerp(lid, 0.5).setY(apex);
        pts = down ? [rim, mid, lid] : [lid, mid, rim];
      } else {
        // A gentle bow, so a long link reads as an arc rather than a floor stripe.
        const arc = Math.min(26, flat[0].distanceTo(flat.at(-1)) * 0.12);
        pts = flat.map((p, i) => (i === 0 || i === flat.length - 1
          ? p
          : p.clone().setY(floor + arc * Math.sin((Math.PI * i) / (flat.length - 1)))));
        if (pts.length === 2 && arc > 0) {
          pts.splice(1, 0, flat[0].clone().lerp(flat[1], 0.5).setY(floor + arc));
        }
      }

      const curve = roundedRoute(pts);
      // Read both ends before making the energized layer. A plain `--` is a
      // physical cable but carries no animated current; the arrowed forms do.
      const backward = !!c.srcArrow && c.srcArrow !== 'none';
      const forward = !!c.dstArrow && c.dstArrow !== 'none';
      const energized = forward || backward;
      // Only a bidirectional cable needs a second semantic colour. Deriving it
      // from the theme accent keeps the pair coordinated as themes change.
      const reverseCurrentColor = currentColor.clone();
      if (forward && backward) {
        const hsl = {};
        reverseCurrentColor.getHSL(hsl);
        reverseCurrentColor.setHSL(
          (hsl.h + 0.42) % 1,
          Math.max(0.62, hsl.s),
          Math.min(0.72, Math.max(0.56, hsl.l)),
        );
      }

      // Arrowheads are terminal hardware, not decals laid over a continuous
      // cable. Reserve enough arc length for each head and end the conduit at
      // its tail, preventing both the metal and luminous current showing through.
      const routeLength = Math.max(1, curve.getLength());
      // Fixed 96×20 tubes spent the same geometry on a short hop as a route
      // across the whole diagram. Twelve sides remain round at cable scale;
      // lengthwise segments grow with the route and stop where extra tessellation
      // is no longer visible.
      const tubeSegments = Math.max(24, Math.min(64, Math.ceil(routeLength / 10)));
      const tubeSides = 12;
      const headCentre = Math.min(0.18, 10 / routeLength);
      // Stop far enough behind the plate for the cable and its larger additive
      // glow shell to terminate inside the arrow socket, never through its face.
      const headTail = Math.min(0.32, 27 / routeLength);
      const wireStart = backward ? headTail : 0;
      const wireEnd = forward ? 1 - headTail : 1;
      const wireCurve = curveSection(curve, wireStart, Math.max(wireStart + 0.02, wireEnd));

      // A real conduit first, with a narrow animated light strip riding just
      // above its surface. Transparent gaps reveal the dark hose underneath.
      const dash = c.strokeDash > 0 ? c.strokeDash : 0;
      const tubeGeo = cableGeometry(wireCurve, 3.2, tubeSegments, tubeSides, dash);
      const tube = new THREE.Mesh(tubeGeo, new THREE.MeshStandardMaterial({
        color: 0x26323a, metalness: 0.68, roughness: 0.38, envMapIntensity: 1.1,
      }));
      // A three-unit cable shadow aliases against the grid from most useful
      // camera distances; it contributes shimmer rather than spatial grounding.
      tube.castShadow = false;
      tube.receiveShadow = true;
      tube.userData = { id: c.id };
      group.add(tube);

      const current = currentMaterial(currentColor, reverseCurrentColor, forward, backward);
      const strip = new THREE.Mesh(
        cableGeometry(wireCurve, 3.46, tubeSegments, tubeSides, dash),
        energized ? current : new THREE.MeshBasicMaterial({
          color: 0x51616a, transparent: true, opacity: 0.12,
          depthWrite: false, toneMapped: false,
        }),
      );
      strip.userData = { id: c.id };
      group.add(strip);

      // Both ends, from d2's own arrowheads — otherwise `<-`, `--` and `<->` all
      // came out drawn as `->`. "none" means that end is bare.
      if (energized) dashes.push({ material: current });
      for (const [arrow, t] of [[c.srcArrow, 0], [c.dstArrow, 1]]) {
        if (!arrow || arrow === 'none') continue;
        // The tangent runs src → dst, so the head at the source faces back down it.
        const sample = t ? 1 - headCentre : headCentre;
        const dir = curve.getTangentAt(sample).normalize().multiplyScalar(t ? 1 : -1);
        const headColor = t ? currentColor : reverseCurrentColor;
        const head = physicalArrow(curve.getPointAt(sample), dir, c.id, headColor, arrow);
        group.add(head);
      }

      // Arrowhead labels — cardinality on an ER link, mostly — sit by their end.
      for (const [end, t] of [[c.srcLabel, 0.1], [c.dstLabel, 0.9]]) {
        if (!end?.label) continue;
        const tag = plaque(end.label, 18);
        tag.position.copy(curve.getPointAt(t)).add(new THREE.Vector3(0, 16, 0));
        tag.userData = { id: c.id };
        group.add(tag);
      }
      if (c.tooltip || c.link) meta.set(c.id, { tooltip: c.tooltip, link: c.link });

      if (c.label) {
        const tag = plaque(c.label, 24);
        tag.position.copy(curve.getPointAt(0.5)).add(new THREE.Vector3(0, 20, 0));
        tag.userData = { id: c.id };
        group.add(tag);
      }
    }

    return {
      group, dashes, mdPanels, meta,
      radius: Math.max(120, bounds.getSize(new THREE.Vector2()).length() / 2),
    };
  }

  function dispose(obj) {
    obj.traverse((n) => {
      n.geometry?.dispose();
      const mats = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
      // Label and dash textures are one per object; the family skins are shared
      // by every material and have to outlive the rebuild that drops them.
      for (const m of mats) {
        m.userData.gone = true;
        for (const t of [m.map, m.emissiveMap]) if (t && !shared.has(t)) t.dispose();
        m.dispose();
      }
    });
  }

  function animateParts(model, time) {
    model.traverse((n) => {
      const u = n.userData;
      if (!u?.motion) return;
      const rest = (u.rest ??= {
        x: n.position.x, y: n.position.y,
        rx: n.rotation.x, ry: n.rotation.y, rz: n.rotation.z,
        sx: n.scale.x, sy: n.scale.y, sz: n.scale.z,
      });
      const speed = u.speed ?? 1;
      const wave = Math.sin(time * speed * Math.PI * 2 + (u.phase ?? 0));

      if (u.motion === 'blink' || u.motion === 'shimmer') {
        const strength = u.motion === 'blink' ? 0.32 + (wave + 1) * 0.34 : 0.1 + (wave + 1) * 0.08;
        for (const m of Array.isArray(n.material) ? n.material : n.material ? [n.material] : []) {
          m.userData.restOpacity ??= m.opacity;
          m.transparent = true;
          m.opacity = m.userData.restOpacity * strength;
          m.needsUpdate = true;
        }
      } else if (u.motion === 'pulse') {
        const k = 1 + wave * (u.amount ?? 0.02);
        n.scale.set(rest.sx * k, rest.sy * k, rest.sz * k);
      } else if (u.motion === 'travel-x') {
        n.position.x = rest.x + wave * (u.span ?? 10);
      } else if (u.motion === 'flow-x') {
        const progress = ((time * speed + (u.phase ?? 0)) % 1 + 1) % 1;
        n.position.x = rest.x + (progress * 2 - 1) * (u.span ?? 10);
      } else if (u.motion === 'spin-x') {
        n.rotation.x = rest.rx + time * speed;
      } else if (u.motion === 'spin-y') {
        n.rotation.y = rest.ry + time * speed;
      } else if (u.motion === 'spin-z') {
        n.rotation.z = rest.rz + time * speed;
      } else if (u.motion === 'sway-z' || u.motion === 'flutter-z') {
        n.rotation.z = rest.rz + wave * (u.amount ?? 0.02);
      } else if (u.motion === 'flutter-x') {
        n.rotation.x = rest.rx + wave * (u.amount ?? 0.02);
      } else if (u.motion === 'press') {
        n.position.y = rest.y - Math.max(0, wave) * (u.amount ?? 1.5);
      } else if (u.motion === 'drift') {
        n.position.x = rest.x + wave * (u.span ?? 2);
        n.position.y = rest.y + Math.cos(time * speed * Math.PI * 2 + (u.phase ?? 0)) * (u.amount ?? 1);
      }
    });
  }

  /**
   * An analytic ground grid. GridHelper uses one-pixel line geometry, which
   * repeatedly falls between different pixel rows while orbiting and produces
   * visible shimmer. Screen-space derivatives feather these lines over exactly
   * the pixels they cover, and minor cells fade before becoming subpixel noise.
   */
  function groundGrid() {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMinor: { value: new THREE.Color(0x1d2933) },
        uMajor: { value: new THREE.Color(0x344a5c) },
        uOpacity: { value: 0.38 },
      },
      vertexShader: `
        varying vec2 vGrid;
        void main() {
          vGrid = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vGrid;
        uniform vec3 uMinor;
        uniform vec3 uMajor;
        uniform float uOpacity;

        float gridLine(float spacing) {
          vec2 cell = vGrid / spacing;
          vec2 pixel = max(fwidth(cell), vec2(0.0001));
          vec2 edge = abs(fract(cell - 0.5) - 0.5) / pixel;
          return 1.0 - min(min(edge.x, edge.y), 1.0);
        }

        void main() {
          float minor = gridLine(75.0);
          float major = gridLine(375.0);
          // Once a minor cell approaches a few pixels wide, showing every line
          // creates moiré. Let the stable major grid carry the distant floor.
          vec2 minorPixel = fwidth(vGrid / 75.0);
          float minorFade = 1.0 - smoothstep(0.16, 0.42, max(minorPixel.x, minorPixel.y));
          float strength = max(major, minor * 0.54 * minorFade);
          float distanceFade = 1.0 - smoothstep(3100.0, 4450.0, length(vGrid));
          float alpha = strength * distanceFade * uOpacity;
          if (alpha < 0.002) discard;
          vec3 color = mix(uMinor, uMajor, major);
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), material);
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = 0.5;
    return grid;
  }

  // ----------------------------------------------------------------- the scene

  function init() {
    // bind:this lands before effects flush, but never hand WebGLRenderer a null
    // canvas — it quietly makes its own and renders into nothing.
    if (!canvas || !box || world) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    // Supersampling at 2× shades four pixels for every CSS pixel. A 1.5× cap is
    // still crisp with antialiasing; large canvases step down another notch.
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft is deprecated as of r185
    // The light and diagram are static between rebuilds. Camera movement does
    // not change a shadow map, so rendering its 2048² depth pass every frame was
    // pure duplicate work.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG);
    scene.fog = new THREE.Fog(BG, 900, 4200);

    // Metal is only metal if it has something to reflect. Without an environment
    // a metalness of 0.8 renders as near-black, which is why the solids looked
    // like flat plastic. RoomEnvironment is generated, not fetched.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.9;
    pmrem.dispose();

    // OrbitControls never gets closer than six units and fog hides the far
    // scene after ~4,200. The old 0.1–12,000 range threw away most depth-buffer
    // precision and made adjacent faceplates, glow skins and inserts z-fight.
    const camera = new THREE.PerspectiveCamera(42, 1, 2, 9000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 6;
    controls.maxPolarAngle = Math.PI * 0.49; // never drop under the floor
    controls.screenSpacePanning = false;

    const hemi = new THREE.HemisphereLight(0xbad8ee, 0x15120f, 1.15);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff1dc, 2.65);
    key.position.set(-380, 720, 460);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 3; // softens the edge PCFSoft used to give for free
    key.shadow.bias = -0.00004;
    key.shadow.normalBias = 0.075;
    Object.assign(key.shadow.camera, { left: -1400, right: 1400, top: 1400, bottom: -1400, far: 4000 });
    key.shadow.camera.updateProjectionMatrix();
    scene.add(key);
    const fillLight = new THREE.DirectionalLight(0x91bfff, 0.9);
    fillLight.position.set(520, 260, -420);
    scene.add(fillLight);

    // The ground: an invisible plane that only catches shadows, with the grid
    // sitting a hair above it so the lines aren't fighting for the same pixels.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(12000, 12000),
      new THREE.ShadowMaterial({ opacity: 0.3 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = groundGrid();
    scene.add(grid);

    world = {
      renderer, scene, camera, controls, key, hemi, fillLight, grid,
      model: null, dashes: [], mdPanels: new Map(), meta: new Map(), openMd: new Set(), radius: 400,
      hasMotion: false, invalidate: null,
    };
    ready = true;

    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovering = null;

    function hitId(e) {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(pointer, camera);
      // Recursive now that a shape is a group of parts, so climb back up from
      // whichever drive bay or vent slat was actually hit to find the shape.
      const hit = world.model ? ray.intersectObjects(world.model.children, true)[0] : null;
      let id = null;
      for (let n = hit?.object; n && n !== world.model; n = n.parent) {
        if (n.userData?.id) { id = n.userData.id; break; }
      }
      return id;
    }

    renderer.domElement.addEventListener('pointermove', (e) => {
      const id = hitId(e);
      if (id !== hovering) { hovering = id; app.hover = id; }
      const m = world.meta.get(id);
      renderer.domElement.style.cursor = m?.link ? 'pointer' : '';
      const r = renderer.domElement.getBoundingClientRect();
      tip = m?.tooltip ? { text: m.tooltip, x: e.clientX - r.left, y: e.clientY - r.top } : null;
    });
    renderer.domElement.addEventListener('pointerleave', () => { hovering = null; app.hover = null; tip = null; });

    /** A d2 link is either another board of this file or a web address. */
    function follow(link) {
      const board = link.replace(/^root\.?/, '');
      if (board === '' || app.boards.some((b) => b.path === board)) app.board = board;
      else if (!unsafeAttr('href', link)) window.open(link, '_blank', 'noopener');
    }

    // OrbitControls also consumes pointer gestures. Only a stationary press is
    // a disclosure click; dragging continues to orbit without toggling a hint.
    let pressed = null;
    renderer.domElement.addEventListener('pointerdown', (e) => {
      if (e.button === 0) pressed = { x: e.clientX, y: e.clientY };
    });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!pressed || Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 5) {
        pressed = null;
        return;
      }
      pressed = null;
      const id = hitId(e);
      const disclosure = world.mdPanels.get(id);
      if (!disclosure) {
        const link = world.meta.get(id)?.link;
        if (link) follow(link);
        return;
      }
      const open = !world.openMd.has(id);
      if (open) world.openMd.add(id);
      else world.openMd.delete(id);
      disclosure.panel.visible = open;
      disclosure.badge.visible = !open;
    });

    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = new THREE.Timer();
    let dirty = true;
    let interacting = false;
    let interactionUntil = 0;
    let lastRender = 0;
    let pageVisible = !document.hidden;
    let canvasVisible = true;
    let appFocused = document.hasFocus();

    world.invalidate = () => { dirty = true; };
    controls.addEventListener('start', () => {
      interacting = true;
      dirty = true;
    });
    controls.addEventListener('end', () => {
      interacting = false;
      // Let damping settle at interactive speed before dropping to the idle cap.
      interactionUntil = performance.now() + 700;
      dirty = true;
    });
    controls.addEventListener('change', () => { dirty = true; });

    const syncAnimationLoop = () => {
      renderer.setAnimationLoop(pageVisible && canvasVisible && appFocused ? renderFrame : null);
    };
    const onVisibility = () => {
      pageVisible = !document.hidden;
      if (pageVisible) { timer.reset(); lastRender = 0; dirty = true; }
      syncAnimationLoop();
    };
    const onWindowFocus = () => {
      appFocused = true;
      // Do not include the unfocused interval in animation time.
      timer.reset();
      lastRender = 0;
      dirty = true;
      syncAnimationLoop();
    };
    const onWindowBlur = () => {
      appFocused = false;
      syncAnimationLoop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onWindowFocus);
    window.addEventListener('blur', onWindowBlur);
    const visibility = new IntersectionObserver(([entry]) => {
      canvasVisible = entry.isIntersecting;
      if (canvasVisible) { timer.reset(); lastRender = 0; dirty = true; }
      syncAnimationLoop();
    });
    visibility.observe(box);

    function renderFrame() {
      const now = performance.now();
      const active = interacting || now < interactionUntil;
      const animated = !still && (world.dashes.length > 0 || world.hasMotion);
      const fps = active ? 60 : animated ? 30 : 60;
      if (lastRender && now - lastRender < 1000 / fps) return;
      if (!dirty && !active && !animated) return;
      lastRender = now;

      timer.update();
      const time = timer.getElapsed();
      if (!still) for (const d of world.dashes) {
        // Time-based motion stays the same speed on 60 Hz and 144 Hz screens.
        d.material.uniforms.uTime.value = time;
      }
      if (!still && world.model) {
        animateParts(world.model, time);
        for (const n of world.model.children) {
          if (!n.userData?.animated) continue;
          n.position.y = (n.userData.baseY ??= n.position.y) + Math.sin(time * 2.4 + n.position.x) * 2.2;
        }
      }
      // Clear before update so OrbitControls can invalidate one more frame while
      // damping is still changing the camera.
      dirty = false;
      const controlsChanged = controls.update();
      renderer.render(scene, camera);
      dirty ||= controlsChanged;
    }
    syncAnimationLoop();

    let currentPixelRatio = renderer.getPixelRatio();
    const resize = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = box;
      if (w <= 0 || h <= 0) return; // a hidden or collapsed panel; WebGL rejects it
      const nextPixelRatio = Math.min(devicePixelRatio, w * h > 2_000_000 ? 1.25 : 1.5);
      if (nextPixelRatio !== currentPixelRatio) {
        renderer.setPixelRatio(nextPixelRatio);
        currentPixelRatio = nextPixelRatio;
      }
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      dirty = true;
    });
    resize.observe(box);

    return () => {
      resize.disconnect();
      visibility.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onWindowFocus);
      window.removeEventListener('blur', onWindowBlur);
      renderer.setAnimationLoop(null);
      controls.dispose();
      if (world.model) dispose(world.model);
      dispose(scene);
      renderer.dispose();
      world = null;
      ready = false;
    };
  }

  /** Frame the whole model — the "reset" for an orbit that has wandered off. */
  function fit() {
    if (!world) return;
    const { camera, controls, radius } = world;
    const d = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 0.75;
    camera.position.set(0, d * 0.72, d * 0.78);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  $effect(() => init());

  // Dark D2 palettes use deliberately low-value colours. Give them a brighter
  // studio and a separated background; light palettes keep the original grade.
  $effect(() => {
    const dark = darkAppearance();
    if (!ready || !world) return;
    const bg = dark ? DARK_BG : BG;
    world.scene.background.set(bg);
    world.scene.fog.color.set(bg);
    world.scene.environmentIntensity = dark ? 0.88 : 0.9;
    world.renderer.toneMappingExposure = dark ? 1.0 : 1.08;
    world.hemi.intensity = dark ? 1.08 : 1.15;
    world.key.intensity = dark ? 2.35 : 2.65;
    world.fillLight.intensity = dark ? 0.78 : 0.9;
    world.grid.material.uniforms.uOpacity.value = dark ? 0.46 : 0.38;
    world.invalidate?.();
  });

  // Rebuild whenever d2 hands us a new diagram. The camera is left alone — it
  // would be unusable if every keystroke snapped the view back.
  $effect(() => {
    const diagram = app.diagram;
    app.svg; // the colours are read off the SVG, so wait for the matching one
    if (!ready || !world) return;

    const first = !world.model;
    if (world.model) { world.scene.remove(world.model); dispose(world.model); }
    const { group, dashes, mdPanels, meta, radius } = build(diagram);
    world.model = group;
    world.meta = meta;
    world.dashes = dashes;
    world.mdPanels = mdPanels;
    world.radius = radius ?? 400;
    world.hasMotion = false;
    group.traverse((node) => {
      if (node.userData?.motion || node.userData?.animated) world.hasMotion = true;
    });
    world.scene.add(group);
    world.renderer.shadowMap.needsUpdate = true;
    world.invalidate?.();
    if (first) fit();
  });

  // Hovering a block in the editor lights the object here.
  $effect(() => {
    const id = app.hover;
    app.svg; // new materials need their base emission captured after every rebuild
    if (!ready || !world?.model) return;
    for (const n of world.model.children) {
      if (n.userData?.glow == null) continue;
      const flare = n.userData.id === id ? 2.6 : 1;
      // A shape is a group of parts, each with its own materials — flare all of
      // them, but leave the LEDs alone: MeshBasic has no emissive to raise.
      // Flaring alone barely shows: most glow comes through a mostly-dark
      // emissive map, and multiplying dark gives dark. So the surfaces are also
      // tinted toward a highlight, which reads on any skin.
      const lit = n.userData.id === id;
      n.traverse((p) => {
        if (p.isSprite) return; // the label plaque keeps its own colours
        for (const m of Array.isArray(p.material) ? p.material : p.material ? [p.material] : []) {
          if (m.color) {
            m.userData.baseColor ??= m.color.clone();
            m.color.copy(m.userData.baseColor).lerp(HOVER, lit ? 0.38 : 0);
          }
          if (m.emissiveIntensity === undefined) continue;
          m.userData.baseEmissiveIntensity ??= m.emissiveIntensity;
          m.emissiveIntensity = m.userData.baseEmissiveIntensity * flare;
        }
      });
    }
    world.invalidate?.();
  });
</script>

<div class="stage" bind:this={box}>
  <canvas bind:this={canvas}></canvas>
  <button class="reset" onclick={fit} title={t('scene.frame')}>⤢</button>
  <p class="hint">{t('scene.hint')}</p>
  {#if tip}<p class="tip" style="left: {tip.x + 14}px; top: {tip.y + 14}px">{tip.text}</p>{/if}
</div>

<style>
  .stage { position: absolute; inset: 0; }
  canvas { display: block; inline-size: 100%; block-size: 100%; }

  .reset {
    position: absolute; inset-block-start: 12px; inset-inline-end: 12px;
    padding: 3px 9px; border-radius: 7px; cursor: pointer;
    border: 1px solid rgb(120 180 240 / 0.3); background: rgb(8 20 32 / 0.75);
    color: #dbeafe; font: inherit; font-size: 13px;
  }
  .reset:hover { background: rgb(16 38 58 / 0.9); }

  .tip {
    position: absolute; margin: 0; max-inline-size: 280px; pointer-events: none;
    padding: 5px 9px; border-radius: 7px; font-size: 12px; white-space: pre-wrap;
    border: 1px solid rgb(120 180 240 / 0.3); background: rgb(8 20 32 / 0.92); color: #dbeafe;
  }

  .hint {
    position: absolute; inset-block-end: 10px; inset-inline-start: 50%;
    translate: -50% 0;
    margin: 0;
    font-size: 11px; color: rgb(190 220 255 / 0.45);
    pointer-events: none;
  }
</style>
