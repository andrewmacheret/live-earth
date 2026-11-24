import * as THREE from 'three';
import { BODIES, geocentric, sceneFrame, spinAxis } from '../space/bodies.js';
import { behindEarth, EARTH_RADIUS_KM } from '../sats/frames.js';

const TEXTURES = import.meta.glob('../space/textures/*', { eager: true, query: '?url', import: 'default' });
const MOON_ORBIT_POINTS = 256;
const MOON_ORBIT_DAYS = 27.32;
const DAY_MS = 86400000;
// labels are skipped when they would cover a label for a body that matters more
const LABEL_ORDER = ['sun', 'earth', 'moon'];

// Positions use the camera's view (modelViewMatrix), not world coordinates, because far-away
// planets have huge world coordinates that the graphics card can't hold precisely.
const surfaceVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewPosition;
  void main() {
    vUv = uv;
    vNormalView = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const surfaceFragment = /* glsl */ `
  uniform sampler2D map;
  uniform float uHasMap;
  uniform vec3 uColor;
  uniform vec3 uSunView;
  uniform float uEmissive;
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewPosition;
  void main() {
    vec3 base = uHasMap > 0.5 ? texture2D(map, vUv).rgb : uColor;
    vec3 n = normalize(vNormalView);
    vec3 color;
    if (uEmissive > 0.5) {
      // the Sun's edge looks darker than its middle
      float facing = max(dot(n, normalize(-vViewPosition)), 0.0);
      color = base * 1.35 * (0.45 + 0.55 * pow(facing, 0.5));
    } else {
      float sun = dot(n, uSunView);
      color = base * (0.012 + 1.05 * pow(clamp(sun, 0.0, 1.0), 0.7));
    }
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

// a dot that keeps a body visible when it's too small to see, or the Sun's glow
const dotVertex = /* glsl */ `
  uniform float uSize;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    gl_PointSize = uSize;
  }
`;

const dotFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uGlow;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = uGlow > 0.5 ? pow(1.0 - d, 2.2) : smoothstep(1.0, 0.55, d);
    gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
    #include <colorspace_fragment>
  }
`;

const dotGeometry = new THREE.BufferGeometry().setAttribute(
  'position',
  new THREE.BufferAttribute(new Float32Array(3), 3)
);

function surface(body, radius) {
  const material = new THREE.ShaderMaterial({
    vertexShader: surfaceVertex,
    fragmentShader: surfaceFragment,
    uniforms: {
      map: { value: null },
      uHasMap: { value: 0 },
      uColor: { value: new THREE.Color(body.color) },
      uSunView: { value: new THREE.Vector3(0, 0, 1) },
      uEmissive: { value: body.id === 'sun' ? 1 : 0 }
    }
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), material);
}

function dot(body) {
  const points = new THREE.Points(
    dotGeometry,
    new THREE.ShaderMaterial({
      vertexShader: dotVertex,
      fragmentShader: dotFragment,
      uniforms: {
        uSize: { value: 0 },
        uColor: { value: new THREE.Color(body.color) },
        uOpacity: { value: 1 },
        uGlow: { value: body.id === 'sun' ? 1 : 0 }
      },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    })
  );
  points.frustumCulled = false;
  return points;
}

// Turn a body's map so its north pole and prime meridian point the right way. Sphere maps put
// longitude 0 on +x and the north pole on +y, the same as the Earth's globe.
function orient(mesh, id, date, frame) {
  const { north, spin } = spinAxis(id, date);
  // where the body's equator crosses the J2000 equator, then turned by spin to the prime meridian
  const node = new THREE.Vector3(-north.y, north.x, 0).normalize();
  const pole = new THREE.Vector3(north.x, north.y, north.z);
  const w = THREE.MathUtils.degToRad(spin % 360);
  const meridian = node.clone().multiplyScalar(Math.cos(w)).add(pole.clone().cross(node).multiplyScalar(Math.sin(w)));
  const x = new THREE.Vector3(...frame(meridian.x, meridian.y, meridian.z, [0, 0, 0], 0, 1));
  const y = new THREE.Vector3(...frame(pole.x, pole.y, pole.z, [0, 0, 0], 0, 1));
  const z = x.clone().cross(y);
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export function createSolarSystem(container, { onPick }) {
  const group = new THREE.Group();
  const loader = new THREE.TextureLoader();
  const labelLayer = document.createElement('div');
  labelLayer.className = 'body-labels';
  container.appendChild(labelLayer);

  const items = BODIES.map(body => {
    const holder = new THREE.Group();
    const radius = body.radiusKm / EARTH_RADIUS_KM;
    // the Earth's globe is drawn by earth.js
    const mesh = body.id === 'earth' ? null : surface(body, radius);
    if (mesh) holder.add(mesh);
    const glow = dot(body);
    holder.add(glow);
    group.add(holder);
    const label = document.createElement('button');
    label.className = 'body-label';
    label.textContent = body.name;
    label.style.color = body.color;
    label.hidden = true;
    label.addEventListener('click', () => onPick?.(body.id));
    labelLayer.appendChild(label);
    return { body, holder, mesh, glow, label, radius, screenPx: 0, textureRequested: false };
  });
  const byId = Object.fromEntries(items.map(item => [item.body.id, item]));

  const moonOrbit = new THREE.Line(
    new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array((MOON_ORBIT_POINTS + 1) * 3), 3)
    ),
    new THREE.LineBasicMaterial({
      color: byId.moon.body.color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  moonOrbit.frustumCulled = false;
  group.add(moonOrbit);
  let moonOrbitTime = null;

  function drawMoonOrbit(now) {
    const array = moonOrbit.geometry.attributes.position.array;
    const frame = sceneFrame(new Date(now));
    for (let k = 0; k <= MOON_ORBIT_POINTS; k++) {
      const date = new Date(now + (k / MOON_ORBIT_POINTS) * MOON_ORBIT_DAYS * DAY_MS);
      const p = geocentric(date).moon;
      frame(p.x, p.y, p.z, array, k * 3);
    }
    moonOrbit.geometry.attributes.position.needsUpdate = true;
  }

  const loadTexture = item => {
    item.textureRequested = true;
    const url = TEXTURES[`../space/textures/${item.body.texture}`];
    if (!url) return;
    loader.load(url, texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      item.mesh.material.uniforms.map.value = texture;
      item.mesh.material.uniforms.uHasMap.value = 1;
    });
  };

  let positions = null;
  const point = new THREE.Vector3();
  const sunView = new THREE.Vector3();

  return {
    group,

    positionOf(id, out) {
      return out.copy(byId[id].holder.position);
    },

    radiusOf(id) {
      return byId[id].radius;
    },

    // how wide the body looks on screen, in pixels
    screenPxOf(id) {
      return byId[id].screenPx;
    },

    // the latest positions from Astronomy Engine, in AU from the Earth
    positions() {
      return positions;
    },

    // Move everything to where it is at this time. Runs before the camera moves.
    place(now) {
      const date = new Date(now);
      const frame = sceneFrame(date);
      positions = geocentric(date);
      const v = [0, 0, 0];
      for (const item of items) {
        const p = positions[item.body.id];
        item.holder.position.set(...frame(p.x, p.y, p.z, v));
        if (item.mesh && item.mesh.visible) orient(item.mesh, item.body.id, date, frame);
      }
      // the Moon's orbit drifts a little each day, so redraw it every few hours
      if (moonOrbitTime == null || Math.abs(now - moonOrbitTime) > DAY_MS / 4) {
        moonOrbitTime = now;
        drawMoonOrbit(now);
      }
    },

    // Size the dots, light the surfaces and place the labels for this camera. Runs right before drawing.
    view(camera, width, height, pixelRatio) {
      camera.updateMatrixWorld();
      const focal = height / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const sun = byId.sun.holder.position;
      const earthDistance = camera.position.length();

      for (const item of items) {
        const { body, holder, mesh, glow } = item;
        const distance = camera.position.distanceTo(holder.position);
        item.screenPx = ((2 * item.radius) / distance) * focal;
        const uniforms = glow.material.uniforms;
        if (body.id === 'sun') {
          uniforms.uSize.value = Math.min(512, Math.max(item.screenPx * 4, 36)) * pixelRatio;
          uniforms.uOpacity.value = 1 - THREE.MathUtils.smoothstep(item.screenPx, 120, 400);
        } else {
          uniforms.uSize.value = body.dot * pixelRatio;
          uniforms.uOpacity.value = 1 - THREE.MathUtils.smoothstep(item.screenPx, body.dot * 0.6, body.dot * 1.6);
        }
        if (mesh) {
          mesh.visible = item.screenPx > 0.5;
          if (mesh.visible && !item.textureRequested && item.screenPx > 4) loadTexture(item);
          if (body.id !== 'sun') {
            sunView.subVectors(sun, holder.position).transformDirection(camera.matrixWorldInverse);
            mesh.material.uniforms.uSunView.value.copy(sunView);
          }
        }
      }

      // the Moon's orbit shows once you zoom out past the satellites
      moonOrbit.material.opacity = 0.35 * THREE.MathUtils.smoothstep(earthDistance, 8, 30);

      const placed = [];
      for (const id of LABEL_ORDER) {
        const item = byId[id];
        const { label, holder } = item;
        point.copy(holder.position).applyMatrix4(camera.matrixWorldInverse);
        let show = point.z < 0 && item.screenPx < 0.3 * Math.min(width, height);
        if (show && id === 'earth') show = earthDistance > 40;
        if (show && id !== 'earth') show = !behindEarth(camera.position, holder.position);
        let x = 0;
        let y = 0;
        if (show) {
          point.copy(holder.position).project(camera);
          x = (point.x + 1) * 0.5 * width + Math.max(3, item.screenPx / 2) + 4;
          y = (1 - point.y) * 0.5 * height - 9;
          const box = { left: x, right: x + label.textContent.length * 7 + 10, top: y, bottom: y + 18 };
          show = !placed.some(o => box.left < o.right && box.right > o.left && box.top < o.bottom && box.bottom > o.top);
          if (show) placed.push(box);
        }
        if (label.hidden === show) label.hidden = !show;
        if (show) label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      }
    },

    // Bodies under the pointer can be picked like satellites. Returns screen spots for each body.
    spots(camera, width, height) {
      const out = [];
      const earthDistance = camera.position.length();
      for (const item of items) {
        if (item.body.id === 'earth' && earthDistance < 40) continue;
        point.copy(item.holder.position).applyMatrix4(camera.matrixWorldInverse);
        if (point.z >= 0) continue;
        point.copy(item.holder.position).project(camera);
        out.push({
          id: item.body.id,
          x: (point.x + 1) * 0.5 * width,
          y: (1 - point.y) * 0.5 * height,
          radiusPx: item.screenPx / 2,
          position: item.holder.position
        });
      }
      return out;
    },

    dispose() {
      labelLayer.remove();
    }
  };
}
