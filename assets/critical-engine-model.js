import * as THREE from './three/three.module.min.js';
import {addTwin} from './twin-airframe.js';

const GOLD = '#f4b95b';
const TEAL = '#54d8df';
const LILAC = '#dfb8ff';
const SILVER = '#bccbd4';
const INK = '#101e2d';
const nacelleX = 1.58;
const propZ = -1.85;
const hubY = .03;

// All annotations are anchored in aircraft coordinates and projected through the
// same camera as the airframe. Stroke and text sizes stay readable on phones.
function drawAnnotations(ctx, camera, width, height, state, propellerView, namedView) {
  const projected = new THREE.Vector3();
  const fontSize = width < 480 ? 12 : 14;
  ctx.font = '600 ' + fontSize + 'px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  function project(x, y, z) {
    projected.set(x, y, z).project(camera);
    return [(1 + projected.x) * width / 2, (1 - projected.y) * height / 2];
  }
  function stroke(points, color, thickness = 2.25, dash = []) {
    ctx.setLineDash(dash);
    ctx.beginPath();
    points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.lineWidth = thickness + 2;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.lineWidth = thickness;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  function arrow(points, color, dashed = false) {
    stroke(points, color, 2.75, dashed ? [4, 4] : []);
    const [x, y] = points.at(-1);
    const [prevX, prevY] = points.at(-2);
    const angle = Math.atan2(y - prevY, x - prevX);
    const length = width < 480 ? 8 : 10;
    const delta = .57;
    stroke([[x - length * Math.cos(angle - delta), y - length * Math.sin(angle - delta)],
      [x, y], [x - length * Math.cos(angle + delta), y - length * Math.sin(angle + delta)]], color, 2.75);
  }
  // A muted, fixed-size chip leaves the airframe visible even when the camera
  // is very close or labels would otherwise lie against a light wing.
  function label(text, x, y, color, align = 'center') {
    const w = ctx.measureText(text).width + 12;
    const h = fontSize + 8;
    let sx = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
    sx = Math.max(3, Math.min(width - w - 3, sx));
    const sy = Math.max(3, Math.min(height - h - 3, y - h / 2));
    ctx.fillStyle = 'rgba(12,25,39,.94)';
    ctx.beginPath();
    ctx.roundRect(sx, sy, w, h, 4);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, sx + 6, sy + h / 2);
  }
  function failedMarker(point) {
    const [x, y] = point;
    const r = 6;
    ctx.beginPath();
    ctx.arc(x, y, r + 3, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
    stroke([[x - r, y - r], [x + r, y + r]], SILVER);
    stroke([[x - r, y + r], [x + r, y - r]], SILVER);
  }
  const powered = state.operatingSign;
  const failed = -powered;
  const failedName = failed < 0 ? 'Left' : 'Right';
  const effectiveX = nacelleX * powered + .43 * state.descendingSign;
  if (propellerView) {
    for (const side of [-1, 1]) {
      const active = side === powered;
      // Angle advances from 12 o'clock down the descending half, from behind.
      const sense = state.aircraft === 'seminole' && side > 0 ? -1 : 1;
      const cx = side * nacelleX;
      const radius = .88;
      const onDisc = (angle, r = radius) =>
        project(cx + sense * r * Math.sin(angle), hubY + r * Math.cos(angle), propZ);
      const center = project(cx, hubY, propZ);
      if (active) {
        ctx.beginPath();
        ctx.moveTo(...center);
        for (let i = 0; i <= 40; i++) ctx.lineTo(...onDisc(Math.PI * i / 40));
        ctx.closePath();
        ctx.fillStyle = 'rgba(244,185,91,.23)';
        ctx.fill();
        // Highlight the descending blade in the frozen instant.
        stroke([onDisc(1.23, .22), onDisc(1.23, .7)], GOLD, 3.4);
      } else {
        failedMarker(center);
      }
      const arc = Array.from({length: 32}, (_, i) => onDisc(-.54 + 2.73 * i / 31));
      arrow(arc, active ? GOLD : SILVER, !active);
      if (namedView) {
        const above = project(cx, hubY + 1.2, propZ);
        const below = project(cx, hubY - 1.2, propZ);
        label(active ? 'Descending blade' : failedName + ' engine out', ...above, active ? GOLD : SILVER);
        label((active ? '' : 'Normally ') + (sense > 0 ? 'CW' : 'CCW'), ...below, active ? GOLD : SILVER);
      }
    }
    return;
  }

  // Project force and distance into the plan-view plane just above the skin.
  // These are qualitative vectors; neither arrow lengths nor the CG are type data.
  const level = .77;
  const xy = (x, z) => project(x, level, z);
  const cgZ = -.23;
  const cg = xy(0, cgZ);
  const tip = xy(effectiveX, -3.42);
  stroke([xy(effectiveX, cgZ), xy(effectiveX, propZ)], GOLD, 1.7, [4, 5]);
  arrow([xy(effectiveX, propZ), tip], GOLD);
  stroke([cg, xy(effectiveX, cgZ)], TEAL, 3.35);
  for (const x of [0, effectiveX]) stroke([xy(x, cgZ - .14), xy(x, cgZ + .14)], TEAL);
  ctx.beginPath();
  ctx.arc(...cg, 4.25, 0, Math.PI * 2);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.fillStyle = TEAL;
  ctx.fill();
  ctx.stroke();

  const arcRadius = 3.68;
  const sweep = state.longArm ? .78 : .48;
  const yaw = Array.from({length: 32}, (_, i) => {
    const a = sweep * i / 31;
    return xy(failed * arcRadius * Math.sin(a), cgZ - arcRadius * Math.cos(a));
  });
  arrow(yaw, LILAC);
  const failedPoint = xy(failed * nacelleX, -1.16);
  failedMarker(failedPoint);
  if (namedView) {
    label('Thrust', tip[0] + powered * 10, tip[1] + 3, GOLD, powered > 0 ? 'left' : 'right');
    const [yawX, yawY] = yaw.at(-1);
    label('Yaw ' + failedName.toLowerCase(), yawX + failed * 10, yawY - 6, LILAC, failed < 0 ? 'right' : 'left');
    const failedLabelY = failedPoint[1] + (width < 380 ? -20 : 2);
    label(failedName + ' engine out', failedPoint[0] + failed * 12, failedLabelY, SILVER, failed < 0 ? 'right' : 'left');
    label('CG', cg[0] - powered * 7, cg[1] + 11, TEAL, powered > 0 ? 'right' : 'left');
    const [mx, my] = xy(effectiveX / 2, cgZ + .31);
    const armLabel = state.aircraft === 'seminole' ? 'Equal arm' : state.longArm ? 'Longer arm' : 'Shorter arm';
    label(armLabel, mx + powered * 9, my + 9, TEAL);
  }
}

export function createCriticalModel(container, initialState, initialView = 'overhead') {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, .1, 80);
  const renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'low-power'});
  const canvas = renderer.domElement;
  const overlay = document.createElement('canvas');
  const controller = new AbortController();
  const options = {signal: controller.signal};
  const plane = new THREE.Group();
  let state = initialState;
  let view;
  let azimuth = 0;
  let elevation = Math.PI / 2;
  let drag;
  let resizeObserver;
  let disposed = false;
  let lastWidth = 0;
  let lastHeight = 0;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);

  function dispose() {
    if (disposed) return;
    disposed = true;
    controller.abort();
    resizeObserver?.disconnect();
    const materials = new Set();
    scene.traverse(object => {
      object.geometry?.dispose();
      for (const material of [].concat(object.material || [])) materials.add(material);
    });
    materials.forEach(material => material.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    overlay.remove();
  }

  try {
    const ctx = overlay.getContext('2d');
    if (!ctx) throw new Error('The annotation layer is unavailable.');
    renderer.setPixelRatio(ratio);
    renderer.setClearColor(INK);
    canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab';
    canvas.setAttribute('role', 'img');
    overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    overlay.setAttribute('aria-hidden', 'true');
    container.append(canvas, overlay);
    scene.add(new THREE.HemisphereLight(0xf5fbff, 0x6d8c9c, 2.1));
    const sun = new THREE.DirectionalLight(0xfff3dc, 2.15);
    sun.position.set(-4, 8, -5);
    scene.add(sun, plane);
    const twin = addTwin(plane);
    const target = new THREE.Vector3();
    const activeName = () => (state.operatingSign === 1 ? 'right' : 'left');

    function render() {
      if (disposed) return;
      const width = container.clientWidth, height = container.clientHeight;
      if (!width || !height) return;
      if (width !== lastWidth || height !== lastHeight) {
        renderer.setSize(width, height, false);
        overlay.width = Math.round(width * ratio);
        overlay.height = Math.round(height * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        lastWidth = width;
        lastHeight = height;
      }
      const propellerView = view === 'propellers' || (!view && elevation < .4);
      const aspect = width / height;
      const halfHeight = view === 'propellers' ? Math.max(1.58, 2.98 / aspect) : Math.max(4.07, 4.95 / aspect);
      target.set(0, propellerView ? .03 : .28, view === 'propellers' ? propZ : -.34);
      const cos = Math.cos(elevation), sin = Math.sin(elevation);
      camera.position.set(Math.sin(azimuth) * cos, sin, Math.cos(azimuth) * cos).multiplyScalar(15).add(target);
      camera.up.set(-Math.sin(azimuth) * sin, cos, -Math.cos(azimuth) * sin);
      camera.lookAt(target);
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      ctx.clearRect(0, 0, width, height);
      drawAnnotations(ctx, camera, width, height, state, propellerView, Boolean(view));
    }

    function setState(next) {
      state = next;
      twin.setPropeller(-state.operatingSign, true, .16);
      twin.setPropeller(state.operatingSign, false, -state.descendingSign * 1.23);
      const aircraftName = state.aircraft === 'seminole' ? 'Seminole' : 'Conventional twin';
      const arm = state.aircraft === 'seminole' ? 'the same length on either side' : state.longArm ? 'longer' : 'shorter';
      canvas.setAttribute('aria-label', aircraftName + ', ' + state.failed + ' engine inoperative. The ' +
        activeName() + ' engine produces thrust. The moment arm is ' + arm +
        '. The nose tends to yaw ' + state.failed + '.');
      render();
    }
    function setView(name) {
      if (name !== 'propellers' && name !== 'overhead') return;
      view = name;
      azimuth = 0;
      elevation = name === 'propellers' ? .08 : Math.PI / 2;
      render();
    }
    canvas.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      canvas.setPointerCapture(event.pointerId);
      drag = {id: event.pointerId, x: event.clientX, y: event.clientY};
      canvas.style.cursor = 'grabbing';
    }, options);
    canvas.addEventListener('pointermove', event => {
      if (drag?.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!dx && !dy) return;
      if (view) container.dispatchEvent(new Event('critical-engine-orbit', {bubbles: true}));
      view = null;
      azimuth -= dx * .009;
      elevation = THREE.MathUtils.clamp(elevation + dy * .008, -.08, Math.PI / 2);
      drag.x = event.clientX;
      drag.y = event.clientY;
      render();
    }, options);
    const endDrag = event => {
      if (drag?.id !== event.pointerId) return;
      drag = null;
      canvas.style.cursor = 'grab';
    };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, endDrag, options);
    canvas.addEventListener('webglcontextlost', () => {
      if (!disposed) container.dispatchEvent(new Event('critical-engine-lost', {bubbles: true}));
    }, options);
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(render);
      resizeObserver.observe(container);
    } else window.addEventListener('resize', render, options);
    if (!container.clientWidth || !container.clientHeight) throw new Error('A visible model viewport is required.');
    setState(initialState);
    setView(initialView);
    return {setState, setView, dispose};
  } catch (error) {
    dispose();
    throw error;
  }
}
