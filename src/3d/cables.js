// Connections as physical hardware: a conduit along d2's route, an animated
// current inside it, and d2's arrowheads as beveled plates. Pure three.js, so
// node can build and measure these (cables.test.js).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * A current travelling through an illuminated rail set into the conduit.
 * There are no marching decals or floating particles: direction is a smooth
 * voltage wave. The rails wind around the conduit and slowly rotate, so an
 * orbiting camera always sees part of the current instead of finding a dark
 * side where a fixed longitudinal strip is hidden behind the cable.
 */
export function currentMaterial(forwardColor, backwardColor, forward, backward) {
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
export function headShapes(kind, L, W) {
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

export function physicalArrow(position, direction, id, currentColor, kind) {
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
export function roundedRoute(points, radius = 22) {
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
export function cableGeometry(curve, radius, segments, sides, dash) {
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
export function curveSection(curve, start, end) {
  const section = new THREE.Curve();
  section.getPoint = (t, target = new THREE.Vector3()) =>
    target.copy(curve.getPointAt(THREE.MathUtils.lerp(start, end, t)));
  return section;
}
