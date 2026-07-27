// The shapes of the 3D mode: which d2 type becomes what kind of object, how tall
// it stands, and the geometry that builds it.
//
// Deliberately free of the DOM and of the component: the surfaces painted onto
// these bodies need a canvas, but the bodies themselves are pure geometry, so
// they can be built and measured in a test. models.test.js does exactly that.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Outlines that aren't a plain box, as fractions of the shape's own w × h. */
export const POLY = {
  diamond: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  hexagon: [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]],
  parallelogram: [[0.22, 0], [1, 0], [0.78, 1], [0, 1]],
  step: [[0, 0], [0.82, 0], [1, 0.5], [0.82, 1], [0, 1], [0.18, 0.5]],
  page: [[0, 0], [0.8, 0], [1, 0.2], [1, 1], [0, 1]],
  document: [[0, 0], [1, 0], [1, 0.88], [0.5, 1], [0, 0.88]],
  callout: [[0, 0], [1, 0], [1, 0.76], [0.62, 0.76], [0.5, 1], [0.44, 0.76], [0, 0.76]],
};

/** Round in plan, so they extrude into cylinders. A database is one of these. */
export const ROUND = new Set(['cylinder', 'stored_data', 'queue', 'package', 'circle', 'oval']);

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// ------------------------------------------------------------------ outlines

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/**
 * The footprint, centred on the origin. Written in the XY plane and laid flat
 * later, so the outline's y runs the same way d2's does once it's rotated.
 */
export function outline(type, w, h) {
  if (ROUND.has(type)) {
    const s = new THREE.Shape();
    s.absellipse(0, 0, w / 2, h / 2, 0, Math.PI * 2, false, 0);
    return s;
  }
  const pts = POLY[type];
  if (!pts) return roundedRect(w, h, type === 'cloud' ? Math.min(w, h) * 0.42 : 6);

  const s = new THREE.Shape();
  pts.forEach(([nx, ny], i) => {
    const X = (nx - 0.5) * w, Y = (0.5 - ny) * h;
    if (i) s.lineTo(X, Y); else s.moveTo(X, Y);
  });
  s.closePath();
  return s;
}

export const FAMILY = {
  '': 'block', square: 'component', rectangle: 'service',
  cylinder: 'db', stored_data: 'volume', queue: 'queue', package: 'package',
  circle: 'state', oval: 'startstop', person: 'person', cloud: 'cloud',
  diamond: 'decision', hexagon: 'gateway',
  page: 'screen', callout: 'note', document: 'file',
  step: 'process',
  parallelogram: 'io',
};
export const familyOf = (type) => FAMILY[type] ?? 'block';

/** Preserve the editor's shape choice when d2 normalises its compiled type. */
export function resolvedType(compiledType, source) {
  if (!source) return compiledType;
  // An unshaped markdown box intentionally compiles to borderless `text`.
  if (source.shape === '' && source.md) return compiledType;
  return source.shape ?? compiledType;
}

/** How tall a family stands, as a fraction of its footprint's short side. */
export const HEIGHT = {
  db: [1.05, 42, 130], volume: [1.2, 46, 140], service: [0.5, 22, 70], queue: [0.55, 22, 70],
  state: [0.62, 20, 70], person: [1.0, 34, 110], cloud: [0.62, 24, 80],
  startstop: [0.54, 22, 68], file: [0.32, 16, 48],
  decision: [0.75, 26, 90], gateway: [0.6, 24, 80], package: [0.6, 22, 76],
  block: [0.5, 24, 72], paper: [0.3, 16, 46],
  io: [0.82, 34, 92],
  process: [0.58, 24, 70],
  screen: [0.78, 32, 88], note: [0.66, 28, 78], component: [0.38, 18, 52],
};

// ------------------------------------------------------------------ models

const RB = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));

/** Darken a hex toward black — trim, recesses, the gaps between drives. */
const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

/**
 * Seat a part on the wall of a round body and turn it to face outward.
 *
 * The obvious `position.set(x, y, radius)` only touches the surface at dead
 * centre; anywhere else it hangs off the curve, which is exactly what makes
 * furniture look like it's flying. `angle` is measured from the front.
 */
function onCurve(part, rx, rz, angle, y, k = 0.97) {
  part.position.set(rx * k * Math.sin(angle), y, rz * k * Math.cos(angle));
  part.rotation.y = angle;
  return part;
}

/** Mark a part for Scene.svelte's lightweight, reduced-motion-aware animator. */
function moves(part, kind, options = {}) {
  Object.assign(part.userData, { motion: kind, ...options });
  return part;
}

/**
 * Real bodies for the kinds of thing worth modelling. Each returns a Group
 * with its base on y = 0, sized to the footprint d2 laid out (w × h) so the
 * diagram still reads the way the flat one does.
 *
 * Anything not here falls back to its outline extruded straight up, which is
 * the honest answer for a document or a callout.
 */
export const MODELS = {
  // A small server cabinet. The cylinder-stack database icon is familiar in 2D
  // but turns into a pile of coins in 3D; real data lives in rack hardware.
  db(w, h, H, M) {
    const g = new THREE.Group();
    const frame = M.surface(0x252a31, 0.78, 0.26);
    const black = M.surface(0x090b0e, 0.18, 0.62);
    const rail = M.surface(0x77808b, 0.92, 0.2);
    const cabinet = new THREE.Mesh(RB(w * 0.82, H * 0.93, h * 0.78, Math.min(w, h) * 0.045), M.band(2, 2));
    cabinet.position.y = H * 0.535;
    g.add(cabinet);

    const face = new THREE.Mesh(RB(w * 0.74, H * 0.79, 3.2, 2), black);
    face.position.set(0, H * 0.54, h * 0.395);
    g.add(face);

    const rows = 5;
    for (let row = 0; row < rows; row++) {
      const y = H * (0.23 + row * 0.135);
      const tray = new THREE.Mesh(RB(w * 0.66, H * 0.095, 3.5, 1.4), frame);
      tray.position.set(0, y, h * 0.42);
      g.add(tray);
      for (let bay = 0; bay < 4; bay++) {
        const door = new THREE.Mesh(RB(w * 0.135, H * 0.062, 2, 0.8), M.surface(0x39414a, 0.72, 0.3));
        door.position.set(w * (-0.245 + bay * 0.163), y, h * 0.445);
        g.add(door);
        const led = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.8, w * 0.008), 10, 6),
          M.led((row + bay) % 5 ? 0x4de890 : 0xffb84d));
        led.position.set(door.position.x + w * 0.047, y, h * 0.46);
        moves(led, 'blink', { phase: row * 0.8 + bay * 1.7, speed: 2.2 + (bay % 3) });
        g.add(led);
      }
    }
    for (const x of [-0.385, 0.385]) {
      const post = new THREE.Mesh(RB(w * 0.035, H * 0.82, 3.6, 0.8), rail);
      post.position.set(w * x, H * 0.54, h * 0.425);
      g.add(post);
    }
    for (const x of [-0.32, 0.32]) for (const z of [-0.3, 0.3]) {
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.045, H * 0.05, H * 0.09, 12), black);
      foot.position.set(w * x, H * 0.045, h * z);
      g.add(foot);
    }
    return g;
  },

  // A storage tank: hooped body, domed cap, a level gauge and a ladder.
  // Deliberately nothing like the database's drive stack — they're different
  // things and used to look identical.
  volume(w, h, H, M) {
    const g = new THREE.Group();
    const rx = w / 2, rz = h / 2;
    const bodyH = H * 0.72;
    const floor = H * 0.07;

    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, floor, 48), M.dark(0.4));
    skirt.scale.set(rx, 1, rz);
    skirt.position.y = floor / 2;
    g.add(skirt);

    const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, bodyH, 56),
      [M.band(2, 1), M.cap(), M.cap()]);
    body.scale.set(rx * 0.96, 1, rz * 0.96);
    body.position.y = floor + bodyH / 2;
    g.add(body);

    // Hoops: what makes it read as a tank rather than a drum.
    for (let i = 0; i < 3; i++) {
      const hoop = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, H * 0.045, 56), M.metal(0.85, 0.3));
      hoop.scale.set(rx, 1, rz);
      hoop.position.y = floor + bodyH * (0.22 + i * 0.28);
      g.add(hoop);
    }

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2), M.cap());
    dome.scale.set(rx * 0.96, H * 0.2, rz * 0.96);
    dome.position.y = floor + bodyH;
    g.add(dome);

    const r = Math.min(rx, rz);
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.24, r * 0.3, H * 0.06, 24),
      M.metal(0.9, 0.25));
    hatch.position.y = floor + bodyH + H * 0.19;
    g.add(hatch);

    // A real fill pipe and hand-wheel sell the industrial scale immediately.
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.07, r * 0.07, H * 0.32, 16),
      M.surface(0x737b82, 0.88, 0.27));
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(rx * 0.93, floor + bodyH * 0.7, 0);
    g.add(pipe);
    const valve = new THREE.Mesh(new THREE.TorusGeometry(r * 0.14, r * 0.025, 8, 24),
      M.surface(0xd94b3d, 0.55, 0.38));
    valve.rotation.y = Math.PI / 2;
    valve.position.set(rx * 0.84, floor + bodyH * 0.9, 0);
    moves(valve, 'spin-x', { speed: 0.42 });
    g.add(valve);

    g.add(onCurve(new THREE.Mesh(RB(w * 0.05, bodyH * 0.7, 3, 1.2), M.led(0x7ee7ff)),
      rx, rz, -0.5, floor + bodyH * 0.5));
    for (let i = 0; i < 5; i++) {
      g.add(onCurve(new THREE.Mesh(RB(w * 0.13, 2.2, 2.4, 0.8), M.dark(0.5)),
        rx, rz, 0.62, floor + bodyH * (0.12 + i * 0.19)));
    }
    return g;
  },

  // A compute unit: chassis on feet, recessed front panel, vent slats, lights.
  service(w, h, H, M) {
    const g = new THREE.Group();
    const foot = H * 0.12;

    const chassis = new THREE.Mesh(RB(w, H - foot, h, Math.min(w, h) * 0.06), M.band(2, 1));
    chassis.position.y = foot + (H - foot) / 2;
    g.add(chassis);

    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(foot * 0.5, foot * 0.42, foot, 12), M.dark(0.35));
      leg.position.set(sx * w * 0.38, foot / 2, sz * h * 0.34);
      g.add(leg);
    }

    const face = new THREE.Mesh(RB(w * 0.9, (H - foot) * 0.78, 3, 2), M.dark(0.55));
    face.position.set(0, foot + (H - foot) * 0.5, h / 2 + 0.4);
    g.add(face);

    for (let i = 0; i < 4; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(w * 0.46, (H - foot) * 0.06, 2), M.dark(0.2));
      slat.position.set(w * 0.16, foot + (H - foot) * (0.3 + i * 0.15), h / 2 + 1.6);
      g.add(slat);
    }
    for (const [i, c] of [[0, 0x3dff9f], [1, 0xffc24d]]) {
      const led = new THREE.Mesh(new THREE.SphereGeometry(Math.max(1.4, w * 0.022), 12, 8), M.led(c));
      led.position.set(-w * 0.34 + i * w * 0.07, foot + (H - foot) * 0.74, h / 2 + 1.8);
      moves(led, 'blink', { phase: i * 2.4, speed: i ? 1.8 : 3.1 });
      g.add(led);
    }
    return g;
  },

  // Lying down, because a queue is a pipe things pass through.
  queue(w, h, H, M) {
    const g = new THREE.Group();
    const r = Math.min(h, H) * 0.44;
    const cy = r + H * 0.12;
    const dark = M.surface(0x1d252b, 0.62, 0.46);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w * 0.82, 48, 1, true),
      M.glass(0x7899a8, 0.26));
    tube.rotation.z = Math.PI / 2;
    tube.position.y = cy;
    g.add(tube);

    // A dark lower rail gives the transparent tube a physical support and keeps
    // the silhouette readable against the floor.
    const rail = new THREE.Mesh(RB(w * 0.78, H * 0.09, r * 0.28, 1.5), dark);
    rail.position.set(0, cy - r * 0.82, 0);
    g.add(rail);

    for (const sx of [-1, 0, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, r * 0.085, 10, 40),
        M.primary(0x315b58, 0.72, 0.32));
      ring.rotation.y = Math.PI / 2;
      ring.position.set(sx * w * 0.4, cy, 0);
      g.add(ring);
    }

    for (const sx of [-1, 1]) {
      const end = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r * 0.9, w * 0.055, 36), dark);
      end.rotation.z = Math.PI / 2;
      end.position.set(sx * w * 0.43, cy, 0);
      g.add(end);
    }

    // Capsules loop continuously instead of rocking back and forth, which reads
    // as throughput rather than idle decoration.
    const colors = [0xf0a33b, 0x48c7b0, 0x5f8ee8];
    for (let i = 0; i < colors.length; i++) {
      const capsule = new THREE.Mesh(
        new THREE.CapsuleGeometry(r * 0.27, w * 0.045, 6, 18),
        M.surface(colors[i], 0.08, 0.34),
      );
      capsule.rotation.z = Math.PI / 2;
      capsule.position.set(0, cy, (i - 1) * r * 0.34);
      moves(capsule, 'flow-x', { span: w * 0.34, speed: 0.16, phase: i / colors.length });
      g.add(capsule);
    }

    for (const sx of [-1, 1]) {
      const foot = new THREE.Mesh(RB(w * 0.13, H * 0.12, h * 0.54, 1.5), dark);
      foot.position.set(sx * w * 0.28, H * 0.06, 0);
      g.add(foot);
    }
    return g;
  },

  package(w, h, H, M) {
    const g = new THREE.Group();
    const cardboard = M.primary(0xb9864f, 0.01, 0.92);
    const tapeMat = M.surface(0xd8bb82, 0.0, 0.68);
    const box = new THREE.Mesh(RB(w, H, h, Math.min(w, h) * 0.025), cardboard);
    box.position.y = H / 2;
    g.add(box);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(w * 0.16, H * 1.012, h * 1.012), tapeMat);
    tape.position.y = H / 2;
    g.add(tape);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.32, h * 0.28), M.surface(0xf2eee4, 0, 0.82));
    label.rotation.x = -Math.PI / 2;
    label.rotation.z = -0.08;
    label.position.set(w * 0.2, H + 0.7, 0);
    moves(label, 'flutter-z', { phase: 0.7, amount: 0.018, speed: 2.1 });
    g.add(label);
    for (let i = -1; i <= 1; i++) {
      const ink = new THREE.Mesh(new THREE.PlaneGeometry(w * (i ? 0.2 : 0.1), 0.9), M.surface(0x363330, 0, 0.9));
      ink.rotation.x = -Math.PI / 2;
      ink.rotation.z = -0.08;
      ink.position.set(w * 0.2, H + 0.8, h * i * 0.045);
      g.add(ink);
    }
    return g;
  },

  // State as an analog status gauge. Its upright dial, ticks and moving needle
  // have no silhouette in common with the low two-button start/stop console.
  state(w, h, H, M) {
    const g = new THREE.Group();
    const rx = w / 2, rz = h / 2;
    const housing = M.primary(0x30373d, 0.72, 0.32);
    const dark = M.surface(0x171b1f, 0.48, 0.5);
    const dial = M.surface(0xe8ecec, 0.02, 0.72);
    const ink = M.surface(0x20262b, 0.08, 0.68);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 1, H * 0.1, 40), housing);
    base.scale.set(rx, 1, rz);
    base.position.y = H * 0.05;
    g.add(base);

    const post = new THREE.Mesh(RB(Math.min(w, h) * 0.12, H * 0.48, Math.min(w, h) * 0.12, 1.5),
      housing);
    post.position.y = H * 0.3;
    g.add(post);

    const radius = Math.min(rx, rz) * 0.54;
    const cy = H * 0.63;
    const depth = Math.max(3, H * 0.1);
    const caseMesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.12, radius * 1.12, depth, 40), housing);
    caseMesh.rotation.x = Math.PI / 2;
    caseMesh.position.set(0, cy, 0);
    g.add(caseMesh);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1.5, 40), dial);
    face.rotation.x = Math.PI / 2;
    face.position.set(0, cy, depth * 0.58);
    g.add(face);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.02, radius * 0.09, 10, 40),
      M.metal(0.9, 0.2));
    bezel.position.set(0, cy, depth * 0.72);
    g.add(bezel);

    // Gauge ticks occupy the upper 240 degrees, like an instrument panel.
    for (let i = 0; i <= 10; i++) {
      const angle = -Math.PI * 0.66 + (Math.PI * 1.32 * i) / 10;
      const tick = new THREE.Mesh(new THREE.BoxGeometry(
        i % 5 ? radius * 0.035 : radius * 0.055,
        i % 5 ? radius * 0.14 : radius * 0.2,
        1,
      ), ink);
      tick.position.set(
        Math.sin(angle) * radius * 0.78,
        cy + Math.cos(angle) * radius * 0.78,
        depth * 0.85,
      );
      tick.rotation.z = -angle;
      g.add(tick);
    }

    const needlePivot = new THREE.Group();
    const needle = new THREE.Mesh(RB(radius * 0.055, radius * 1.22, 1.3, 0.8),
      M.surface(0xd3453d, 0.2, 0.4));
    needle.position.y = radius * 0.54;
    needlePivot.add(needle);
    needlePivot.position.set(0, cy, depth * 0.94);
    needlePivot.rotation.z = -0.62;
    moves(needlePivot, 'sway-z', { phase: 0.7, amount: 0.72, speed: 0.16 });
    g.add(needlePivot);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.13, radius * 0.13, 2.5, 20), dark);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(0, cy, depth);
    g.add(hub);
    return g;
  },

  // Start/end as a real operator control station. It is deliberately low and
  // oval, with separate start and stop actuators; state remains a single lamp.
  startstop(w, h, H, M) {
    const g = new THREE.Group();
    const rx = w / 2, rz = h / 2;
    const baseH = H * 0.35;
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 1, baseH, 48),
      [M.primary(0x343a40, 0.68, 0.34), M.surface(0x24292e, 0.56, 0.46), M.surface(0x24292e, 0.56, 0.46)]);
    housing.scale.set(rx, 1, rz);
    housing.position.y = baseH / 2;
    g.add(housing);

    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.88, H * 0.08, 48),
      M.surface(0xc8cdd1, 0.8, 0.26));
    plate.scale.set(rx, 1, rz);
    plate.position.y = baseH + H * 0.04;
    g.add(plate);

    for (const [sx, color] of [[-1, 0x35b96f], [1, 0xd94a42]]) {
      const bezel = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, H * 0.09, 28),
        M.surface(0x1d2125, 0.7, 0.35));
      bezel.scale.set(rx * 0.28, 1, rz * 0.42);
      bezel.position.set(sx * w * 0.21, baseH + H * 0.115, 0);
      g.add(bezel);
      const button = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1, H * 0.2, 28),
        M.surface(color, 0.08, 0.32));
      button.scale.set(rx * 0.25, 1, rz * 0.38);
      button.position.set(sx * w * 0.21, baseH + H * 0.25, 0);
      moves(button, 'press', { phase: sx > 0 ? Math.PI : 0, amount: H * 0.035, speed: 0.9 });
      g.add(button);
    }
    return g;
  },

  // A small human figure with clothing, skin, shoes and hair. Separating those
  // materials matters more to recognition than adding polygon count.
  person(w, h, H, M) {
    const g = new THREE.Group();
    const r = Math.min(w, h) / 2;
    const skin = M.surface(0xc98f6b, 0, 0.78);
    const trousers = M.surface(0x26354b, 0.02, 0.84);
    const shoes = M.surface(0x17191c, 0.05, 0.7);
    const hair = M.surface(0x3a271e, 0, 0.92);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, H * 0.035, 40),
      M.surface(0x24282d, 0.5, 0.42));
    base.scale.set(w * 0.45, 1, h * 0.45);
    base.position.y = H * 0.0175;
    g.add(base);

    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.16, H * 0.26, 6, 14), trousers);
      leg.position.set(sx * r * 0.22, H * 0.25, 0);
      g.add(leg);
      const shoe = new THREE.Mesh(RB(r * 0.36, H * 0.07, r * 0.58, 1.5), shoes);
      shoe.position.set(sx * r * 0.22, H * 0.035, r * 0.12);
      g.add(shoe);
    }

    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.42, H * 0.16, 8, 24), M.matte());
    chest.position.y = H * 0.58;
    g.add(chest);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.115, H * 0.24, 6, 14), M.matte());
      arm.position.set(sx * r * 0.55, H * 0.55, 0);
      arm.rotation.z = sx * 0.12;
      g.add(arm);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(r * 0.13, 14, 10), skin);
      hand.position.set(sx * r * 0.59, H * 0.36, 0);
      g.add(hand);
    }

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.19, H * 0.07, 18), skin);
    neck.position.y = H * 0.75;
    g.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(r * 0.34, 30, 22), skin);
    head.position.y = H * 0.86;
    g.add(head);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 0.345, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hair);
    cap.position.y = H * 0.885;
    g.add(cap);
    moves(g, 'sway-z', { phase: 0.4, amount: 0.018, speed: 1.15 });
    return g;
  },

  // One dense weather cloud, not a row of cotton balls. A broad overlapping
  // belly hides the lower joins; asymmetric crowns give the silhouette scale.
  cloud(w, h, H, M) {
    const g = new THREE.Group();
    const white = M.primary(0xf2f5f7, 0, 0.98);
    const light = M.surface(0xffffff, 0, 0.96);
    const shade = M.surface(0xbfc9d1, 0, 1);
    const geo = new THREE.SphereGeometry(1, 36, 24);
    const puff = (px, py, pz, sx, sy, sz, material = white) => {
      const s = new THREE.Mesh(geo, material);
      s.scale.set(w * sx, H * sy, h * sz);
      s.position.set(w * px, H * py, h * pz);
      g.add(s);
    };

    // The shadowed underside spans almost the full footprint and connects every
    // lobe. Its bottom is deliberately shallow rather than perfectly flat.
    puff(0, 0.28, 0.03, 0.45, 0.25, 0.39, shade);
    puff(-0.18, 0.38, -0.02, 0.3, 0.32, 0.34);
    puff(0.16, 0.39, 0.04, 0.32, 0.34, 0.35);

    // Bright crowns overlap deeply, so their contour reads as one soft mass.
    puff(-0.29, 0.49, 0.02, 0.22, 0.32, 0.27, light);
    puff(-0.1, 0.63, -0.08, 0.27, 0.43, 0.31, light);
    puff(0.12, 0.69, -0.04, 0.24, 0.48, 0.29, light);
    puff(0.31, 0.5, 0.06, 0.2, 0.31, 0.25);
    puff(-0.03, 0.48, 0.22, 0.29, 0.32, 0.25);
    puff(0.18, 0.5, -0.22, 0.25, 0.34, 0.24);

    // Two small wisps keep the bottom edge from looking like a solid pedestal.
    puff(-0.38, 0.24, 0.08, 0.12, 0.16, 0.18, white);
    puff(0.39, 0.25, -0.03, 0.11, 0.17, 0.16, white);
    moves(g, 'drift', { phase: 1.1, span: w * 0.025, amount: H * 0.018, speed: 0.42 });
    return g;
  },

  // The default box, and the shape most diagrams are mostly made of: a plinth,
  // a body inset from it, and a top plate inset again. Three edges to catch the
  // light instead of one flat slab.
  block(w, h, H, M) {
    const g = new THREE.Group();
    const r = Math.min(w, h);
    const foot = Math.max(2, H * 0.12);

    const plinth = new THREE.Mesh(RB(w, foot, h, r * 0.04), M.dark(0.45));
    plinth.position.y = foot / 2;
    g.add(plinth);

    const bodyH = Math.max(2, H - foot * 1.6);
    const body = new THREE.Mesh(RB(w * 0.93, bodyH, h * 0.93, r * 0.07), M.band(2, 1));
    body.position.y = foot + bodyH / 2;
    g.add(body);

    const plate = new THREE.Mesh(RB(w * 0.8, foot * 1.2, h * 0.8, r * 0.05), M.cap());
    plate.position.y = foot + bodyH;
    moves(plate, 'pulse', { phase: 0.2, amount: 0.012, speed: 1.4 });
    g.add(plate);
    return g;
  },

  // A page/screen as a real desktop display rather than another stack of paper.
  screen(w, h, H, M) {
    const g = new THREE.Group();
    const shell = M.primary(0x272d33, 0.52, 0.42);
    const black = M.surface(0x090c0f, 0.08, 0.65);
    const panel = M.surface(0x071722, 0.04, 0.16);

    const foot = new THREE.Mesh(RB(w * 0.72, H * 0.06, h * 0.62, 2), shell);
    foot.position.set(0, H * 0.03, h * 0.04);
    g.add(foot);
    const stem = new THREE.Mesh(RB(w * 0.1, H * 0.4, h * 0.1, 1.5), shell);
    stem.position.set(0, H * 0.25, -h * 0.12);
    g.add(stem);

    const frame = new THREE.Mesh(RB(w * 0.92, H * 0.64, h * 0.075, 3), shell);
    frame.position.set(0, H * 0.64, -h * 0.18);
    g.add(frame);
    const bezel = new THREE.Mesh(RB(w * 0.84, H * 0.54, 2, 1.6), black);
    bezel.position.set(0, H * 0.65, -h * 0.135);
    g.add(bezel);
    const display = new THREE.Mesh(RB(w * 0.78, H * 0.47, 1, 1), panel);
    display.position.set(0, H * 0.66, -h * 0.12);
    g.add(display);
    const shine = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.67, H * 0.1), M.glass(0x79bddd, 0.2));
    shine.position.set(0, H * 0.78, -h * 0.108);
    moves(shine, 'shimmer', { phase: 0.3, speed: 0.8 });
    g.add(shine);
    const led = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.7, w * 0.007), 10, 6), M.led(0x58e493));
    led.position.set(w * 0.37, H * 0.4, -h * 0.095);
    moves(led, 'blink', { phase: 0.2, speed: 1.7 });
    g.add(led);
    return g;
  },

  // A callout as a pinned note board: frame, warm paper, folded corner and pin.
  // It remains readable as a note even with its text plaque hidden.
  note(w, h, H, M) {
    const g = new THREE.Group();
    const frameMat = M.surface(0x72543b, 0.02, 0.86);
    const cork = M.surface(0xa8794d, 0, 0.96);
    const paper = M.primary(0xf2cf5b, 0, 0.9);
    const darkPaper = M.surface(0xc79e32, 0, 0.94);

    const foot = new THREE.Mesh(RB(w * 0.88, H * 0.07, h * 0.7, 2), frameMat);
    foot.position.y = H * 0.035;
    g.add(foot);
    const board = new THREE.Mesh(RB(w * 0.9, H * 0.76, h * 0.07, 2.5), frameMat);
    board.position.set(0, H * 0.52, -h * 0.16);
    g.add(board);
    const inset = new THREE.Mesh(RB(w * 0.82, H * 0.67, h * 0.025, 1), cork);
    inset.position.set(0, H * 0.52, -h * 0.115);
    g.add(inset);
    const sticky = new THREE.Mesh(RB(w * 0.62, H * 0.52, 1.4, 1), paper);
    sticky.position.set(w * 0.03, H * 0.53, -h * 0.09);
    sticky.rotation.z = -0.045;
    moves(sticky, 'flutter-z', { phase: 1.2, amount: 0.022, speed: 1.05 });
    g.add(sticky);
    const fold = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(w * 0.12, 0),
      new THREE.Vector2(w * 0.12, H * 0.1),
    ])), darkPaper);
    fold.position.set(w * 0.22, H * 0.29, -h * 0.078);
    g.add(fold);
    for (let i = 0; i < 4; i++) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(w * (0.38 - i * 0.035), 0.9, 0.7),
        M.surface(0x75692f, 0, 0.9));
      line.position.set(-w * 0.025, H * (0.61 - i * 0.08), -h * 0.074);
      line.rotation.z = -0.045;
      g.add(line);
    }
    const pin = new THREE.Mesh(new THREE.SphereGeometry(Math.max(1.4, w * 0.022), 16, 10),
      M.surface(0xd7473f, 0.15, 0.35));
    pin.position.set(w * 0.03, H * 0.78, -h * 0.055);
    g.add(pin);
    return g;
  },

  // A square component as an actual electronic module rather than a smaller
  // server: PCB, central IC, gold pins, traces, capacitors and mounting holes.
  component(w, h, H, M) {
    const g = new THREE.Group();
    const boardMat = M.primary(0x267451, 0.12, 0.62);
    const chipMat = M.surface(0x14181b, 0.18, 0.55);
    const gold = M.surface(0xd1a23b, 0.82, 0.24);
    const solder = M.surface(0xaeb7bd, 0.9, 0.2);
    const boardH = H * 0.14;

    const board = new THREE.Mesh(RB(w * 0.94, boardH, h * 0.94, Math.min(w, h) * 0.035), boardMat);
    board.position.y = H * 0.12;
    g.add(board);
    const chip = new THREE.Mesh(RB(w * 0.42, H * 0.22, h * 0.42, 2), chipMat);
    chip.position.y = H * 0.3;
    g.add(chip);

    for (const axis of ['x', 'z']) for (const sign of [-1, 1]) for (let i = -3; i <= 3; i++) {
      const pin = new THREE.Mesh(new THREE.BoxGeometry(
        axis === 'x' ? w * 0.035 : w * 0.11,
        H * 0.045,
        axis === 'z' ? h * 0.035 : h * 0.11,
      ), gold);
      pin.position.set(
        axis === 'x' ? sign * w * 0.245 : i * w * 0.055,
        H * 0.24,
        axis === 'z' ? sign * h * 0.245 : i * h * 0.055,
      );
      g.add(pin);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.min(w, h) * 0.05,
        Math.min(w, h) * 0.012, 8, 20), solder);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(sx * w * 0.37, H * 0.205, sz * h * 0.37);
      g.add(ring);
    }
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.045, w * 0.045, H * 0.4, 16),
        M.surface(sx > 0 ? 0x315f92 : 0x8c3940, 0.36, 0.42));
      cap.position.set(sx * w * 0.32, H * 0.4, h * 0.07);
      moves(cap, 'pulse', { phase: sx > 0 ? 0 : Math.PI, amount: 0.025, speed: 1.5 });
      g.add(cap);
    }
    return g;
  },

  // Sheets in a tray, each keeping the outline d2 chose — so a document still
  // reads differently from a page or a callout, but none of them is a slab.
  paper(w, h, H, M, type) {
    const g = new THREE.Group();
    const tray = new THREE.Mesh(RB(w, H * 0.22, h, 3), M.surface(0x59616a, 0.72, 0.34));
    tray.position.y = H * 0.11;
    g.add(tray);

    const sheetH = Math.max(1.2, H * 0.16);
    for (let i = 0; i < 3; i++) {
      const k = 0.94 - i * 0.03;
      const sheet = new THREE.Mesh(new THREE.ExtrudeGeometry(outline(type, w * k, h * k), {
        depth: sheetH, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.8,
        bevelSegments: 1, curveSegments: 24,
      }), [M.surface(0xf6f2e8, 0, 0.88), M.surface(0xd8d1c4, 0, 0.94)]);
      sheet.rotation.x = -Math.PI / 2;

      // Yaw goes on a wrapper: the mesh itself is already turned flat, so its
      // own y is the outline's depth axis.
      const pivot = new THREE.Group();
      pivot.add(sheet);
      pivot.rotation.y = (i - 1) * 0.05;
      pivot.position.y = H * 0.22 + i * sheetH * 1.35;
      if (i === 2) moves(pivot, 'flutter-z', { phase: 0.6, amount: 0.018, speed: 1.2 });
      g.add(pivot);
    }
    return g;
  },

  // A physical file folder, distinct from a loose page or note. The warm folder
  // shell, raised tab and exposed white sheets do most of the recognition work.
  file(w, h, H, M) {
    const g = new THREE.Group();
    const manila = M.primary(0xd2a65d, 0, 0.9);
    const edge = M.surface(0xa97b38, 0, 0.94);
    const paper = M.surface(0xf7f4eb, 0, 0.92);
    const ink = M.surface(0x7f8b97, 0, 0.88);

    const folder = new THREE.Mesh(RB(w, H * 0.22, h, 2.5), edge);
    folder.position.y = H * 0.11;
    g.add(folder);
    const cover = new THREE.Mesh(RB(w * 0.97, H * 0.12, h * 0.92, 2), manila);
    cover.position.set(0, H * 0.28, h * 0.035);
    cover.rotation.x = -0.045;
    moves(cover, 'flutter-x', { phase: 0.8, amount: 0.016, speed: 1.1 });
    g.add(cover);

    for (let i = 0; i < 3; i++) {
      const sheet = new THREE.Mesh(RB(w * (0.9 - i * 0.025), H * 0.055, h * (0.8 - i * 0.025), 1.2), paper);
      sheet.position.set(w * (i - 1) * 0.012, H * (0.26 + i * 0.075), -h * 0.015);
      sheet.rotation.y = (i - 1) * 0.025;
      g.add(sheet);
    }
    const tab = new THREE.Mesh(RB(w * 0.28, H * 0.16, h * 0.13, 1.2), manila);
    tab.position.set(-w * 0.27, H * 0.42, -h * 0.36);
    g.add(tab);
    for (let i = 0; i < 4; i++) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(w * (0.42 - i * 0.035), 0.8, h * 0.012), ink);
      line.position.set(-w * 0.08, H * 0.51, h * (-0.18 + i * 0.09));
      g.add(line);
    }
    return g;
  },

  // Input/output as an open workstation: the screen is the output, while the
  // keyboard, touchpad and side sockets make the input half equally obvious.
  // A stack of parallelogram-shaped paper communicated neither.
  io(w, h, H, M) {
    const g = new THREE.Group();
    const shell = M.band(2, 1);
    const edge = M.surface(0x252b31, 0.72, 0.3);
    const keyMat = M.surface(0x15191d, 0.05, 0.72);
    const screenMat = M.surface(0x07151f, 0.08, 0.18);
    const baseH = Math.max(3, H * 0.09);

    const base = new THREE.Mesh(RB(w * 0.94, baseH, h * 0.82, Math.min(w, h) * 0.035), shell);
    base.position.set(0, baseH / 2, h * 0.06);
    g.add(base);

    // The lid sits at the back and leans away slightly like a real laptop.
    const lid = new THREE.Group();
    const lidW = w * 0.84, lidH = H * 0.68;
    const back = new THREE.Mesh(RB(lidW, lidH, Math.max(3, h * 0.045), 2.5), shell);
    lid.add(back);
    const bezel = new THREE.Mesh(RB(lidW * 0.91, lidH * 0.82, 1.8, 1.5), edge);
    bezel.position.z = Math.max(2.2, h * 0.028);
    lid.add(bezel);
    const display = new THREE.Mesh(RB(lidW * 0.84, lidH * 0.71, 1, 1.2), screenMat);
    display.position.z = Math.max(3.3, h * 0.04);
    lid.add(display);
    const reflection = new THREE.Mesh(new THREE.PlaneGeometry(lidW * 0.76, lidH * 0.15),
      M.glass(0x88c9e8, 0.2));
    reflection.position.set(0, lidH * 0.18, Math.max(4, h * 0.048));
    lid.add(reflection);
    const camera = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.7, w * 0.007), 10, 6),
      M.glass(0x6fcaff, 0.78));
    camera.position.set(0, lidH * 0.44, Math.max(4, h * 0.05));
    lid.add(camera);
    lid.position.set(0, baseH + lidH / 2, -h * 0.33);
    lid.rotation.x = -0.1;
    g.add(lid);

    // Slightly raised keys catch the key light and remain legible at gallery scale.
    const keyboardY = baseH + 0.9;
    const keyW = w * 0.07, keyD = h * 0.055;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 10; col++) {
        const key = new THREE.Mesh(RB(keyW, 1.4, keyD, 0.55), keyMat);
        key.position.set(w * (-0.34 + col * 0.075), keyboardY, h * (-0.15 + row * 0.07));
        g.add(key);
      }
    }
    const touchpad = new THREE.Mesh(RB(w * 0.28, 1, h * 0.14, 1.2), M.surface(0x4f5963, 0.5, 0.35));
    touchpad.position.set(0, keyboardY, h * 0.24);
    g.add(touchpad);

    // USB/audio ports down the visible side and a small power indicator.
    for (let i = 0; i < 3; i++) {
      const port = new THREE.Mesh(RB(w * 0.055, baseH * 0.35, 1.5, 0.5), keyMat);
      port.position.set(-w * 0.472, baseH * 0.55, h * (-0.13 + i * 0.13));
      port.rotation.y = Math.PI / 2;
      g.add(port);
    }
    const power = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.8, w * 0.008), 10, 6), M.led(0x5ef09b));
    power.position.set(w * 0.41, keyboardY + 0.4, -h * 0.19);
    moves(power, 'blink', { phase: 0.4, speed: 1.6 });
    g.add(power);
    return g;
  },

  // A process step as a compact conveyor station: something enters, is worked
  // on, and leaves. Rollers, legs and a side motor make it physical at a glance.
  process(w, h, H, M) {
    const g = new THREE.Group();
    const steel = M.primary(0x6f7880, 0.84, 0.3);
    const darkSteel = M.surface(0x272d32, 0.66, 0.42);
    const rubber = M.surface(0x171a1c, 0.02, 0.86);
    const safety = M.surface(0xe4a62b, 0.18, 0.52);
    const deckY = H * 0.56;

    const belt = new THREE.Mesh(RB(w * 0.92, H * 0.13, h * 0.62, Math.min(w, h) * 0.055), rubber);
    belt.position.y = deckY;
    g.add(belt);

    for (const sx of [-1, 1]) {
      const roller = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.095, h * 0.095, h * 0.64, 20), steel);
      roller.rotation.x = Math.PI / 2;
      roller.position.set(sx * w * 0.4, deckY, 0);
      g.add(roller);
    }
    for (const sz of [-1, 1]) {
      const rail = new THREE.Mesh(RB(w * 0.88, H * 0.08, 2.5, 1), steel);
      rail.position.set(0, deckY + H * 0.11, sz * h * 0.32);
      g.add(rail);
    }

    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(RB(w * 0.055, H * 0.48, h * 0.055, 1.2), darkSteel);
      leg.position.set(sx * w * 0.36, H * 0.27, sz * h * 0.26);
      g.add(leg);
      const foot = new THREE.Mesh(RB(w * 0.13, H * 0.045, h * 0.13, 1), rubber);
      foot.position.set(sx * w * 0.36, H * 0.0225, sz * h * 0.26);
      g.add(foot);
    }

    // A motor and guarded transmission on the visible side.
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.13, H * 0.13, w * 0.2, 20), darkSteel);
    motor.rotation.z = Math.PI / 2;
    motor.position.set(w * 0.29, H * 0.34, h * 0.37);
    g.add(motor);
    const guard = new THREE.Mesh(RB(w * 0.26, H * 0.27, h * 0.06, 2), safety);
    guard.position.set(w * 0.29, H * 0.36, h * 0.35);
    g.add(guard);
    const stop = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.065, H * 0.065, H * 0.05, 16),
      M.surface(0xd93d32, 0.12, 0.48));
    stop.position.set(w * 0.17, H * 0.52, h * 0.39);
    stop.rotation.x = Math.PI / 2;
    g.add(stop);

    // The workpiece provides scale and makes the action of the station explicit.
    const workpiece = new THREE.Mesh(RB(w * 0.19, H * 0.2, h * 0.29, 1.5),
      M.surface(0xc38b50, 0.02, 0.86));
    workpiece.position.set(-w * 0.08, deckY + H * 0.16, 0);
    moves(workpiece, 'travel-x', { span: w * 0.3, speed: 0.42, phase: 0.8 });
    g.add(workpiece);
    return g;
  },

  // A warning sign on a post — the one diamond everybody already knows how to
  // read. The floating octahedron it replaces meant nothing to anyone.
  decision(w, h, H, M) {
    const g = new THREE.Group();
    const r = Math.min(w, h) / 2;

    const foot = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, H * 0.08, 40), M.dark(0.42));
    foot.scale.set(w / 2 * 0.92, 1, h / 2 * 0.92);
    foot.position.y = H * 0.04;
    g.add(foot);

    const post = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.08, r * 0.1, H * 0.62, 16),
      M.metal(0.88, 0.3));
    post.position.y = H * 0.08 + H * 0.31;
    g.add(post);

    // Yawed rather than square-on, so it has depth from every camera angle and
    // still covers the footprint d2 reserved.
    const side = Math.min(w * 0.78, H * 0.52);
    const plate = new THREE.Mesh(new THREE.ExtrudeGeometry(outline('diamond', side, side), {
      depth: Math.max(2, side * 0.06), bevelEnabled: true, bevelThickness: 1, bevelSize: 1,
      bevelSegments: 1, curveSegments: 8,
    }), [M.primary(0xf2b72f, 0.12, 0.55), M.surface(0x3a3121, 0.55, 0.46)]);
    const pivot = new THREE.Group();
    pivot.add(plate);
    const markBar = new THREE.Mesh(RB(side * 0.09, side * 0.36, 1.5, 1), M.surface(0x25221d, 0, 0.72));
    markBar.position.set(0, side * 0.03, Math.max(2, side * 0.06) + 1);
    pivot.add(markBar);
    const markDot = new THREE.Mesh(new THREE.SphereGeometry(side * 0.055, 12, 8), M.surface(0x25221d, 0, 0.72));
    markDot.position.set(0, -side * 0.24, Math.max(2, side * 0.06) + 1);
    pivot.add(markDot);
    pivot.rotation.y = -0.42;
    pivot.position.y = H * 0.66;
    moves(pivot, 'sway-z', { phase: 1.4, amount: 0.022, speed: 0.75 });
    g.add(pivot);
    return g;
  },

  // A network gateway: low appliance, status panel, Ethernet sockets and two
  // aerials. The old hexagonal prism described the D2 outline, not an object.
  gateway(w, h, H, M) {
    const g = new THREE.Group();
    const shellH = H * 0.46;
    const shell = new THREE.Mesh(RB(w * 0.9, shellH, h * 0.76, Math.min(w, h) * 0.07), M.band(2, 1));
    shell.position.y = H * 0.24;
    g.add(shell);
    const face = new THREE.Mesh(RB(w * 0.76, shellH * 0.58, 2.6, 1.5), M.surface(0x171c21, 0.42, 0.54));
    face.position.set(0, H * 0.24, h * 0.385);
    g.add(face);
    for (let i = 0; i < 4; i++) {
      const port = new THREE.Mesh(RB(w * 0.105, shellH * 0.28, 2.2, 0.7), M.surface(0x080a0c, 0.1, 0.72));
      port.position.set(w * (-0.2 + i * 0.135), H * 0.23, h * 0.405);
      g.add(port);
      const light = new THREE.Mesh(new THREE.BoxGeometry(w * 0.025, 1.1, 1), M.led(i % 3 ? 0x63e69a : 0xffbd52));
      light.position.set(port.position.x, H * 0.35, h * 0.425);
      moves(light, 'blink', { phase: i * 1.3, speed: 1.8 + i * 0.3 });
      g.add(light);
    }
    for (const sx of [-1, 1]) {
      const aerial = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.025, H * 0.032, H * 0.62, 12),
        M.surface(0x20252a, 0.08, 0.7));
      aerial.position.set(sx * w * 0.36, H * 0.67, -h * 0.22);
      aerial.rotation.z = sx * -0.14;
      moves(aerial, 'sway-z', { phase: sx > 0 ? 0 : Math.PI, amount: 0.018, speed: 0.7 });
      g.add(aerial);
      const hinge = new THREE.Mesh(new THREE.SphereGeometry(H * 0.06, 14, 10), M.surface(0x111417, 0.1, 0.65));
      hinge.position.set(sx * w * 0.36, H * 0.39, -h * 0.22);
      g.add(hinge);
    }
    return g;
  },
};

/** How tall a shape of this kind stands, given the footprint d2 laid out. */
export function heightOf(type, w, h, container = false) {
  if (container) return 7;
  const [factor, lo, hi] = HEIGHT[familyOf(type)] ?? [0.45, 18, 64];
  return Math.round(clamp(Math.min(w, h) * factor, lo, hi));
}

/**
 * The body for one shape, base sitting on y = 0 and sized to its footprint.
 * Families without a bespoke form fall back to their outline extruded straight
 * up, which is the honest answer for a document, a callout or a container.
 *
 * `M` is the material palette the caller supplies — see Scene.svelte. Keeping it
 * an argument is what lets a test build these bodies with stubs and no GPU.
 */
export function bodyFor({ type, width, height, container = false }, M) {
  const depth = heightOf(type, width, height, container);
  const model = !container && MODELS[familyOf(type)];
  if (model) return seat(model(width, height, depth, M, type), width, height, depth);

  // The bevel grows the outline outward, so take it off first — otherwise every
  // extruded shape is 2·bevel wider than the box d2 reserved for it.
  const bevel = Math.min(3, depth / 4);
  const geo = new THREE.ExtrudeGeometry(outline(type, width - bevel * 2, height - bevel * 2), {
    depth: Math.max(1, depth - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 40,
  });
  geo.translate(0, 0, bevel); // sit the base on the floor, not under it

  const g = new THREE.Group();
  const mesh = new THREE.Mesh(geo, [M.lid(), M.wall()]);
  mesh.rotation.x = -Math.PI / 2;
  g.add(mesh);
  if (container) g.add(M.rim(geo));
  return seat(g, width, height, depth);
}

/**
 * Put a body on the floor, centred, and inside the footprint it was given.
 *
 * A model is hand-built from primitives, so its true extent depends on details
 * like how fat a collar is. Rather than getting every one of them exactly right
 * by arithmetic, measure the result and correct it: shrink (never grow, so a
 * deliberately small body stays small) and reseat. That makes "fits its
 * footprint and stands on the floor" true by construction rather than by care.
 */
function seat(g, w, h, depth) {
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  if (!(size.x > 0 && size.y > 0 && size.z > 0)) return g;

  // Uniform, so a cylinder stays round and a sphere stays a sphere. The height
  // allowance is loose: a database's lid is meant to stand proud of its stack.
  const k = Math.min(1, w / size.x, h / size.z, (depth * 1.18) / size.y);
  g.scale.multiplyScalar(k);
  g.updateMatrixWorld(true);

  const fitted = new THREE.Box3().setFromObject(g);
  const mid = fitted.getCenter(new THREE.Vector3());
  g.position.x -= mid.x;
  g.position.z -= mid.z;
  g.position.y -= fitted.min.y;
  return g;
}
