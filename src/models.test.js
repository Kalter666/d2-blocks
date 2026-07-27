// The 3D bodies are geometry, so they can be measured without a GPU: build one
// per d2 shape and check it is where it claims to be. This catches the failures
// that actually happen — a model hanging through the floor, one wider than the
// footprint d2 reserved for it, a family with no skin — none of which are
// obvious until you orbit the camera onto them.
//
// It cannot judge whether a thing *looks* right. Load `?gallery` for that: it
// puts one of every shape on screen at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SHAPES } from './blocks.js';
import { MODELS, FAMILY, HEIGHT, familyOf, heightOf, bodyFor, outline, resolvedType } from './models.js';

// Materials don't affect geometry, so the palette can be stubs — which is the
// whole point of keeping it an argument.
const stub = new THREE.MeshBasicMaterial();
const M = {
  band: () => stub, cap: () => stub, metal: () => stub, dark: () => stub,
  gloss: () => stub, matte: () => stub, led: () => stub,
  surface: () => stub, glass: () => stub,
  primary: () => stub,
  lid: () => stub, wall: () => stub,
  rim: () => new THREE.Object3D(),
};

const measure = (body) => {
  body.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(body);
};

const types = SHAPES.map(([value]) => value);

test('every d2 shape builds a body', () => {
  for (const type of types) {
    const body = bodyFor({ type, width: 100, height: 80 }, M);
    const box = measure(body);
    assert.ok(box.min.x < box.max.x && box.min.z < box.max.z, `${type || 'default'} is empty`);
  }
});

test('nothing sinks through the floor', () => {
  // The floor catches shadows at y = 0. A body poking below it looks like it is
  // buried, and the shadow lands in the wrong place.
  for (const type of types) {
    const box = measure(bodyFor({ type, width: 100, height: 80 }, M));
    assert.ok(box.min.y > -0.5, `${type || 'default'} starts at y=${box.min.y.toFixed(2)}`);
  }
});

test('a body stays inside the footprint d2 reserved for it', () => {
  // d2 does the layout in 2D. If a 3D body is wider than the box it was given,
  // it overlaps its neighbours and the diagram stops matching the flat render.
  for (const type of types) {
    const [w, h] = [100, 80];
    const box = measure(bodyFor({ type, width: w, height: h }, M));
    const size = box.getSize(new THREE.Vector3());
    assert.ok(size.x <= w * 1.02, `${type || 'default'} is ${size.x.toFixed(1)} wide, footprint is ${w}`);
    assert.ok(size.z <= h * 1.02, `${type || 'default'} is ${size.z.toFixed(1)} deep, footprint is ${h}`);
    assert.ok(Math.abs(box.getCenter(new THREE.Vector3()).x) < w * 0.06,
      `${type || 'default'} is not centred on its footprint`);
  }
});

test('a body actually fills the footprint, rather than being a post in it', () => {
  // How `outline` silently returning nothing showed up: the five polygon shapes
  // extruded an empty shape, leaving a 7×7 stick of pure bevel standing in a
  // 100×80 box. It measured as a valid body from every other angle.
  for (const type of types) {
    const [w, h] = [100, 80];
    const size = measure(bodyFor({ type, width: w, height: h }, M)).getSize(new THREE.Vector3());
    assert.ok(size.x > w * 0.5 && size.z > h * 0.5,
      `${type || 'default'} is ${size.x.toFixed(1)}×${size.z.toFixed(1)} in a ${w}×${h} footprint`);
  }
});

test('height stays near what heightOf promised', () => {
  // Labels are placed from heightOf, so a body much taller than it claims wears
  // its own name through the middle. A little over is fine — a database's lid
  // deliberately sits proud of the stack.
  for (const type of types) {
    const want = heightOf(type, 100, 80);
    const box = measure(bodyFor({ type, width: 100, height: 80 }, M));
    assert.ok(box.max.y <= want * 1.2 + 2,
      `${type || 'default'} stands ${box.max.y.toFixed(1)} but claims ${want}`);
    assert.ok(box.max.y > want * 0.5, `${type || 'default'} is much shorter than it claims`);
  }
});

test('extreme footprints do not turn inside out', () => {
  // d2 sizes a shape to its label, so a long name gives a very wide, shallow box.
  for (const type of types) {
    for (const [w, h] of [[400, 30], [30, 300], [24, 24]]) {
      const box = measure(bodyFor({ type, width: w, height: h }, M));
      const size = box.getSize(new THREE.Vector3());
      assert.ok(size.x > 0 && size.y > 0 && size.z > 0,
        `${type || 'default'} collapsed at ${w}×${h}`);
      assert.ok(size.x <= w * 1.02 && size.z <= h * 1.02,
        `${type || 'default'} burst its ${w}×${h} footprint`);
    }
  }
});

test('a container is a low platform, whatever shape it is', () => {
  for (const type of types) {
    const box = measure(bodyFor({ type, width: 200, height: 150, container: true }, M));
    assert.ok(box.max.y <= 9, `a container of ${type || 'default'} stands ${box.max.y.toFixed(1)}`);
  }
});

// Config drift: adding a shape to blocks.js without a family, or a family
// without a height, degrades silently to the fallback instead of erroring.
test('every shape maps to a family, and every family is configured', () => {
  for (const type of types) {
    assert.ok(FAMILY[type], `${type || 'default'} has no family`);
  }
  for (const family of new Set(Object.values(FAMILY))) {
    if (MODELS[family]) assert.ok(HEIGHT[family], `${family} is modelled but has no height`);
  }
});

test('the families that should be modelled are', () => {
  // The whole point of 3D mode: these read as the thing, not as a box.
  for (const type of ['cylinder', 'stored_data', 'queue', 'person', 'cloud', 'rectangle']) {
    assert.ok(MODELS[familyOf(type)], `${type} fell back to an extruded outline`);
  }
});

test('an unknown shape still gets an outline', () => {
  // parse() is permissive, so a shape name this editor has never heard of can
  // reach the scene. It must not throw.
  assert.doesNotThrow(() => outline('not_a_real_shape', 100, 80));
  assert.doesNotThrow(() => bodyFor({ type: 'not_a_real_shape', width: 100, height: 80 }, M));
});

test('the source shape wins when d2 normalises a compiled type', () => {
  assert.equal(resolvedType('oval', { shape: 'circle', md: false }), 'circle');
  assert.equal(resolvedType('rectangle', { shape: 'square', md: false }), 'square');
  assert.equal(resolvedType('text', { shape: '', md: true }), 'text');
});
