import * as THREE from 'three';

// Each plane flies along a great circle: position = start * cos(angle) + direction * sin(angle),
// where angle grows by aRate every second. The graphics card works that out every frame.
// When new data comes in, each plane slides from its old path to its new one over a few seconds.
const vertexShader = /* glsl */ `
  attribute vec3 aStart;
  attribute vec3 aDir;
  attribute float aRate;
  attribute float aT0;
  attribute vec3 aOldStart;
  attribute vec3 aOldDir;
  attribute float aOldRate;
  attribute float aOldT0;
  attribute float aSize;
  uniform float uTime;
  uniform float uBlend;
  uniform float uPixelRatio;
  varying float vAngle;

  vec3 fly(vec3 start, vec3 dir, float rate, float t0, out vec3 heading) {
    float a = rate * (uTime - t0);
    heading = dir * cos(a) - start * sin(a);
    return start * cos(a) + dir * sin(a);
  }

  void main() {
    vec3 oldHeading;
    vec3 newHeading;
    vec3 oldPos = fly(aOldStart, aOldDir, aOldRate, aOldT0, oldHeading);
    vec3 newPos = fly(aStart, aDir, aRate, aT0, newHeading);
    vec3 pos = normalize(mix(oldPos, newPos, uBlend)) * length(aStart);
    vec3 heading = normalize(mix(oldHeading, newHeading, uBlend));

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    // which way the nose points on screen
    vec4 ahead = projectionMatrix * modelViewMatrix * vec4(pos + heading * 0.001, 1.0);
    vec2 screen = ahead.xy / ahead.w - gl_Position.xy / gl_Position.w;
    vAngle = atan(screen.x, screen.y);
    gl_PointSize = aSize * uPixelRatio * clamp(1.2 / -mv.z, 0.7, 3.0);
  }
`;

// a little plane shape, nose up, drawn inside the point's square
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAngle;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    p.y = -p.y;
    float c = cos(vAngle);
    float s = sin(vAngle);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    float x = abs(p.x);
    float body = step(x, 0.07) * step(-0.44, p.y) * step(p.y, 0.46);
    float wings = step(x, 0.46) * step(p.y, 0.14 - 0.55 * x) * step(-0.06 - 0.55 * x, p.y);
    float tail = step(x, 0.2) * step(p.y, -0.28 - 0.5 * x) * step(-0.4 - 0.5 * x, p.y);
    float shape = max(body, max(wings, tail));
    if (shape < 0.5) discard;
    gl_FragColor = vec4(uColor * uOpacity, 1.0);
    #include <colorspace_fragment>
  }
`;

const NAMES = ['aStart', 'aDir', 'aOldStart', 'aOldDir'];

export function createPlanePoints(count) {
  const geometry = new THREE.BufferGeometry();
  // three.js needs a position attribute to know how many points to draw
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  for (const name of NAMES) geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  for (const name of ['aRate', 'aT0', 'aOldRate', 'aOldT0', 'aSize']) {
    geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(count), 1));
  }
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

  const points = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uBlend: { value: 1 },
        uPixelRatio: { value: 1 },
        uColor: { value: new THREE.Color('#ffffff') },
        uOpacity: { value: 1 }
      },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    })
  );
  points.frustumCulled = false;
  return points;
}
