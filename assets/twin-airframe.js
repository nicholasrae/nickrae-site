import * as THREE from './three/three.module.min.js';

// Aircraft axes: +x right, +y up, -z forward.
function skin(color, roughness = 0.64) {
  return new THREE.MeshStandardMaterial({color, roughness, side: THREE.DoubleSide});
}

export function mesh(parent, geometry, material) {
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

export function addTwin(plane, {rudderDegrees = 0} = {}) {
  const propellers = new Map();
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
    propellers.set(side, blades);
    for (const direction of [-1, 1]) {
      const blade = mesh(blades, new THREE.SphereGeometry(1, 12, 10), prop);
      blade.position.y = direction * .36;
    }
    const spinner = mesh(engine, new THREE.SphereGeometry(1, 18, 12), blue);
    spinner.position.set(0, .03, -1.83);
    spinner.scale.set(.15, .15, .27);
  }
  fin(plane, [[1.54, .23], [2.06, .51], [2.47, 1.13], [2.97, 1.16], [2.98, 1.02], [2.68, 1.02], [2.68, .25]], .085, ivory);
  fin(plane, [[2.39, 1.015], [2.47, 1.13], [2.97, 1.16], [2.98, 1.05]], .092, blue);
  // Positive deflection moves the trailing edge toward the right wing.
  const rudder = new THREE.Group();
  rudder.position.z = 2.68;
  rudder.rotation.y = THREE.MathUtils.degToRad(rudderDegrees);
  plane.add(rudder);
  fin(rudder, [[.009, .29], [.009, 1.01], [.30, 1.01], [.48, .30]], .064, skin(0xb3c6cb));

  return {
    setPropeller(side, feathered, clockAngle) {
      const blades = propellers.get(side);
      blades.rotation.z = clockAngle;
      // A feathered blade presents its thin edge to airflow from the nose.
      for (const blade of blades.children) {
        blade.scale.set(feathered ? .022 : .075, .38, feathered ? .089 : .043);
      }
    }
  };
}
