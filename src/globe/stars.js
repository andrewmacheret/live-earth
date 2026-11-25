import * as THREE from 'three';
import skyUrl from '../space/sky.json?url';
import { skyVector, starColor, starLook } from '../space/sky.js';

// stars sit on a ball this big around the camera (Globe.js scales it with the zoom)
const RADIUS = 400;

const starVertex = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  uniform float uPixelRatio;
  varying vec3 vColor;
  void main() {
    vColor = color;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * uPixelRatio;
  }
`;
const starFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(vColor * (1.0 - smoothstep(0.35, 1.0, d)), 1.0);
  }
`;

export function loadSky() {
  return fetch(skyUrl).then(response => {
    if (!response.ok) throw new Error(`sky.json: ${response.status}`);
    return response.json();
  });
}

// The real stars and constellation lines. toScene turns a J2000 direction into the scene's,
// like sceneFrame(date) from bodies.js. Returns the things to draw, plus where the names go.
export function createSky(sky, toScene) {
  const direction = (ra, dec) => {
    const { x, y, z } = skyVector(ra, dec);
    return new THREE.Vector3(...toScene(x, y, z, [0, 0, 0], 0, 1)).normalize();
  };

  const count = sky.stars.length / 4;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const [ra, dec, mag, bv] = sky.stars.slice(i * 4, i * 4 + 4);
    positions.set(direction(ra, dec).multiplyScalar(RADIUS).toArray(), i * 3);
    const { size, brightness } = starLook(mag);
    colors.set(starColor(bv).map(c => c * brightness), i * 3);
    sizes[i] = size;
  }
  const geometry = new THREE.BufferGeometry()
    .setAttribute('position', new THREE.BufferAttribute(positions, 3))
    .setAttribute('color', new THREE.BufferAttribute(colors, 3))
    .setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.ShaderMaterial({
    vertexShader: starVertex,
    fragmentShader: starFragment,
    uniforms: { uPixelRatio: { value: Math.min(devicePixelRatio, 2) } },
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const points = new THREE.Points(geometry, material);

  // each stick figure line becomes pairs of points for LineSegments
  const segments = [];
  for (const figure of Object.values(sky.lines)) {
    for (const line of figure) {
      for (let k = 0; k + 3 < line.length; k += 2) {
        segments.push(
          ...direction(line[k], line[k + 1]).multiplyScalar(RADIUS).toArray(),
          ...direction(line[k + 2], line[k + 3]).multiplyScalar(RADIUS).toArray()
        );
      }
    }
  }
  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(segments, 3)),
    new THREE.LineBasicMaterial({ color: '#5b7fb5', transparent: true, opacity: 0.28, depthWrite: false })
  );

  return {
    points,
    lines,
    constellations: sky.constellations.map(([, name, ra, dec]) => ({ name, direction: direction(ra, dec) })),
    named: sky.named.map(([name, ra, dec]) => ({ name, direction: direction(ra, dec) }))
  };
}
