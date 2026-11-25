import * as THREE from 'three';
import { cloudDays, cloudUrl } from '../space/clouds.js';

// a little above the ground, so they sit on top of the map
const RADIUS = 1.004;

const cloudVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The pictures show the ground too, so a cloud is anything bright and grey that's brighter than the
// Earth's own map there. That keeps the Sahara and the ice caps from turning into clouds.
const cloudFragment = /* glsl */ `
  uniform sampler2D uNewest;
  uniform sampler2D uOlder;
  uniform sampler2D dayMap;
  uniform vec3 sunDirection;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vec3 c = texture2D(uNewest, vUv).rgb;
    // black means the satellite hasn't been over yet, so use the day before
    if (max(c.r, max(c.g, c.b)) < 0.01) c = texture2D(uOlder, vUv).rgb;
    float top = max(c.r, max(c.g, c.b));
    float grey = 1.0 - smoothstep(0.25, 0.5, (top - min(c.r, min(c.g, c.b))) / max(top, 0.001));
    vec3 weights = vec3(0.3, 0.59, 0.11);
    float lum = dot(c, weights);
    float cloud = smoothstep(0.06, 0.75, lum) * grey * smoothstep(0.02, 0.45, lum - dot(texture2D(dayMap, vUv).rgb, weights));
    float sun = dot(normalize(vNormal), sunDirection);
    float lit = smoothstep(-0.15, 0.35, sun);
    // dim and see-through at night, so city lights still show
    gl_FragColor = vec4(vec3(0.03 + 0.92 * lit), cloud * uOpacity * (0.3 + 0.55 * lit));
    #include <colorspace_fragment>
  }
`;

// sunDirection and dayMap are the Earth's uniforms from earth.js
export function createClouds({ sunDirection, dayMap }) {
  const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  blank.needsUpdate = true;
  const material = new THREE.ShaderMaterial({
    vertexShader: cloudVertex,
    fragmentShader: cloudFragment,
    uniforms: { uNewest: { value: blank }, uOlder: { value: blank }, dayMap, sunDirection, uOpacity: { value: 0 } },
    transparent: true,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 160, 80), material);
  mesh.visible = false;
  let day = null;

  return {
    mesh,
    // Downloads the pictures. Resolves to the newest day, like '2026-11-23'.
    load(now = new Date()) {
      const days = cloudDays(now);
      const loader = new THREE.TextureLoader();
      const get = d =>
        loader.loadAsync(cloudUrl(d)).then(texture => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 8;
          return texture;
        });
      return Promise.all(days.map(get)).then(([newest, older]) => {
        material.uniforms.uNewest.value = newest;
        material.uniforms.uOlder.value = older;
        day = days[0];
        return day;
      });
    },
    get day() {
      return day;
    },
    setOpacity(opacity) {
      material.uniforms.uOpacity.value = opacity;
      mesh.visible = !!day && opacity > 0.01;
    }
  };
}
