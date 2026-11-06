// How a compiled d2 shape or connection becomes 3D surface: the style d2
// resolved, the colours the hidden SVG painted, and the material palette `M`
// every model in models.js draws from. Only readPaint() touches the DOM.
import * as THREE from 'three';
import { PALETTE, materialsOf } from '../models.js';

export { PALETTE };

const asNumber = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const usableColor = (value, fallback) =>
  value && value !== 'none' && !String(value).startsWith('url(') ? value : fallback;
// d2 hands unset colours over as theme tokens (N1, B4, AA2…) and resolves them
// only in the SVG. Anything else was written by someone: a style, a class, a var.
const explicit = (v) => (v && v !== 'transparent' && !/^[A-Z]{1,2}\d$/.test(v) ? v : undefined);
// ponytail: d2's default label sizes; an explicit size equal to one is ignored.
const DEFAULT_FONT = new Set([16, 20, 24, 28]);

/**
 * What the hidden SVG actually painted for one tagged <g>. d2 hands unset
 * colours over as theme tokens (N1, B4…) and resolves them only there, under the
 * selected light/dark palette, so this is the one place they become colours.
 * Shapes keep their paint below `.shape`; connections are paths directly inside
 * their tagged group.
 */
export function readPaint(root) {
  const el = root?.querySelector('.shape > :not([class*="-overlay"])')
    ?? root?.querySelector('path, polyline, line');
  const css = el ? getComputedStyle(el) : null;
  const text = root?.querySelector('text');
  const textCss = text ? getComputedStyle(text) : null;
  return {
    fill: usableColor(css?.fill, el?.getAttribute('fill') ?? '#456b8c'),
    stroke: usableColor(css?.stroke, el?.getAttribute('stroke') ?? '#93b8d4'),
    text: usableColor(textCss?.fill, '#f7f8fa'),
    transform: textCss?.textTransform,
    overlay: root?.querySelector('[class$="-overlay"]')?.classList?.[0]?.replace('-overlay', ''),
  };
}

/**
 * The style d2 actually resolved for a shape or connection `o`. Read from the
 * compiled object, not the editor's style blocks, so classes, vars, globs and
 * imports all count; `painted` (readPaint) fills whatever d2 left as a token.
 */
export function resolveStyle(o, painted) {
  const fill = explicit(o.fill), stroke = explicit(o.stroke);
  return {
    fill: usableColor(fill, painted.fill),
    stroke: usableColor(stroke, painted.stroke),
    opacity: Math.min(1, Math.max(0, asNumber(o.opacity, 1))),
    strokeWidth: asNumber(o.strokeWidth, 2),
    pattern: o.fillPattern || painted.overlay,
    animated: !!o.animated,
    explicitFill: fill,
    explicitStroke: stroke,
    label: {
      color: usableColor(explicit(o.color), painted.text),
      stroke: usableColor(stroke, 'rgba(255,255,255,0.18)'),
      bold: o.bold,
      italic: o.italic,
      underline: o.underline,
      transform: painted.transform,
      size: o.fontSize && !DEFAULT_FONT.has(o.fontSize)
        ? Math.min(80, Math.max(16, o.fontSize * 1.75)) : null,
    },
  };
}

/**
 * PBR texture maps multiply their pixels by material colour. Very dark d2
 * theme swatches therefore become black after texturing and tone mapping.
 * Preserve hue/saturation but keep shells inside a readable studio range.
 */
export function studioColor(value, minLight = 0.27, maxLight = 0.78) {
  const color = new THREE.Color(value);
  const hsl = {};
  color.getHSL(hsl);
  color.setHSL(hsl.h, Math.max(0.16, hsl.s), Math.min(maxLight, Math.max(minLight, hsl.l)));
  return color;
}

export function naturalColor(value, darkScene) {
  const color = new THREE.Color(value);
  if (!darkScene) return color;
  const hsl = {};
  color.getHSL(hsl);
  // Lift near-black rubber, bezels and steel without turning them grey or
  // erasing the contrast between those details and the main shell.
  color.setHSL(hsl.h, hsl.s, Math.max(0.065, hsl.l));
  return color;
}

/** Opacity, fill-pattern relief and stroke glow onto every themed part of `body`. */
export function applyStyle(body, visual, bump) {
  const accent = studioColor(visual.stroke, visual.darkScene ? 0.64 : 0.5, 0.92);
  body.userData.animated = visual.animated;
  body.traverse((n) => {
    if (!n.isMesh) return;
    if (visual.shadow === false) n.castShadow = false;
    for (const m of materialsOf(n)) {
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

/**
 * The palette every body draws from. `band` is the family skin at a UV count
 * rather than in world units, because a primitive's UVs are 0..1; `lid`/`wall`
 * are the same skin tiled in world units, for the extrusions. Its keys must be
 * exactly PALETTE (materials.test.js checks).
 */
export function makePalette({ family, spec, shellColor, accentColor, glow, darkScene, container, explicitFill }, { tex, worldTex }) {
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
      const resolved = explicitFill ? themeColor : natural.lerp(themeColor, 0.32);
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
  return M;
}
