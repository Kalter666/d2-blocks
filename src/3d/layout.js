// Where things go in 3D, decided from the compiled diagram alone: which shapes
// are platforms, how high each one stands, and the route a connection takes.
// No DOM and no materials, so layout.test.js can pin the awkward cases
// (sequence diagrams, container-to-child hops, short routes) without a GPU.
import * as THREE from 'three';
import { heightOf } from '../models.js';

export const PAD = heightOf('', 0, 0, true); // a container platform's thickness

/** Connections float a little off the floor so they read as links between objects. */
export const LIFT = 16;

/** Which shapes are platforms, and how high each one's base stands. */
export function topology(shapes) {
  const ids = shapes.map((s) => s.id);
  const byId = new Map(shapes.map((s) => [s.id, s]));
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
  // Children stand *on* their container's platform, not on the world floor —
  // otherwise every one of them is buried to the depth of the pad. d2's level
  // counts the nesting, and every platform is the same thickness.
  const liftOf = (s) => {
    const seq = sequenceOf(s.id);
    return seq ? seq.level * PAD : ((s.level ?? 1) - 1) * PAD;
  };
  return { isContainer, liftOf };
}

/**
 * d2 lays out in screen coordinates; the model is centred so orbiting spins
 * around the diagram rather than around wherever d2 happened to put it.
 * `at(x, y)` maps a d2 point to [x, z]; `radius` frames the camera.
 */
export function centre(shapes) {
  const bounds = new THREE.Box2();
  for (const s of shapes) {
    bounds.expandByPoint(new THREE.Vector2(s.pos?.x ?? 0, s.pos?.y ?? 0));
    bounds.expandByPoint(new THREE.Vector2((s.pos?.x ?? 0) + s.width, (s.pos?.y ?? 0) + s.height));
  }
  const mid = bounds.getCenter(new THREE.Vector2());
  return {
    at: (x, y) => [x - mid.x, y - mid.y],
    radius: Math.max(120, bounds.getSize(new THREE.Vector2()).length() / 2),
  };
}

/** The point on a shape's footprint edge nearest `p` — where a link should leave it. */
export function rimOf(box, p) {
  const dx = [p.x - (box.x - box.half.x), (box.x + box.half.x) - p.x];
  const dz = [p.z - (box.z - box.half.z), (box.z + box.half.z) - p.z];
  const near = Math.min(...dx, ...dz);
  if (near === dx[0]) return new THREE.Vector3(box.x - box.half.x, 0, p.z);
  if (near === dx[1]) return new THREE.Vector3(box.x + box.half.x, 0, p.z);
  if (near === dz[0]) return new THREE.Vector3(p.x, 0, box.z - box.half.z);
  return new THREE.Vector3(p.x, 0, box.z + box.half.z);
}

/**
 * The 3D control points for connection `c`. `from`/`to` are solids as
 * `{x, z, base, top, half}`; `at` is centre()'s mapper. Null when d2 gave no
 * usable route.
 */
export function routePoints(c, from, to, at) {
  // Ride above whichever end stands higher, so a link between two boxes on a
  // platform runs over the platform rather than through it.
  const floor = Math.max(from?.base ?? 0, to?.base ?? 0) + LIFT;
  const flat = (c.route ?? []).map((p) => {
    const [x, z] = at(p.x, p.y);
    return new THREE.Vector3(x, floor, z);
  });
  if (flat.length < 2) return null;
  // d2 routes in 2D, where a container-to-child line is a short hop across
  // the container's own floor. In 3D that hop starts inside the solids
  // standing on it, so the line appears to come out of nowhere.
  const down = c.dst?.startsWith(`${c.src}.`);   // container → child
  const up = c.src?.startsWith(`${c.dst}.`);     // child → container

  if ((down || up) && from && to) {
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
    return down ? [rim, mid, lid] : [lid, mid, rim];
  }
  // A gentle bow, so a long link reads as an arc rather than a floor stripe.
  const arc = Math.min(26, flat[0].distanceTo(flat.at(-1)) * 0.12);
  const pts = flat.map((p, i) => (i === 0 || i === flat.length - 1
    ? p
    : p.clone().setY(floor + arc * Math.sin((Math.PI * i) / (flat.length - 1)))));
  if (pts.length === 2 && arc > 0) {
    pts.splice(1, 0, flat[0].clone().lerp(flat[1], 0.5).setY(floor + arc));
  }
  return pts;
}

/**
 * Arrowheads are terminal hardware, not decals laid over a continuous cable:
 * reserve enough arc length for each head and end the conduit at its tail, so
 * neither the metal nor the luminous current shows through. Fractions of the
 * route's length, 0 = source end.
 */
export function arrowSpans(routeLength, forward, backward) {
  const length = Math.max(1, routeLength);
  const headCentre = Math.min(0.18, 10 / length);
  // Stop far enough behind the plate for the cable and its larger additive
  // glow shell to terminate inside the arrow socket, never through its face.
  const headTail = Math.min(0.32, 27 / length);
  const wireStart = backward ? headTail : 0;
  const wireEnd = Math.max(wireStart + 0.02, forward ? 1 - headTail : 1);
  // Fixed 96×20 tubes spent the same geometry on a short hop as a route across
  // the whole diagram. Lengthwise segments grow with the route and stop where
  // extra tessellation is no longer visible.
  const segments = Math.max(24, Math.min(64, Math.ceil(length / 10)));
  return { headCentre, wireStart, wireEnd, segments };
}
