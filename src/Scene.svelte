<script>
  // 3D mode is a real renderer, not a skin. d2 still compiles the diagram and
  // lays it out; this reads the geometry out of the compiled result and builds
  // actual solids from it — extruded outlines, lit, shadowed, orbitable.
  //
  // The SVG stays in the DOM (hidden) for two reasons: Download SVG still works,
  // and resolved theme/style values are read off it, so d2's palette table never
  // has to be duplicated here.
  //
  // This file is the orchestration: build() walks the diagram, init() owns the
  // render loop and pointer handling, the effects wire both to the store. The
  // parts live in src/3d/ — layout (where), materials (what surface), skins
  // (textures), cables (connections), art (labels, icons, panels), stage
  // (renderer and lights) — and the bodies themselves in src/models.js.
  import * as THREE from 'three';
  import { unsafeAttr } from './sanitize.js';
  import { app } from './store.svelte.js';
  import { keys } from './blocks.js';
  import { linkTarget } from './boards.js';
  import { t } from './i18n/index.svelte.js';
  import { familyOf, heightOf, bodyFor, resolvedType, animateParts, materialsOf } from './models.js';
  import { SKIN, DARK_FAMILY, createSkins } from './3d/skins.js';
  import { readPaint, resolveStyle, applyStyle, studioColor, makePalette } from './3d/materials.js';
  import { topology, centre, routePoints, arrowSpans } from './3d/layout.js';
  import { currentMaterial, physicalArrow, roundedRoute, cableGeometry, curveSection } from './3d/cables.js';
  import { plaque, mdDisclosure, iconUrl, isPanel, SLAB, createArt } from './3d/art.js';
  import { createStage, grade, dispose, fit } from './3d/stage.js';

  let { maps } = $props();

  let canvas = $state(null);
  let tip = $state(null); // { text, x, y } — a hovered tooltip, in stage pixels
  let box = $state(null);
  let world = null; // everything three owns, once it exists
  // Set once, never read inside the effect that sets it: `ready++` would be a
  // read and a write of the same state, which re-runs init on its own output.
  let ready = $state(false);

  const HOVER = new THREE.Color(0x7dd3fc); // the tint a hovered object takes on
  const darkAppearance = () => app.appearance === 'dark'
    || (app.appearance === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);

  const skins = createSkins(() => world?.renderer.capabilities.getMaxAnisotropy() ?? 4);
  const art = createArt({
    shared: skins.shared,
    lookup: (id) => maps.byId.get(id),
    invalidate: () => world?.invalidate?.(),
  });
  /** What d2 resolved for `o`, with the colours its hidden SVG painted. */
  const styleOf = (o) => resolveStyle(o, readPaint(maps.byId.get(o.id)));

  // --------------------------------------------------------------------- build

  function build(diagram) {
    const group = new THREE.Group();
    const currents = []; // the animated current shaders, ticked by the render loop
    const mdPanels = new Map();
    if (!diagram?.shapes?.length) return { group, currents, mdPanels, meta: new Map() };
    // The editor only knows the root board; a layer's ids can mean other shapes.
    const sourceShapes = new Map((app.board ? [] : keys(app.blocks)).map(({ key, name, shape, md }) =>
      [key, { name, shape, md }]));
    const typeOf = (shape) => resolvedType(shape.type, sourceShapes.get(shape.id));
    const meta = new Map(); // id → { tooltip, link }, for the pointer handlers
    const darkScene = darkAppearance();

    const { isContainer, liftOf } = topology(diagram.shapes);
    const depthOf = (s) => (s.type === 'image' ? s.height
      : isPanel(s) ? SLAB
        : heightOf(typeOf(s), s.width, s.height, isContainer(s.id)));
    const { at, radius } = centre(diagram.shapes);
    const openMd = (id) => world?.openMd?.has(id) ?? false;
    const addDisclosure = (d, id) => { mdPanels.set(id, d); group.add(d.badge, d.panel); };
    for (const s of diagram.shapes) {
      const source = sourceShapes.get(s.id);
      const container = isContainer(s.id);
      const type = typeOf(s);
      const note = type === 'text' && !isPanel(s);
      const icon = iconUrl(s.icon);
      if (s.tooltip || s.link) meta.set(s.id, { tooltip: s.tooltip, link: s.link });
      const visual = styleOf(s);
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
      const lift = liftOf(s);

      // A note is borderless by definition — d2 draws it as bare markdown, so in
      // 3D it is its label and nothing else. Give it a body and it becomes a box,
      // which is the one thing the shape exists to avoid.
      if (note) {
        if (source?.md) {
          const d = mdDisclosure(s.id, source.name, s.label, visual.label, visual.label.size ?? 25, openMd(s.id));
          d.place(new THREE.Vector3(cx, lift + 24, cz));
          addDisclosure(d, s.id);
        } else if (s.label) {
          const tag = plaque(s.label, visual.label.size ?? 30, visual.label);
          tag.position.set(cx, lift + 24, cz);
          tag.userData = { id: s.id };
          group.add(tag);
        }
        continue;
      }

      // `family` already fell back to 'block' if 3d/skins.js has no SKIN for it
      // (models.test.js checks that it always does): a plain body beats a black canvas.
      const spec = SKIN[family];
      const glow = container ? (darkScene ? 0.08 : 0.32) : 1;
      const depth = depthOf(s);
      const M = makePalette(
        { family, spec, shellColor, accentColor, glow, darkScene, container, explicitFill: visual.explicitFill },
        skins,
      );

      const body = s.type === 'image'
        ? (icon ? art.picture(icon, s.width, s.height, s.id) : new THREE.Group())
        : isPanel(s) ? art.panelBody(s, M)
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
        const materials = materialsOf(n);
        const opaque = materials.every((material) => !material.transparent && material.opacity >= 1);
        n.castShadow = !container && opaque && (n.geometry.boundingSphere?.radius ?? 0) >= 4;
        n.receiveShadow = true;
        n.frustumCulled = false;
      });
      applyStyle(body, visual, skins.patternTex(visual.pattern));
      group.add(body);

      // An icon floats over its object; a group's sits in the platform's corner
      // so the children standing on it don't hide it.
      if (icon && s.type !== 'image') {
        const size = Math.min(72, Math.min(s.width, s.height) * (container ? 0.3 : 0.5));
        const badge = art.picture(icon, size, size, s.id);
        badge.position.add(container
          ? new THREE.Vector3(cx - s.width / 2 + size * 0.7, lift + depth + 4, cz - s.height / 2 + size * 0.7)
          : new THREE.Vector3(cx, lift + depth + 6, cz - s.height * 0.15));
        group.add(badge);
      }

      // A table, class, code block or formula carries its label in its drawing.
      if ((s.label || source?.md) && !isPanel(s)) {
        const d = source?.md
          ? mdDisclosure(s.id, source.name, s.label, visual.label, visual.label.size ?? 25, openMd(s.id))
          : null;
        const tag = d?.panel ?? plaque(s.label, visual.label.size ?? (container ? 32 : 30), visual.label);
        // A billboard centred over the footprint is intersected by its own body
        // and, for groups, by the children standing on the platform. Seat every
        // plaque just beyond the front edge instead. It remains depth-tested, so
        // orbiting behind the object hides it naturally rather than showing it
        // through the body.
        const verticalClearance = tag.scale.y * 0.56;
        const frontClearance = Math.max(5, tag.scale.y * 0.14);
        const seat = new THREE.Vector3(
          cx,
          // d2 captions a picture underneath it; anywhere higher covers it.
          lift + (s.type === 'image' ? 0 : depth) + verticalClearance,
          cz + s.height / 2 + frontClearance,
        );
        if (d) {
          d.place(seat);
          addDisclosure(d, s.id);
        } else {
          tag.position.copy(seat);
          tag.userData = { id: s.id };
          group.add(tag);
        }
      }
    }

    const solid = new Map(diagram.shapes.map((s) => {
      const [x, z] = at((s.pos?.x ?? 0) + s.width / 2, (s.pos?.y ?? 0) + s.height / 2);
      const base = liftOf(s);
      return [s.id, {
        x, z, base, top: base + depthOf(s),
        half: { x: s.width / 2, z: s.height / 2 },
      }];
    }));

    for (const c of diagram.connections ?? []) {
      const from = solid.get(c.src), to = solid.get(c.dst);
      // Connections are present in d2's SVG map too, so their resolved stroke
      // follows the selected light/dark theme just like shape accents do.
      const connectionPaint = styleOf(c);
      const currentColor = studioColor(
        connectionPaint.stroke,
        darkScene ? 0.67 : 0.53,
        darkScene ? 0.96 : 0.9,
      );
      const pts = routePoints(c, from, to, at);
      if (!pts) continue;

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

      const { headCentre, wireStart, wireEnd, segments: tubeSegments } =
        arrowSpans(curve.getLength(), forward, backward);
      // Twelve sides remain round at cable scale.
      const tubeSides = 12;
      const wireCurve = curveSection(curve, wireStart, wireEnd);

      // A real conduit first, with a narrow animated light strip riding just
      // above its surface. Transparent gaps reveal the dark hose underneath.
      const dash = Math.max(c.strokeDash || 0, 0); // unset is undefined, and Math.max(undefined, 0) is NaN
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
      if (energized) currents.push({ material: current });
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

    return { group, currents, mdPanels, meta, radius };
  }

  // ----------------------------------------------------------------- the scene

  function init() {
    // bind:this lands before effects flush, but never hand WebGLRenderer a null
    // canvas — it quietly makes its own and renders into nothing.
    if (!canvas || !box || world) return;

    const stage = createStage(canvas);
    const { renderer, scene, camera, controls } = stage;
    world = {
      ...stage,
      model: null, currents: [], mdPanels: new Map(), meta: new Map(), openMd: new Set(), radius: 400,
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
      const { board, url } = linkTarget(link, app.boards);
      if (board != null) app.board = board;
      else if (!unsafeAttr('href', url)) window.open(url, '_blank', 'noopener');
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
      const animated = !still && (world.currents.length > 0 || world.hasMotion);
      const fps = active ? 60 : animated ? 30 : 60;
      if (lastRender && now - lastRender < 1000 / fps) return;
      if (!dirty && !active && !animated) return;
      lastRender = now;

      timer.update();
      const time = timer.getElapsed();
      if (!still) for (const d of world.currents) {
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
      if (world.model) dispose(world.model, skins.shared);
      dispose(scene, skins.shared);
      renderer.dispose();
      world = null;
      ready = false;
    };
  }

  /** Frame the whole model — the "reset" for an orbit that has wandered off. */
  const frame = () => { if (world) fit(world); };

  $effect(() => init());

  $effect(() => {
    const dark = darkAppearance();
    if (!ready || !world) return;
    grade(world, dark);
    world.invalidate?.();
  });

  // Rebuild whenever d2 hands us a new diagram. The camera is left alone — it
  // would be unusable if every keystroke snapped the view back.
  $effect(() => {
    const diagram = app.diagram;
    app.svg; // the colours are read off the SVG, so wait for the matching one
    if (!ready || !world) return;

    const first = !world.model;
    if (world.model) { world.scene.remove(world.model); dispose(world.model, skins.shared); }
    const { group, currents, mdPanels, meta, radius } = build(diagram);
    world.model = group;
    world.meta = meta;
    world.currents = currents;
    world.mdPanels = mdPanels;
    world.radius = radius ?? 400;
    world.hasMotion = false;
    group.traverse((node) => {
      if (node.userData?.motion || node.userData?.animated) world.hasMotion = true;
    });
    world.scene.add(group);
    world.renderer.shadowMap.needsUpdate = true;
    world.invalidate?.();
    if (first) frame();
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
        for (const m of materialsOf(p)) {
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
  <button class="reset" onclick={frame} title={t('scene.frame')}>⤢</button>
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
