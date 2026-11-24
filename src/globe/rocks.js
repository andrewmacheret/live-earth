// Asteroids, dwarf planets and comets as dots. Everything here is in AU from the Sun (J2000),
// and solarSystem.js moves the whole group into the scene, like the planets' orbit lines.
import * as THREE from 'three';
import { KIND_BY_ID, NOTABLE, orbitOf, pointAt, positionAt } from '../space/smallBodies.js';

// solving 19,000 orbits takes a few milliseconds, so only do it a few times a second
const UPDATE_MS = 250;
const ORBIT_POINTS = 512;

const SIZES = { dwarf: 5, comet: 2.6, hazardous: 1.8, neo: 2, main: 2 };

const vertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uScale;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale;
  }
`;

const fragment = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(vColor * smoothstep(1.0, 0.4, d) * uOpacity, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createRocks(records) {
  const count = records.length;
  const orbits = records.map(orbitOf);
  const index = new Map(records.map((record, k) => [record.pdes, k]));
  const notable = records.flatMap((record, k) => (NOTABLE[record.pdes] ? [k] : []));

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const color = new THREE.Color();
  records.forEach((record, k) => {
    color.set(KIND_BY_ID[record.kind].color);
    // the hazardous ones crowd around the Earth, so tone them down to let the main belt show
    if (record.kind === 'hazardous') color.multiplyScalar(0.7);
    color.toArray(colors, k * 3);
    sizes[k] = NOTABLE[record.pdes] ? Math.max(3.5, SIZES[record.kind] ?? 0) : (SIZES[record.kind] ?? 1.6);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const points = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uScale: { value: 1 }, uOpacity: { value: 0 } },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    })
  );
  points.frustumCulled = false;

  // the selected rock's path around the Sun
  const line = new THREE.Line(
    new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array((ORBIT_POINTS + 1) * 3), 3)
    ),
    new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  line.frustumCulled = false;
  line.visible = false;

  const group = new THREE.Group();
  group.add(points, line);

  let solvedAt = -Infinity;
  let solvedFor = null;
  let selected = -1;

  return {
    group,
    records,
    index,
    notable,

    get selected() {
      return selected;
    },

    // Move every rock to where it is on this Julian day
    update(jd) {
      if (jd === solvedFor) return;
      // the selected and labeled rocks move every frame, so following them stays smooth
      for (const k of selected >= 0 ? [selected, ...notable] : notable) positionAt(orbits[k], jd, positions, k * 3);
      if (performance.now() - solvedAt >= UPDATE_MS) {
        solvedAt = performance.now();
        for (let k = 0; k < count; k++) positionAt(orbits[k], jd, positions, k * 3);
      }
      solvedFor = jd;
      geometry.attributes.position.needsUpdate = true;
    },

    // where rock k is, in AU from the Sun
    at(k, out) {
      return out.set(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]);
    },

    orbit(k) {
      return orbits[k];
    },

    select(k) {
      selected = k;
      line.visible = k >= 0;
      if (k < 0) return;
      const array = line.geometry.attributes.position.array;
      for (let j = 0; j <= ORBIT_POINTS; j++) pointAt(orbits[k], (j / ORBIT_POINTS) * 2 * Math.PI, array, j * 3);
      line.geometry.attributes.position.needsUpdate = true;
      line.material.color.set(KIND_BY_ID[records[k].kind].color);
      solvedFor = null;
    },

    style(opacity, pixelRatio) {
      points.material.uniforms.uOpacity.value = opacity;
      points.material.uniforms.uScale.value = pixelRatio;
      group.visible = opacity > 0;
    },

    // The closest rock to (x, y) on screen within radius pixels, as { k, d2 }, or null.
    // e is the camera's view-projection matrix times the group's matrix.
    pick(x, y, e, width, height, radius) {
      let best = null;
      for (let k = 0; k < count; k++) {
        const px = positions[k * 3];
        const py = positions[k * 3 + 1];
        const pz = positions[k * 3 + 2];
        const w = e[3] * px + e[7] * py + e[11] * pz + e[15];
        if (w <= 0) continue;
        const sx = ((e[0] * px + e[4] * py + e[8] * pz + e[12]) / w + 1) * 0.5 * width;
        const sy = (1 - (e[1] * px + e[5] * py + e[9] * pz + e[13]) / w) * 0.5 * height;
        const d2 = (sx - x) ** 2 + (sy - y) ** 2;
        // a famous rock wins over an unnamed one right next to it
        const score = NOTABLE[records[k].pdes] ? d2 * 0.5 : d2;
        if (d2 < radius * radius && (!best || score < best.score)) best = { k, d2, score };
      }
      return best;
    },

    dispose() {
      geometry.dispose();
      points.material.dispose();
      line.geometry.dispose();
      line.material.dispose();
    }
  };
}
