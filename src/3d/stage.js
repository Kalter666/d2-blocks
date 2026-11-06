// The studio the diagram stands in: renderer, camera, lights, floor and grid,
// plus the bits of lifecycle that don't depend on what is being drawn.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { materialsOf } from '../models.js';

export const BG = 0x0b1017;
export const DARK_BG = 0x121c26; // dark-theme objects need separation from the stage

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

/** Everything that exists before a diagram does, drawing into `canvas`. */
export function createStage(canvas) {
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

  return { renderer, scene, camera, controls, key, hemi, fillLight, grid };
}

/**
 * Dark D2 palettes use deliberately low-value colours. Give them a brighter
 * studio and a separated background; light palettes keep the original grade.
 */
export function grade(stage, dark) {
  const bg = dark ? DARK_BG : BG;
  stage.scene.background.set(bg);
  stage.scene.fog.color.set(bg);
  stage.scene.environmentIntensity = dark ? 0.88 : 0.9;
  stage.renderer.toneMappingExposure = dark ? 1.0 : 1.08;
  stage.hemi.intensity = dark ? 1.08 : 1.15;
  stage.key.intensity = dark ? 2.35 : 2.65;
  stage.fillLight.intensity = dark ? 0.78 : 0.9;
  stage.grid.material.uniforms.uOpacity.value = dark ? 0.46 : 0.38;
}

export function dispose(obj, shared) {
  obj.traverse((n) => {
    n.geometry?.dispose();
    const mats = materialsOf(n);
    // Label and dash textures are one per object; the family skins are shared
    // by every material and have to outlive the rebuild that drops them.
    for (const m of mats) {
      m.userData.gone = true;
      for (const t of [m.map, m.emissiveMap]) if (t && !shared.has(t)) t.dispose();
      m.dispose();
    }
  });
}

/** Frame the whole model — the "reset" for an orbit that has wandered off. */
/** Frame the whole model — the "reset" for an orbit that has wandered off. */
export function fit({ camera, controls, radius }) {
  const d = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 0.75;
  camera.position.set(0, d * 0.72, d * 0.78);
  controls.target.set(0, 0, 0);
  controls.update();
}
