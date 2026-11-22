import * as THREE from './three/three.module.min.js';
import {addTwin, mesh} from './twin-airframe.js';

// Aircraft coordinates: +x is the right wing, +y is up, and -z is forward.
const LEFT = 0xa8b7c4;
const THRUST = 0xf4b95b;
const AIRFLOW = 0x54d8df;
const BACKGROUND = 0x101e2d;
const BANK = THREE.MathUtils.degToRad(2);
const views = {
  overhead: [0, Math.PI / 2],
  rear: [0, 0],
  quarter: [0.52, 0.62]
};

function arrow(parent, start, end, color) {
  const group = new THREE.Group();
  const direction = end.clone().sub(start);
  const length = direction.length();
  const head = .39;
  const material = new THREE.MeshBasicMaterial({color});
  const shaft = mesh(group, new THREE.CylinderGeometry(.033, .033, length - head, 12), material);
  shaft.position.y = (length - head) / 2;
  const point = mesh(group, new THREE.ConeGeometry(.135, head, 16), material);
  point.position.y = length - head / 2;
  group.position.copy(start);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  parent.add(group);
}

function numberPin(parent, number, color, x, y, z) {
  const stamp = document.createElement('canvas');
  stamp.width = stamp.height = 96;
  const ctx = stamp.getContext('2d');
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.strokeStyle = '#101e2d';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(48, 48, 43, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#101e2d';
  ctx.font = 'bold 55px system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), 48, 49);
  const texture = new THREE.CanvasTexture(stamp);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({map: texture, depthTest: false, depthWrite: false, toneMapped: false});
  const pin = new THREE.Sprite(material);
  pin.renderOrder = 2;
  pin.position.set(x, y, z);
  parent.add(pin);
  return pin;
}

export function createModel(container) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, .05, 80);
  const target = new THREE.Vector3(0, .20, -.57);
  const renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'low-power'});
  const canvas = renderer.domElement;
  const events = new AbortController();
  let resizeObserver;
  let disposed = false;
  let [azimuth, elevation] = views.quarter;
  let preset = 'quarter';
  let drag;
  let lastWidth = 0;
  let lastHeight = 0;

  function dispose() {
    if (disposed) return;
    disposed = true;
    resizeObserver?.disconnect();
    events.abort();
    const geometries = new Set();
    const materials = new Set();
    scene.traverse(object => {
      if (object.geometry && !object.isSprite) geometries.add(object.geometry);
      if (object.material) {
        for (const material of [].concat(object.material)) materials.add(material);
      }
    });
    geometries.forEach(item => item.dispose());
    materials.forEach(item => { item.map?.dispose(); item.dispose(); });
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  }

  try {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(BACKGROUND);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Twin-engine airplane banked slightly right, with the left propeller feathered and the rudder deflected right. The overhead and oblique views also show right-engine thrust and the plan-view direction of relative airflow.');
    canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab;';
    container.appendChild(canvas);
    scene.add(new THREE.HemisphereLight(0xf5fbff, 0x6d8c9c, 2.1));
    const sun = new THREE.DirectionalLight(0xfff3dc, 2.15);
    sun.position.set(-4, 8, -5);
    scene.add(sun);
    const plane = new THREE.Group();
    plane.rotation.z = -BANK;
    scene.add(plane);
    const twin = addTwin(plane, {rudderDegrees: 12});
    twin.setPropeller(-1, true, .16);
    twin.setPropeller(1, false, -.82);
    // Both arrows depict their plan-view components. Keep thrust anchored at the operating propeller.
    const planVectors = new THREE.Group();
    plane.add(planVectors);
    arrow(planVectors, new THREE.Vector3(1.58, .03, -2.05), new THREE.Vector3(1.58, .03, -3.91), THRUST);
    arrow(planVectors, new THREE.Vector3(0, .08, -4.63), new THREE.Vector3(0, .08, -2.82), AIRFLOW);
    const pins = [
      numberPin(plane, 1, LEFT, -1.97, .38, -1.58),
      numberPin(planVectors, 2, THRUST, 2.23, .20, -3.12),
      numberPin(planVectors, 3, AIRFLOW, -.38, .58, -4.36)
    ];
    const referenceGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-4.66, .09, -5), new THREE.Vector3(4.66, .09, -5)
    ]);
    const reference = new THREE.Line(referenceGeo, new THREE.LineDashedMaterial({color: 0x788e9f, dashSize: .13, gapSize: .09}));
    reference.computeLineDistances();
    scene.add(reference);

    const grid = new THREE.GridHelper(14, 14, 0x293f4d, 0x223442);
    grid.position.y = -.9;
    scene.add(grid);
    const limits = [
      [-4.6, 0, -.7], [4.6, 0, -.7], [-4.6, 0, .4], [4.6, 0, .4],
      [-1.8, 1.25, 3.32], [1.8, 1.25, 3.32], [-.45, .7, -4.74], [2.05, .5, -4.05],
      [-1.9, -.85, -1.9], [1.9, -.85, -1.9]
    ].map(point => new THREE.Vector3(...point));
    const projected = new THREE.Vector3();

    function render() {
      if (disposed) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      if (width !== lastWidth || height !== lastHeight) {
        renderer.setSize(width, height, false);
        lastWidth = width;
        lastHeight = height;
      }
      const cos = Math.cos(elevation);
      camera.position.set(Math.sin(azimuth) * cos, Math.sin(elevation), Math.cos(azimuth) * cos).multiplyScalar(14).add(target);
      // An explicit up vector keeps north (the nose) at the top even at the overhead pole.
      camera.up.set(-Math.sin(azimuth) * Math.sin(elevation), cos, -Math.cos(azimuth) * Math.sin(elevation));
      camera.lookAt(target);
      camera.updateMatrixWorld();
      const aspect = width / height;
      let half = 2.15;
      for (const limit of limits) {
        projected.copy(limit).applyMatrix4(camera.matrixWorldInverse);
        half = Math.max(half, Math.abs(projected.x) / aspect, Math.abs(projected.y));
      }
      half *= 1.14;
      camera.left = -half * aspect;
      camera.right = half * aspect;
      camera.top = half;
      camera.bottom = -half;
      camera.updateProjectionMatrix();
      pins.forEach(pin => pin.scale.setScalar(23 * 2 * half / height));
      reference.visible = preset === 'rear';
      planVectors.visible = preset !== 'rear';
      grid.visible = preset !== 'rear';
      renderer.render(scene, camera);
    }

    function setView(name) {
      if (!Object.hasOwn(views, name) || disposed) return;
      preset = name;
      [azimuth, elevation] = views[name];
      render();
    }

    function endDrag(event) {
      if (drag?.id !== event.pointerId) return;
      drag = null;
      canvas.style.cursor = 'grab';
    }

    const options = {signal: events.signal};
    canvas.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      canvas.setPointerCapture(event.pointerId);
      drag = {id: event.pointerId, x: event.clientX, y: event.clientY};
      canvas.style.cursor = 'grabbing';
    }, options);
    canvas.addEventListener('pointermove', event => {
      if (drag?.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!dx && !dy) return;
      azimuth -= dx * .009;
      elevation = THREE.MathUtils.clamp(elevation + dy * .008, -.06, Math.PI / 2);
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (preset) container.dispatchEvent(new Event('sideslip-model-orbit', {bubbles: true}));
      preset = null;
      render();
    }, options);
    canvas.addEventListener('pointerup', endDrag, options);
    canvas.addEventListener('pointercancel', endDrag, options);
    canvas.addEventListener('lostpointercapture', endDrag, options);
    canvas.addEventListener('webglcontextlost', () => {
      if (!disposed) container.dispatchEvent(new Event('sideslip-model-lost', {bubbles: true}));
    }, options);
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(render);
      resizeObserver.observe(container);
    } else {
      window.addEventListener('resize', render, options);
    }
    if (!container.clientWidth || !container.clientHeight) throw new Error('The model viewport needs a visible size.');
    render();
    return {setView, dispose};
  } catch (error) {
    dispose();
    throw error;
  }
}
