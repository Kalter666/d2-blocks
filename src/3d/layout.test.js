// The 3D geometry decisions that used to be checked only by eye: what stands on
// what, and where a connection runs. Plain data in, vectors out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topology, centre, routePoints, arrowSpans, rimOf, PAD, LIFT } from './layout.js';
import { headShapes, roundedRoute } from './cables.js';
import * as THREE from 'three';

const shape = (id, x, y, w, h, extra = {}) => ({ id, pos: { x, y }, width: w, height: h, level: id.split('.').length, ...extra });

test('a parent is a platform and its children stand on it', () => {
  const { isContainer, liftOf } = topology([shape('g', 0, 0, 300, 200), shape('g.a', 20, 20, 80, 60)]);
  assert.equal(isContainer('g'), true);
  assert.equal(isContainer('g.a'), false);
  assert.equal(liftOf(shape('g.a', 0, 0, 1, 1)), PAD);
});

test('inside a sequence diagram, only blended groups are platforms', () => {
  const shapes = [
    shape('s', 0, 0, 500, 400, { type: 'sequence_diagram', level: 1 }),
    shape('s.alice', 0, 0, 80, 40),
    shape('s.alice.span', 0, 60, 10, 80),
    shape('s.grp', 0, 0, 200, 100, { blend: true }),
  ];
  const { isContainer, liftOf } = topology(shapes);
  assert.equal(isContainer('s'), true);
  assert.equal(isContainer('s.alice'), false, 'an actor with spans is still an actor');
  assert.equal(isContainer('s.grp'), true);
  // Everything in it stands on the diagram's platform, however deep it nests.
  assert.equal(liftOf(shapes[2]), PAD);
});

test('the model is centred on the diagram', () => {
  const { at } = centre([shape('a', 100, 100, 100, 100), shape('b', 300, 100, 100, 100)]);
  assert.deepEqual(at(250, 150), [0, 0]);
});

test('a container-to-child link leaves the rim and lands on the roof', () => {
  const outer = { x: 0, z: 0, base: 0, top: 7, half: { x: 100, z: 50 } };
  const inner = { x: 60, z: 0, base: 7, top: 47, half: { x: 20, z: 20 } };
  const pts = routePoints({ src: 'g', dst: 'g.a', route: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }, outer, inner, (x, y) => [x, y]);
  assert.equal(pts.length, 3);
  assert.deepEqual(pts[0].toArray(), [100, 10, 0], 'from the nearest point on the platform edge');
  assert.deepEqual(pts[2].toArray(), [60, 51, 0], 'onto the child, not into it');
  assert.ok(pts[1].y > inner.top, 'arcs over');
});

test('a plain link bows up between its ends', () => {
  const pts = routePoints({ src: 'a', dst: 'b', route: [{ x: 0, y: 0 }, { x: 200, y: 0 }] }, null, null, (x, y) => [x, y]);
  assert.equal(pts.length, 3, 'a two-point route gains a midpoint to bow through');
  assert.equal(pts[0].y, LIFT);
  assert.ok(pts[1].y > LIFT);
  assert.equal(routePoints({ route: [{ x: 0, y: 0 }] }, null, null, (x, y) => [x, y]), null);
});

test('the cable stops short of each arrowhead, and only there', () => {
  const both = arrowSpans(400, true, true);
  assert.ok(both.wireStart > 0 && both.wireEnd < 1);
  const plain = arrowSpans(400, false, false);
  assert.deepEqual([plain.wireStart, plain.wireEnd], [0, 1]);
  // A hop shorter than two heads still keeps some cable.
  const tiny = arrowSpans(5, true, true);
  assert.ok(tiny.wireEnd > tiny.wireStart);
});

test('rimOf picks the nearest footprint edge', () => {
  const box = { x: 0, z: 0, half: { x: 100, z: 50 } };
  assert.deepEqual(rimOf(box, new THREE.Vector3(90, 0, 0)).toArray(), [100, 0, 0]);
  assert.deepEqual(rimOf(box, new THREE.Vector3(0, 0, -45)).toArray(), [0, 0, -50]);
});

test('every d2 arrowhead has a shape', () => {
  for (const kind of ['triangle', 'arrow', 'diamond', 'filled-diamond', 'circle', 'filled-circle',
    'box', 'filled-box', 'unfilled-triangle', 'cross', 'cf-one', 'cf-one-required', 'cf-many', 'cf-many-required']) {
    assert.ok(headShapes(kind, 24, 18).length > 0, kind);
  }
});

test('a routed elbow is rounded, not cut', () => {
  const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(100, 0, 0), new THREE.Vector3(100, 0, 100)];
  const path = roundedRoute(pts);
  assert.ok(path.curves.some((c) => c.isCubicBezierCurve3));
  assert.ok(path.getPointAt(1).distanceTo(pts[2]) < 1e-6);
});
