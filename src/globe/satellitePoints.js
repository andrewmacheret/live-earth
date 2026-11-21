import * as THREE from 'three';

const vertexShader = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aLit;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vLit;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // hidden satellites have size 0, and ones the worker couldn't place have aLit < 0
    float size = aLit < 0.0 ? 0.0 : aSize;
    gl_PointSize = size * uPixelRatio * clamp(4.0 / -mv.z, 0.8, 2.6);
    vColor = aColor;
    vLit = aLit;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vLit;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.05, d);
    // satellites in Earth's shadow are dim, sunlit ones shine
    float brightness = mix(0.22, 1.0, vLit);
    gl_FragColor = vec4(vColor * core * brightness, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createSatellitePoints(count) {
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  const color = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  const size = new THREE.BufferAttribute(new Float32Array(count), 1);
  const lit = new THREE.BufferAttribute(new Float32Array(count).fill(-1), 1);
  position.setUsage(THREE.DynamicDrawUsage);
  lit.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', position);
  geometry.setAttribute('aColor', color);
  geometry.setAttribute('aSize', size);
  geometry.setAttribute('aLit', lit);
  // positions change every frame, so skip three.js's bounding sphere culling
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

  const points = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uPixelRatio: { value: 1 } },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    })
  );
  points.frustumCulled = false;
  return points;
}
