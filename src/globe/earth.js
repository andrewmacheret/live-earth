import * as THREE from 'three';
import dayUrl from './textures/earth-day.jpg';
import nightUrl from './textures/earth-night.jpg';
const earthVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const earthFragment = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform vec3 sunDirection;
  uniform vec3 uMoon;
  // the Sun's and Moon's sizes, as the angle from their middle to their edge (radians)
  const float SUN_SIZE = 0.004654;
  const float MOON_RADIUS = 0.2727;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 view = normalize(cameraPosition - vWorld);
    float sun = dot(n, sunDirection);

    // During a solar eclipse, how much of the Sun the Moon covers from here. cross() is used for the
    // angle between them because acos() isn't precise enough for such tiny angles.
    vec3 toMoon = uMoon - vWorld;
    float moonDistance = length(toMoon);
    vec3 moonDir = toMoon / moonDistance;
    float moonSize = MOON_RADIUS / moonDistance;
    float apart = dot(moonDir, sunDirection) > 0.0 ? length(cross(moonDir, sunDirection)) : 1.0;
    float covered = min(1.0, (moonSize * moonSize) / (SUN_SIZE * SUN_SIZE)) *
      (1.0 - smoothstep(abs(SUN_SIZE - moonSize), SUN_SIZE + moonSize, apart));

    // pow < 1 keeps late afternoon from looking like night. The shadow is made a bit darker than
    // real, or it's hard to see from space.
    vec3 day = texture2D(dayMap, vUv).rgb;
    vec3 color = day * (0.015 + 1.1 * pow(clamp(sun, 0.0, 1.0), 0.55) * pow(1.0 - covered, 1.8));

    // warmer light where the sun is low
    color *= mix(vec3(1.0, 0.72, 0.5), vec3(1.0), smoothstep(0.0, 0.3, sun));

    // city lights come on a little after sunset
    float lightsOn = max(1.0 - smoothstep(-0.16, 0.0, sun), smoothstep(0.85, 1.0, covered));
    color += texture2D(nightMap, vUv).rgb * vec3(1.0, 0.8, 0.55) * 2.0 * lightsOn;

    // thin blue haze at the edge, brighter on the day side
    float edge = pow(1.0 - max(dot(n, view), 0.0), 4.0);
    color += vec3(0.25, 0.55, 1.0) * edge * (0.05 + 0.5 * smoothstep(-0.25, 0.5, sun));

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

const glowVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vNormalView;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const glowFragment = /* glsl */ `
  uniform vec3 sunDirection;
  varying vec3 vNormal;
  varying vec3 vNormalView;
  void main() {
    // only the far side of this shell shows, as a ring around the Earth. Its normals point
    // more away from the camera close to the Earth's edge, so the glow fades outward
    float glow = pow(clamp(-vNormalView.z / 0.34, 0.0, 1.0), 2.5) * 0.9;
    float lit = 0.12 + 0.88 * smoothstep(-0.35, 0.4, dot(normalize(vNormal), sunDirection));
    gl_FragColor = vec4(vec3(0.3, 0.6, 1.0) * glow * lit, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createEarth() {
  const loader = new THREE.TextureLoader();
  const load = (path, srgb) => {
    const texture = loader.load(path);
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  };

  const sunDirection = { value: new THREE.Vector3(1, 0, 0) };
  const dayMap = { value: load(dayUrl, true) };
  // where the Moon is, so its shadow can fall on the Earth
  const moon = { value: new THREE.Vector3(60, 0, 0) };

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 160, 80),
    new THREE.ShaderMaterial({
      vertexShader: earthVertex,
      fragmentShader: earthFragment,
      uniforms: {
        dayMap,
        nightMap: { value: load(nightUrl, true) },
        sunDirection,
        uMoon: moon
      }
    })
  );

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(1.06, 96, 48),
    new THREE.ShaderMaterial({
      vertexShader: glowVertex,
      fragmentShader: glowFragment,
      uniforms: { sunDirection },
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    })
  );

  return {
    earth,
    glow,
    sunDirection,
    dayMap,
    setSun(direction) {
      sunDirection.value.set(...direction);
    },
    setMoon(position) {
      moon.value.copy(position);
    }
  };
}
