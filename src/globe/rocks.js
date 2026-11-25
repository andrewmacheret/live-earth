// Asteroids, dwarf planets and comets as dots. Everything here is in AU from the Sun (J2000),
// and solarSystem.js moves the whole group into the scene, like the planets' orbit lines.
import * as THREE from 'three';
import { KIND_BY_ID, NOTABLE, orbitOf, orbitPath, positionAt } from '../space/smallBodies.js';

// solving 19,000 orbits takes a few milliseconds, so only do it a few times a second
const UPDATE_MS = 250;
const FAST_UPDATE_MS = 50;
const ORBIT_POINTS = 512;

const SIZES = { dwarf: 5, comet: 2.6, hazardous: 1.8, neo: 2, main: 2 };
// dots in each comet's tail
const TAIL_POINTS = 20;
const TAILED = new Set(['comet', 'interstellar']);

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

// A comet's tail points away from the Sun and grows as it gets closer, about 0.3 AU long at the
// Earth's distance. It's gone past about 5 AU, where the Sun is too weak to boil off any gas.
export function tailLength(r) {
  return r > 5 ? 0 : Math.min(0.8, 0.3 / (r * r)) * (1 - THREE.MathUtils.smoothstep(r, 3.5, 5));
}

const tailVertex = /* glsl */ `
  attribute float aAlong;
  attribute float aGlow;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vAlpha = aGlow * pow(1.0 - aAlong, 1.6) * 0.6;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = mix(3.2, 1.4, aAlong) * uScale * step(0.001, aGlow);
  }
`;

const tailFragment = /* glsl */ `
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(vec3(0.62, 0.82, 1.0) * (1.0 - d) * vAlpha * uOpacity, 1.0);
    #include <colorspace_fragment>
  }
`;

// Up close the dots spread apart, so each tail also gets two crossed flat wedges that fade out
// toward the end and the edges. One of the two always faces the camera enough to see.
const wedgeVertex = /* glsl */ `
  attribute float aAlong;
  attribute float aAcross;
  attribute float aGlow;
  varying float vAlong;
  varying float vAcross;
  varying float vGlow;
  void main() {
    vAlong = aAlong;
    vAcross = aAcross;
    vGlow = aGlow;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const wedgeFragment = /* glsl */ `
  uniform float uOpacity;
  varying float vAlong;
  varying float vAcross;
  varying float vGlow;
  void main() {
    // how far from the middle line to the edge, 0 to 1
    float edge = abs(vAcross) / max(vAlong, 0.001);
    float a = vGlow * pow(1.0 - vAlong, 1.4) * (1.0 - edge * edge) * 0.16;
    gl_FragColor = vec4(vec3(0.62, 0.82, 1.0) * a * uOpacity, 1.0);
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

  const baseSizes = sizes.slice();
  let hiddenKinds = new Set();

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

  // comet tails, as rows of fading dots that fan out a little
  const comets = records.flatMap((record, k) => (TAILED.has(record.kind) ? [k] : []));
  const tailPositions = new Float32Array(comets.length * TAIL_POINTS * 3);
  const along = new Float32Array(comets.length * TAIL_POINTS);
  const glow = new Float32Array(comets.length * TAIL_POINTS);
  // each dot's fixed sideways offset, so the tail looks fuzzy instead of a line
  const spread = new Float32Array(comets.length * TAIL_POINTS * 2);
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < comets.length * TAIL_POINTS; i++) {
    along[i] = (i % TAIL_POINTS) / TAIL_POINTS;
    spread[i * 2] = random();
    spread[i * 2 + 1] = random();
  }
  const tailGeometry = new THREE.BufferGeometry()
    .setAttribute('position', new THREE.BufferAttribute(tailPositions, 3))
    .setAttribute('aAlong', new THREE.BufferAttribute(along, 1))
    .setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
  const tails = new THREE.Points(
    tailGeometry,
    new THREE.ShaderMaterial({
      vertexShader: tailVertex,
      fragmentShader: tailFragment,
      uniforms: { uScale: { value: 1 }, uOpacity: { value: 0 } },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    })
  );
  tails.frustumCulled = false;

  // each wedge is a triangle from the comet to both sides of the tail's end
  const wedgePositions = new Float32Array(comets.length * 6 * 3);
  const wedgeAlong = new Float32Array(comets.length * 6);
  const wedgeAcross = new Float32Array(comets.length * 6);
  const wedgeGlow = new Float32Array(comets.length * 6);
  for (let c = 0; c < comets.length; c++) {
    wedgeAlong.set([0, 1, 1, 0, 1, 1], c * 6);
    wedgeAcross.set([0, -1, 1, 0, -1, 1], c * 6);
  }
  const wedgeGeometry = new THREE.BufferGeometry()
    .setAttribute('position', new THREE.BufferAttribute(wedgePositions, 3))
    .setAttribute('aAlong', new THREE.BufferAttribute(wedgeAlong, 1))
    .setAttribute('aAcross', new THREE.BufferAttribute(wedgeAcross, 1))
    .setAttribute('aGlow', new THREE.BufferAttribute(wedgeGlow, 1));
  const wedges = new THREE.Mesh(
    wedgeGeometry,
    new THREE.ShaderMaterial({
      vertexShader: wedgeVertex,
      fragmentShader: wedgeFragment,
      uniforms: { uOpacity: { value: 0 } },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  wedges.frustumCulled = false;

  const away = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  const placeTails = () => {
    comets.forEach((k, c) => {
      away.set(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]);
      const r = away.length();
      // before the first solve every rock sits at 0, which has no "away from the Sun"
      const length = sizes[k] && r > 0 ? tailLength(r) : 0;
      const start = c * TAIL_POINTS;
      const brightness = length > 0 ? Math.min(1, length / 0.05) : 0;
      glow.fill(brightness, start, start + TAIL_POINTS);
      wedgeGlow.fill(brightness, c * 6, c * 6 + 6);
      if (!length) return;
      away.divideScalar(r);
      side.set(-away.y, away.x, 0);
      // straight above or below the Sun, any sideways direction works
      if (side.lengthSq() < 1e-12) side.set(1, 0, 0);
      side.normalize();
      up.crossVectors(away, side);
      for (let i = 0; i < TAIL_POINTS; i++) {
        const j = start + i;
        const t = along[j] * length;
        const fan = t * 0.12;
        tailPositions[j * 3] = positions[k * 3] + away.x * t + (side.x * spread[j * 2] + up.x * spread[j * 2 + 1]) * fan;
        tailPositions[j * 3 + 1] = positions[k * 3 + 1] + away.y * t + (side.y * spread[j * 2] + up.y * spread[j * 2 + 1]) * fan;
        tailPositions[j * 3 + 2] = positions[k * 3 + 2] + away.z * t + (side.z * spread[j * 2] + up.z * spread[j * 2 + 1]) * fan;
      }
      const w = length * 0.08;
      const hx = positions[k * 3];
      const hy = positions[k * 3 + 1];
      const hz = positions[k * 3 + 2];
      const ex = hx + away.x * length;
      const ey = hy + away.y * length;
      const ez = hz + away.z * length;
      wedgePositions.set(
        [
          hx, hy, hz, ex - side.x * w, ey - side.y * w, ez - side.z * w, ex + side.x * w, ey + side.y * w, ez + side.z * w,
          hx, hy, hz, ex - up.x * w, ey - up.y * w, ez - up.z * w, ex + up.x * w, ey + up.y * w, ez + up.z * w
        ],
        c * 18
      );
    });
    tailGeometry.attributes.position.needsUpdate = true;
    tailGeometry.attributes.aGlow.needsUpdate = true;
    wedgeGeometry.attributes.position.needsUpdate = true;
    wedgeGeometry.attributes.aGlow.needsUpdate = true;
  };

  const group = new THREE.Group();
  group.add(wedges, tails, points, line);

  let solvedAt = -Infinity;
  let solvedFor = null;
  let fullFor = 0;
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
      // start the selected rock's line right at the rock, so it sits exactly on it
      if (selected >= 0) {
        const orbit = orbits[selected];
        orbitPath(orbit, jd, line.geometry.attributes.position.array, ORBIT_POINTS);
        line.geometry.attributes.position.needsUpdate = true;
      }
      // when time runs days per second, solve more often so they don't jump
      const since = performance.now() - solvedAt;
      if (since >= UPDATE_MS || (since >= FAST_UPDATE_MS && Math.abs(jd - fullFor) > 1)) {
        solvedAt = performance.now();
        fullFor = jd;
        for (let k = 0; k < count; k++) positionAt(orbits[k], jd, positions, k * 3);
      }
      solvedFor = jd;
      geometry.attributes.position.needsUpdate = true;
      placeTails();
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
      line.material.color.set(KIND_BY_ID[records[k].kind].color);
      solvedFor = null;
    },

    // hidden kinds draw at size 0 and can't be picked
    setHiddenKinds(kinds) {
      hiddenKinds = kinds;
      records.forEach((record, k) => (sizes[k] = kinds.has(record.kind) ? 0 : baseSizes[k]));
      geometry.attributes.aSize.needsUpdate = true;
      placeTails();
    },

    shown(k) {
      return !hiddenKinds.has(records[k].kind);
    },

    style(opacity, pixelRatio) {
      points.material.uniforms.uOpacity.value = opacity;
      points.material.uniforms.uScale.value = pixelRatio;
      tails.material.uniforms.uOpacity.value = opacity;
      tails.material.uniforms.uScale.value = pixelRatio;
      wedges.material.uniforms.uOpacity.value = opacity;
      group.visible = opacity > 0;
    },

    // The closest rock to (x, y) on screen within radius pixels, as { k, d2 }, or null.
    // e is the camera's view-projection matrix times the group's matrix.
    pick(x, y, e, width, height, radius) {
      let best = null;
      for (let k = 0; k < count; k++) {
        if (!sizes[k]) continue;
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
      tailGeometry.dispose();
      tails.material.dispose();
      wedgeGeometry.dispose();
      wedges.material.dispose();
    }
  };
}
