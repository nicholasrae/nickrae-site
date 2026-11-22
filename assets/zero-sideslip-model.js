import * as THREE from './three/three.module.min.js';

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

function skin(color, roughness = 0.64) {
  return new THREE.MeshStandardMaterial({color, roughness, side: THREE.DoubleSide});
}

function mesh(parent, geometry, material) {
  const part = new THREE.Mesh(geometry, material);
  parent.add(part);
  return part;
}

// Sections run nose to tail. Group the skin panels by material to keep draw calls low.
function body(parent, sections, materials, panel = () => 0) {
  const segments = 48;
  const vertices = [];
  const faces = materials.map(() => []);
  sections.forEach(([z, width, height, midY], row) => {
    for (let i = 0; i < segments; i++) {
      const angle = i * 2 * Math.PI / segments;
      vertices.push(Math.cos(angle) * width, midY + Math.sin(angle) * height, z);
      if (row === sections.length - 1) continue;
      const a = row * segments + i;
      const b = row * segments + (i + 1) % segments;
      const indices = faces[panel((sections[row + 1][0] + z) / 2, angle + Math.PI / segments)];
      indices.push(a, b, a + segments, b, b + segments, a + segments);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  let offset = 0;
  faces.forEach((indices, index) => {
    if (indices.length) geometry.addGroup(offset, indices.length, index);
    offset += indices.length;
  });
  geometry.setIndex(faces.flat());
  geometry.computeVertexNormals();
  return mesh(parent, geometry, materials);
}

const foil = [[0, 0], [.10, .065], [.33, .085], [.67, .045], [1, 0], [.7, -.017], [.23, -.026]];

function wing(parent, side, stations, paint, trim) {
  const points = [];
  const faces = [];
  const geo = new THREE.BufferGeometry();
  stations.forEach(([span, leading, chord, y], station) => {
    foil.forEach(([position, camber], i) => {
      points.push(span * side, y + camber * chord, leading + position * chord);
      if (station === stations.length - 1) return;
      const a = station * foil.length + i;
      const b = station * foil.length + (i + 1) % foil.length;
      const c = a + foil.length;
      const d = b + foil.length;
      faces.push(...(side > 0 ? [a, b, c, b, d, c] : [a, c, b, b, c, d]));
    });
  });
  const tip = (stations.length - 2) * foil.length * 6;
  const tipRing = (stations.length - 1) * foil.length;
  for (let i = 1; i < foil.length - 1; i++) {
    faces.push(...(side > 0 ? [tipRing, tipRing + i, tipRing + i + 1] : [tipRing, tipRing + i + 1, tipRing + i]));
  }
  geo.addGroup(0, tip, 0);
  geo.addGroup(tip, faces.length - tip, 1);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geo.setIndex(faces);
  geo.computeVertexNormals();
  mesh(parent, geo, [paint, trim]);
}

function fin(parent, outline, width, paint) {
  const shape = new THREE.Shape();
  outline.forEach(([z, y], i) => i ? shape.lineTo(z, y) : shape.moveTo(z, y));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {depth: width, bevelEnabled: false});
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2, 0, 0);
  mesh(parent, geo, paint);
}

function addTwin(plane) {
  const ivory = skin(0xe3ebea);
  const blue = skin(0x375978);
  const glass = skin(0x274454, .25);
  const prop = skin(0x6b7c88);
  const hinge = new THREE.LineBasicMaterial({color: 0x788991});
  body(plane, [
    [-2.63, .02, .02, -.015], [-2.49, .24, .18, 0], [-2.08, .38, .28, .04],
    [-1.49, .45, .35, .07], [-.81, .51, .52, .13], [-.74, .51, .53, .13],
    [-.18, .51, .53, .13], [-.10, .51, .53, .13], [.48, .48, .49, .13],
    [.58, .47, .47, .13], [1.22, .39, .35, .14], [2.18, .23, .22, .20],
    [3.16, .05, .09, .28], [3.32, .01, .015, .3]
  ], [ivory, glass, blue], (z, angle) => {
    const elevation = Math.sin(angle);
    const windshield = z > -1.49 && z < -.81 && elevation > .15 && Math.abs(Math.cos(angle)) > .10;
    const sideWindow = ((z > -.74 && z < -.18) || (z > -.10 && z < .48)) && elevation > .14 && elevation < .80;
    if (windshield || sideWindow) return 1;
    return elevation < -.05 && elevation > -.39 ? 2 : 0;
  });
  const nacelle = [
    [-1.83, .17, .20, .03], [-1.68, .28, .28, .03], [-1.40, .32, .32, .02],
    [-.66, .32, .31, .015], [.10, .26, .25, 0], [.77, .12, .13, .01], [1.0, .012, .02, .03]
  ];
  for (const side of [-1, 1]) {
    wing(plane, side, [
      [.23, -1.07, 1.75, -.16], [1.65, -.98, 1.54, -.10], [3.68, -.72, 1.10, .045],
      [4.07, -.64, .98, .08], [4.26, -.49, .65, .10], [4.34, -.33, .19, .11]
    ], ivory, blue);
    const hingePoints = [
      [1.95, -.015, .19], [3.68, .09, .10], [4.01, .12, .095], [4.01, .088, .34]
    ].map(([x, y, z]) => new THREE.Vector3(side * x, y, z));
    plane.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(hingePoints), hinge));
    wing(plane, side, [
      [.015, 1.92, 1.05, 1.10], [1.15, 2.24, .73, 1.10], [1.57, 2.37, .59, 1.10], [1.65, 2.46, .39, 1.10]
    ], ivory, blue);
    const engine = new THREE.Group();
    engine.position.x = side * 1.58;
    plane.add(engine);
    body(engine, nacelle, [ivory, blue], (z, a) => Math.sin(a) < -.18 ? 1 : 0);
    const blades = new THREE.Group();
    engine.add(blades);
    blades.position.set(0, .03, -1.85);
    blades.rotation.z = side < 0 ? .16 : -.82;
    // The feathered blade presents its thin edge to airflow from the nose.
    for (const direction of [-1, 1]) {
      const blade = mesh(blades, new THREE.SphereGeometry(1, 12, 10), prop);
      blade.scale.set(side < 0 ? .022 : .075, .38, side < 0 ? .089 : .043);
      blade.position.y = direction * .36;
    }
    const spinner = mesh(engine, new THREE.SphereGeometry(1, 18, 12), blue);
    spinner.position.set(0, .03, -1.83);
    spinner.scale.set(.15, .15, .27);
  }
  fin(plane, [[1.54, .23], [2.06, .51], [2.47, 1.13], [2.97, 1.16], [2.98, 1.02], [2.68, 1.02], [2.68, .25]], .085, ivory);
  fin(plane, [[2.39, 1.015], [2.47, 1.13], [2.97, 1.16], [2.98, 1.05]], .092, blue);
  // Right rudder: the trailing edge moves to aircraft right around the fixed hinge.
  const rudder = new THREE.Group();
  rudder.position.z = 2.68;
  rudder.rotation.y = THREE.MathUtils.degToRad(12); // Illustrative deflection.
  plane.add(rudder);
  fin(rudder, [[.009, .29], [.009, 1.01], [.30, 1.01], [.48, .30]], .064, skin(0xb3c6cb));
}

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
    addTwin(plane);
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
