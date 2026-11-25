import * as THREE from 'three';
import { HEIGHT, WIDTH } from '../space/aurora.js';

// about 110 km up, where the aurora's green glow is brightest
const RADIUS = 1 + 110 / 6371;

const auroraVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vNormalView;
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const auroraFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 sunDirection;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vNormalView;
  void main() {
    float chance = texture2D(uMap, vUv).r;
    float glow = smoothstep(0.02, 0.25, chance);
    // green at first, with red and purple on top when it's strong
    vec3 color = mix(vec3(0.2, 1.0, 0.45), vec3(0.85, 0.3, 0.75), smoothstep(0.35, 0.8, chance));
    // only shows in the dark
    float night = 1.0 - smoothstep(-0.2, 0.05, dot(normalize(vNormal), sunDirection));
    // brighter near the Earth's edge, where you look through more of it
    float edge = 0.55 + 0.6 * pow(1.0 - abs(vNormalView.z), 2.0);
    gl_FragColor = vec4(color * glow * night * edge * uOpacity, 1.0);
  }
`;

// sunDirection is the Earth's { value: Vector3 } uniform, so the aurora knows where night is
export function createAurora(sunDirection) {
  const texture = new THREE.DataTexture(new Uint8Array(WIDTH * HEIGHT), WIDTH, HEIGHT, THREE.RedFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  const material = new THREE.ShaderMaterial({
    vertexShader: auroraVertex,
    fragmentShader: auroraFragment,
    uniforms: { uMap: { value: texture }, sunDirection, uOpacity: { value: 0 } },
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 180, 90), material);
  mesh.visible = false;
  return {
    mesh,
    // grid is from auroraGrid
    update(grid) {
      texture.image.data.set(grid.data);
      texture.needsUpdate = true;
    },
    setOpacity(opacity) {
      material.uniforms.uOpacity.value = opacity;
      mesh.visible = opacity > 0.01;
    }
  };
}
