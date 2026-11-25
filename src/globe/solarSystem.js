import * as THREE from 'three';
import { AU, BODIES, geocentric, KM_PER_AU, lagrangePoints, planetOrbit, PLANETS, sceneFrame, spinAxis } from '../space/bodies.js';
import {
  distanceRange,
  ellipsePath,
  jplLink,
  julianDay,
  KIND_BY_ID,
  KINDS,
  NOTABLE,
  periodDays,
  positionAt,
  sizeFromH
} from '../space/smallBodies.js';
import { CHARON_PULL, moonOffset, moonPath, moonPeriod } from '../space/moons.js';
import { nextPeak, PARENT_BY_ID, PARENTS, peakLabel, SHOWER_BY_ID, SHOWERS, showerSpot, streamPoints } from '../space/meteors.js';
import { CRAFT_COLOR, craftPath, craftPosition, craftSpeed } from '../space/spacecraft.js';
import { behindEarth, EARTH_RADIUS_KM } from '../sats/frames.js';
import { createRocks } from './rocks.js';

const TEXTURES = import.meta.glob('../space/textures/*', { eager: true, query: '?url', import: 'default' });
const MOON_ORBIT_POINTS = 256;
const MOON_ORBIT_DAYS = 27.32;
const PLANET_ORBIT_POINTS = 360;
const MOON_PATH_POINTS = 128;
const DAY_MS = 86400000;
// labels are skipped when they would cover a label for a body that matters more
const LABEL_ORDER = ['sun', 'earth', ...BODIES.map(body => body.id).filter(id => id !== 'sun' && id !== 'earth')];

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
  uniform float uShadow;
  uniform vec3 uEarthView;
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
      float light = pow(clamp(sun, 0.0, 1.0), 0.7);
      color = base * (0.012 + 1.05 * light);
      if (uShadow > 0.5) {
        // The Earth's shadow on the Moon during a lunar eclipse. The dark middle (umbra) shrinks and the
        // soft edge (penumbra) grows by the Sun's size with distance behind the Earth. The Earth's air
        // makes it a bit wider, and bends red sunset light into the middle.
        vec3 toEarth = uEarthView - vViewPosition;
        float behind = dot(toEarth, uSunView);
        float off = length(toEarth - behind * uSunView);
        float umbra = 1.02 - behind * 0.004654;
        float penumbra = 1.02 + behind * 0.004654;
        float shade = behind > 0.0 ? smoothstep(umbra - 0.04, penumbra, off) : 1.0;
        color = base * (0.012 + 1.05 * light * shade) + base * vec3(0.2, 0.05, 0.015) * light * (1.0 - smoothstep(umbra - 0.04, umbra + 0.04, off)) * step(0.0, behind);
      }
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

// rings, lit from the side the Sun is on
const ringFragment = /* glsl */ `
  uniform sampler2D map;
  uniform float uHasMap;
  uniform vec3 uColor;
  uniform vec3 uSunView;
  varying vec2 vUv;
  varying vec3 vNormalView;
  void main() {
    vec4 ring = uHasMap > 0.5 ? texture2D(map, vUv) : vec4(uColor, 0.5);
    float light = 0.25 + 0.75 * abs(dot(normalize(vNormalView), uSunView));
    gl_FragColor = vec4(ring.rgb * light, ring.a);
    #include <colorspace_fragment>
  }
`;

// The heliosphere's edges glow where you look along them, like a soap bubble
const bubbleVertex = /* glsl */ `
  varying vec3 vNormalView;
  varying vec3 vView;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vView = view.xyz;
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * view;
  }
`;
const bubbleFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vNormalView;
  varying vec3 vView;
  void main() {
    float edge = 1.0 - abs(dot(normalize(vNormalView), normalize(-vView)));
    gl_FragColor = vec4(uColor * (0.01 + pow(edge, 5.0) * 0.3) * uOpacity, 1.0);
  }
`;

// The Sun's wind blows a bubble in the gas between the stars. The termination shock is where the wind
// slows down, and the heliopause is where the bubble ends. Both are squashed on the side the
// interstellar wind comes from (the nose) and stretched into a tail behind. Sizes are in AU, roughly
// where the Voyagers crossed them.
const NOSE_LONGITUDE = 255.4;
const NOSE_LATITUDE = 5.2;
const HELIOSPHERE = [
  { name: 'Termination shock', noseAu: 85, stretch: 0.3, color: '#6fa8ff' },
  { name: 'Heliopause', noseAu: 115, stretch: 0.5, color: '#9b8cff' }
];

// the direction the nose points, in J2000 equator coordinates
function noseDirection() {
  const lon = THREE.MathUtils.degToRad(NOSE_LONGITUDE);
  const lat = THREE.MathUtils.degToRad(NOSE_LATITUDE);
  const tilt = THREE.MathUtils.degToRad(23.4392911);
  const [x, y, z] = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  return new THREE.Vector3(x, y * Math.cos(tilt) - z * Math.sin(tilt), y * Math.sin(tilt) + z * Math.cos(tilt));
}

// a sphere pushed out more the farther each point is from the nose
function bubble({ noseAu, stretch, color }, nose) {
  const geometry = new THREE.SphereGeometry(1, 96, 48);
  const position = geometry.attributes.position;
  const d = new THREE.Vector3();
  for (let k = 0; k < position.count; k++) {
    d.fromBufferAttribute(position, k);
    d.multiplyScalar(noseAu * (1 + stretch * (1 - d.dot(nose))));
    position.setXYZ(k, d.x, d.y, d.z);
  }
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      vertexShader: bubbleVertex,
      fragmentShader: bubbleFragment,
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 } },
      side: THREE.DoubleSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  mesh.frustumCulled = false;
  return mesh;
}

// meteor stream dust: tiny round dots in each parent's color
// stream is which parent each dot belongs to. A picked stream gets brighter and the rest dim.
const streamVertex = /* glsl */ `
  attribute vec3 color;
  attribute float stream;
  uniform float uSize;
  uniform float uSelected;
  varying vec3 vColor;
  varying float vBoost;
  void main() {
    vColor = color;
    vBoost = uSelected < 0.0 ? 1.0 : abs(stream - uSelected) < 0.5 ? 2.5 : 0.3;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (vBoost > 1.0 ? 2.0 : 1.0);
  }
`;
const streamFragment = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vBoost;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(vColor * (1.0 - d) * uOpacity * vBoost, 1.0);
  }
`;
const STREAM_POINTS = 900;

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
      uEmissive: { value: body.id === 'sun' ? 1 : 0 },
      // only the Moon gets the Earth's shadow
      uShadow: { value: body.id === 'moon' ? 1 : 0 },
      uEarthView: { value: new THREE.Vector3() }
    }
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), material);
  if (body.rings) mesh.add(rings(body));
  return mesh;
}

// A ring map drawn from a list of [startKm, endKm, opacity] bands, for the planets with no ring picture.
// Some rings are only a few km wide, thinner than one pixel of the map, so they still get some opacity.
function bandMap({ innerKm, outerKm, color, bands }) {
  const width = 1024;
  const data = new Uint8Array(width * 4);
  const rgb = new THREE.Color(color);
  const pixelKm = (outerKm - innerKm) / width;
  for (let i = 0; i < width; i++) {
    const from = innerKm + i * pixelKm;
    let alpha = 0;
    for (const [start, end, opacity] of bands) {
      const overlap = Math.min(end, from + pixelKm) - Math.max(start, from);
      if (overlap > 0) alpha = Math.max(alpha, opacity * Math.min(1, 0.5 + overlap / pixelKm));
    }
    data.set([rgb.r * 255, rgb.g * 255, rgb.b * 255, alpha * 255], i * 4);
  }
  const texture = new THREE.DataTexture(data, width, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// a flat ring around the equator. The ring map runs from the inner edge to the outer one.
function rings(body) {
  const inner = body.rings.innerKm / EARTH_RADIUS_KM;
  const outer = body.rings.outerKm / EARTH_RADIUS_KM;
  const geometry = new THREE.RingGeometry(inner, outer, 128, 1);
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i++) {
    const r = Math.hypot(position.getX(i), position.getY(i));
    uv.setXY(i, (r - inner) / (outer - inner), 0.5);
  }
  const ring = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      vertexShader: surfaceVertex,
      fragmentShader: ringFragment,
      uniforms: {
        map: { value: null },
        uHasMap: { value: 0 },
        uColor: { value: new THREE.Color(body.color) },
        uSunView: { value: new THREE.Vector3(0, 0, 1) }
      },
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false
    })
  );
  if (body.rings.bands) {
    ring.material.uniforms.map.value = bandMap(body.rings);
    ring.material.uniforms.uHasMap.value = 1;
  }
  // RingGeometry lies flat in x and y, but the equator is x and z
  ring.rotation.x = -Math.PI / 2;
  return ring;
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

// true if a moon measured in J2000 goes around the opposite way its planet spins
function againstSpin(moon, date) {
  const { north } = spinAxis(moon.planet, date);
  const i = THREE.MathUtils.degToRad(moon.i);
  const node = THREE.MathUtils.degToRad(moon.node);
  // the orbit's own north, straight up from the plane it goes around in
  const up = [Math.sin(i) * Math.sin(node), -Math.sin(i) * Math.cos(node), Math.cos(i)];
  return up[0] * north.x + up[1] * north.y + up[2] * north.z < 0;
}

export function createSolarSystem(container, { onPick }) {
  const group = new THREE.Group();
  const loader = new THREE.TextureLoader();
  const labelLayer = document.createElement('div');
  labelLayer.className = 'body-labels';
  container.appendChild(labelLayer);

  const makeItem = body => {
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
    const ring = mesh?.children[0] ?? null;
    return { body, holder, mesh, ring, glow, label, radius, screenPx: 0, textureRequested: false };
  };
  const items = BODIES.map(makeItem);
  const byId = Object.fromEntries(items.map(item => [item.body.id, item]));
  const labelOrder = [...LABEL_ORDER];
  // bodies that keep their names even from close to the Earth, like the picked one
  let featured = new Set();

  // Moons of the other planets, once they've loaded. They're bodies like the planets, with ids like 'moon:io'.
  // Each planet's moons are placed and drawn in a group turned to that planet's equator, in km.
  let moonSystems = [];
  let moonsShown = true;

  // Planet orbits and the asteroids are drawn around the Sun in AU, then this group moves, turns and
  // scales them into the scene. Small numbers like AU keep them sharp on the graphics card.
  const orbits = new THREE.Group();
  orbits.matrixAutoUpdate = false;
  group.add(orbits);
  const orbitLines = PLANETS.map(body => {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array((PLANET_ORBIT_POINTS + 1) * 3), 3)
      ),
      new THREE.LineBasicMaterial({
        color: body.color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    line.frustumCulled = false;
    orbits.add(line);
    return { body, line };
  });
  let orbitsTime = null;

  // asteroids and comets, once they've loaded
  let rocks = null;
  let rocksShown = true;
  let hiddenKinds = new Set();
  let rockLabels = [];
  let jd = julianDay(Date.now());
  const rockIndex = id => (id?.startsWith('rock:') && rocks ? (rocks.index.get(id.slice(5)) ?? -1) : -1);
  const rockRadius = record => (record.size ?? (record.H == null ? 5 : sizeFromH(record.H))) / 2 / EARTH_RADIUS_KM;
  const rockAt = (k, out) => rocks.at(k, out).applyMatrix4(orbits.matrix);
  let rockOpacity = 0;

  // spacecraft, once they've loaded. Each is a dot with a name, moved every frame like a planet.
  let crafts = [];
  let craftById = new Map();
  let craftsShown = true;
  let craftOpacity = 0;
  let selectedCraft = null;
  const craftItem = id => (id?.startsWith('craft:') ? craftById.get(id.slice(6)) : undefined);
  // the selected craft's line, drawn in AU around its center, like the Sun or Mars
  const craftFrame = new THREE.Group();
  craftFrame.matrixAutoUpdate = false;
  group.add(craftFrame);
  const craftLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: CRAFT_COLOR,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  craftLine.frustumCulled = false;
  craftLine.visible = false;
  craftFrame.add(craftLine);
  let craftLineTime = null;

  // the selected spacecraft's path. Parker's is an ellipse that starts where it is, like the planets'.
  function drawCraftLine(item, jd) {
    craftLineTime = jd;
    const path = craftPath(item.craft, jd);
    const attribute = craftLine.geometry.attributes.position;
    if (attribute?.array.length === path.length) {
      attribute.array.set(path);
      attribute.needsUpdate = true;
    } else {
      craftLine.geometry.dispose();
      craftLine.geometry = new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(path), 3)
      );
    }
  }

  // Each planet's line is the ellipse it's on right now, starting right at the planet, so the
  // planet always sits on a corner of the line instead of beside one of its straight pieces
  function drawOrbits(now) {
    orbitsTime = now;
    const date = new Date(now);
    for (const { body, line } of orbitLines) {
      const orbit = planetOrbit(body.id, date);
      ellipsePath(orbit, orbit.E, line.geometry.attributes.position.array, PLANET_ORBIT_POINTS);
      line.geometry.attributes.position.needsUpdate = true;
    }
  }

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

  const loadInto = (name, mesh) => {
    const url = TEXTURES[`../space/textures/${name}`];
    if (!url) return;
    loader.load(url, texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      mesh.material.uniforms.map.value = texture;
      mesh.material.uniforms.uHasMap.value = 1;
    });
  };

  // maps load the first time a body is big enough to see, so the page starts fast
  const loadTexture = item => {
    item.textureRequested = true;
    if (item.body.texture) loadInto(item.body.texture, item.mesh);
    if (item.ring && !item.body.rings.bands) loadInto(`${item.body.id}_ring.png`, item.ring);
  };

  // Lagrange points and the heliosphere are just marks with names, and can't be picked. Meteor showers can.
  const mark = (className, text, color, tag = 'div') => {
    const label = document.createElement(tag);
    label.className = className;
    label.textContent = text;
    if (color) label.style.color = color;
    label.hidden = true;
    labelLayer.appendChild(label);
    return { label, position: new THREE.Vector3(), screen: null, distance: 0, screenPx: 0 };
  };
  const lagrange = lagrangePoints(new Date()).map(p => ({ ...mark('lagrange-mark', p.name), between: p.between }));

  const nose = noseDirection();
  const heliosphere = HELIOSPHERE.map(shell => {
    const mesh = bubble(shell, nose);
    orbits.add(mesh);
    // the name sits on the nose, where the Voyagers went through
    const item = mark('region-mark', shell.name, shell.color);
    return { ...item, mesh, local: nose.clone().multiplyScalar(shell.noseAu) };
  });
  let heliosphereOpacity = 0;

  // every stream's dust in one set of points, drawn around the Sun in AU
  const streams = (() => {
    const positions = new Float32Array(PARENTS.length * STREAM_POINTS * 3);
    const colors = new Float32Array(PARENTS.length * STREAM_POINTS * 3);
    const which = new Float32Array(PARENTS.length * STREAM_POINTS);
    PARENTS.forEach((parent, j) => {
      positions.set(streamPoints(parent, STREAM_POINTS, j + 1), j * STREAM_POINTS * 3);
      const c = new THREE.Color(parent.color);
      for (let k = 0; k < STREAM_POINTS; k++) colors.set([c.r, c.g, c.b], (j * STREAM_POINTS + k) * 3);
      which.fill(j, j * STREAM_POINTS, (j + 1) * STREAM_POINTS);
    });
    const geometry = new THREE.BufferGeometry()
      .setAttribute('position', new THREE.BufferAttribute(positions, 3))
      .setAttribute('color', new THREE.BufferAttribute(colors, 3))
      .setAttribute('stream', new THREE.BufferAttribute(which, 1));
    const points = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        vertexShader: streamVertex,
        fragmentShader: streamFragment,
        uniforms: { uSize: { value: 2 }, uOpacity: { value: 0 }, uSelected: { value: -1 } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    points.frustumCulled = false;
    orbits.add(points);
    return points;
  })();
  let streamOpacity = 0;
  let showersShown = true;
  let selectedShower = null;
  // each shower's name goes where the Earth meets its stream at the peak, and picks it when clicked
  const showers = SHOWERS.map(shower => {
    const spot = showerSpot(shower);
    const item = mark('shower-mark', `${shower.name} · ${peakLabel(shower)}`, PARENT_BY_ID[shower.parent].color, 'button');
    item.label.addEventListener('click', () => onPick?.(`shower:${shower.id}`));
    return { ...item, shower, local: new THREE.Vector3(spot.x, spot.y, spot.z) };
  });
  const showerById = new Map(showers.map(item => [item.shower.id, item]));

  // names of the constellations and the brightest stars, filled in by setSky
  let constellationMarks = [];
  let starMarks = [];
  let constellationsShown = true;
  const showerItem = id => (id?.startsWith('shower:') ? showerById.get(id.slice(7)) : undefined);

  let positions = null;
  const point = new THREE.Vector3();
  const sunView = new THREE.Vector3();

  // where something is on screen, or null when it's behind the camera
  const projectOne = (item, position, camera, width, height) => {
    point.copy(position).applyMatrix4(camera.matrixWorldInverse);
    if (point.z >= 0) return (item.screen = null);
    item.distance = -point.z;
    point.copy(position).project(camera);
    return (item.screen = { x: (point.x + 1) * 0.5 * width, y: (1 - point.y) * 0.5 * height });
  };

  const project = (camera, width, height) => {
    for (const item of items) projectOne(item, item.holder.position, camera, width, height);
  };

  // true if a nearer body's disk covers this one, like Neptune behind Saturn
  const hidden = item =>
    items.some(
      other =>
        other !== item &&
        other.screen &&
        other.screenPx > 6 &&
        other.distance < item.distance &&
        Math.hypot(other.screen.x - item.screen.x, other.screen.y - item.screen.y) < other.screenPx / 2
    );

  return {
    group,

    // Ids are body ids like 'mars', 'moon:' and a moon id from moons.js like 'moon:io',
    // 'rock:' and a JPL designation like 'rock:433' or 'rock:1P',
    // or 'craft:' and a spacecraft id from spacecraft.js like 'craft:voyager-1'
    has(id) {
      return !!byId[id] || rockIndex(id) >= 0 || !!craftItem(id) || !!showerItem(id);
    },

    positionOf(id, out) {
      const k = rockIndex(id);
      if (k >= 0) return rockAt(k, out);
      const shower = showerItem(id);
      if (shower) return out.copy(shower.position);
      return out.copy((craftItem(id) ?? byId[id]).holder.position);
    },

    radiusOf(id) {
      const k = rockIndex(id);
      if (k >= 0) return rockRadius(rocks.records[k]);
      // spacecraft are a few meters across, but the camera still needs room to stop
      return craftItem(id) || showerItem(id) ? 0.001 : byId[id].radius;
    },

    // how far away Go to stops: rocks and spacecraft are tiny, so back off enough to see the neighborhood.
    // Webb stays near the Earth, so closer in for it.
    viewDistanceOf(id) {
      // a shower stops back far enough to see a good stretch of its stream
      if (showerItem(id)) return 1.2 * AU;
      const craft = craftItem(id)?.craft;
      // a craft circling a planet stops far enough out to see its whole orbit
      if (craft?.ellipse && craft.center !== 'sun') return craft.ellipse.a * (1 + craft.ellipse.e) * 3 * AU;
      if (craft) return { sun: 0.08, earth: 0.004, jupiter: 0.03 }[craft.center] * AU;
      return rockIndex(id) >= 0 ? 0.08 * AU : byId[id].radius * 4;
    },

    // how wide the body looks on screen, in pixels
    screenPxOf(id) {
      return rockIndex(id) >= 0 || craftItem(id) || showerItem(id) ? 0 : byId[id].screenPx;
    },

    colorOf(id) {
      const k = rockIndex(id);
      if (k >= 0) return KIND_BY_ID[rocks.records[k].kind].color;
      const shower = showerItem(id);
      if (shower) return PARENT_BY_ID[shower.shower.parent].color;
      return craftItem(id) ? CRAFT_COLOR : byId[id].body.color;
    },

    nameOf(id) {
      const k = rockIndex(id);
      if (k >= 0) return rocks.records[k].name;
      return craftItem(id)?.craft.name ?? showerItem(id)?.shower.name ?? byId[id].body.name;
    },

    setShowersHidden(hide) {
      showersShown = !hide;
    },

    // sky is from createSky in stars.js
    setSky(sky) {
      for (const item of [...constellationMarks, ...starMarks]) item.label.remove();
      constellationMarks = sky.constellations.map(({ name, direction }) => ({ ...mark('sky-mark', name), direction }));
      starMarks = sky.named.map(({ name, direction }) => ({ ...mark('star-mark', name), direction }));
    },

    setConstellationsHidden(hide) {
      constellationsShown = !hide;
    },

    // Facts for the info panel about a meteor shower
    showerFacts(id, date) {
      const item = showerItem(id);
      if (!item) return null;
      const { shower } = item;
      const peak = nextPeak(shower, date);
      return {
        name: shower.name,
        shower,
        parent: PARENT_BY_ID[shower.parent],
        color: PARENT_BY_ID[shower.parent].color,
        peak,
        daysToPeak: Math.max(0, Math.ceil((peak.getTime() - date.getTime()) / 86400000))
      };
    },

    // list comes from fromCompactMoons in moons.js
    setMoons(list) {
      const byPlanet = new Map();
      for (const moon of list) {
        const planet = BODIES.find(body => body.id === moon.planet);
        const body = {
          id: `moon:${moon.id}`,
          name: moon.name,
          kind: `Moon of ${planet.name}`,
          radiusKm: moon.radiusKm,
          color: moon.color,
          dot: moon.radiusKm < 50 ? 2 : 3,
          moon
        };
        const item = makeItem(body);
        item.label.classList.add('moon-label');
        items.push(item);
        byId[body.id] = item;
        labelOrder.push(body.id);
        if (!byPlanet.has(moon.planet)) byPlanet.set(moon.planet, []);
        byPlanet.get(moon.planet).push(item);
      }
      moonSystems = [...byPlanet].map(([planet, moons]) => {
        const system = new THREE.Group();
        system.matrixAutoUpdate = false;
        group.add(system);
        // Pluto's small moons go around the balance point with Charon, in J2000 coordinates
        const bary = new THREE.Group();
        bary.matrixAutoUpdate = false;
        group.add(bary);
        const lines = moons.map(item => {
          const line = new THREE.Line(
            new THREE.BufferGeometry().setAttribute(
              'position',
              new THREE.BufferAttribute(new Float32Array((MOON_PATH_POINTS + 1) * 3), 3)
            ),
            new THREE.LineBasicMaterial({
              color: item.body.color,
              transparent: true,
              opacity: 0,
              blending: THREE.AdditiveBlending,
              depthWrite: false
            })
          );
          line.frustumCulled = false;
          line.visible = false;
          (item.body.moon.barycenter || item.body.moon.j2000 ? bary : system).add(line);
          return { item, line };
        });
        return { planet, group: system, bary, moons, lines };
      });
    },

    setMoonsHidden(hide) {
      moonsShown = !hide;
    },

    // keep these bodies' names showing from close to the Earth too, until the next pick
    feature(ids) {
      for (const id of ids) featured.add(id);
    },

    // Facts for the info panel about a moon
    moonFacts(id) {
      const item = byId[id];
      const moon = item?.body.moon;
      if (!moon) return null;
      const fromEarthKm = item.holder.position.length() * EARTH_RADIUS_KM;
      return {
        name: moon.name,
        moon,
        kind: item.body.kind,
        planet: BODIES.find(body => body.id === moon.planet),
        fromEarthKm,
        fromPlanetKm: item.holder.position.distanceTo(byId[moon.planet].holder.position) * EARTH_RADIUS_KM,
        periodDays: moonPeriod(moon),
        // a dwarf planet's spin isn't known, so there's nothing to go backward against
        retrograde: moon.barycenter ? againstSpin(moon, new Date()) : !moon.j2000 && moon.i > 90,
        lightSeconds: fromEarthKm / 299792.458
      };
    },

    // list comes from fromCompactSpacecraft in spacecraft.js
    setSpacecraft(list) {
      crafts = list.map(craft => {
        const holder = new THREE.Group();
        const glow = dot({ id: 'craft', color: CRAFT_COLOR });
        holder.add(glow);
        group.add(holder);
        const label = document.createElement('button');
        label.className = 'body-label craft-label';
        label.textContent = craft.short ?? craft.name;
        label.style.color = CRAFT_COLOR;
        label.hidden = true;
        label.addEventListener('click', () => onPick?.(`craft:${craft.id}`));
        labelLayer.appendChild(label);
        return { craft, holder, glow, label, at: false, screen: null, distance: 0, screenPx: 0 };
      });
      craftById = new Map(crafts.map(item => [item.craft.id, item]));
    },

    setCraftsHidden(hide) {
      craftsShown = !hide;
    },

    // Facts for the info panel about a spacecraft
    craftFacts(id, date) {
      const item = craftItem(id);
      if (!item) return null;
      const { craft } = item;
      const jd = julianDay(date);
      const p = craftPosition(craft, jd);
      const base = { name: craft.name, craft };
      if (!p) return { ...base, noData: true };
      const { sun, [craft.center]: center } = positions ?? geocentric(date);
      // from the Earth, and from the Sun, in AU
      const geo = [p[0] + center.x, p[1] + center.y, p[2] + center.z];
      const helio = [geo[0] - sun.x, geo[1] - sun.y, geo[2] - sun.z];
      const fromEarthKm = Math.hypot(...geo) * KM_PER_AU;
      return {
        ...base,
        fromEarthKm,
        fromSunKm: Math.hypot(...helio) * KM_PER_AU,
        speedKmS: (craftSpeed(craft, jd) * KM_PER_AU) / 86400,
        speedFrom: `${['sun', 'earth', 'moon'].includes(craft.center) ? 'the ' : ''}${BODIES.find(body => body.id === craft.center).name}`,
        lightSeconds: fromEarthKm / 299792.458,
        guessed: !craft.ellipse && (jd < craft.start || jd > craft.end)
      };
    },

    setRocks(records) {
      rocks = createRocks(records);
      orbits.add(rocks.group);
      rockLabels = rocks.notable.map(k => {
        const record = rocks.records[k];
        const label = document.createElement('button');
        label.className = 'body-label rock-label';
        // "433 Eros" reads better as "Eros" on the map
        label.textContent = record.name.replace(/^\d+ /, '').replace(/^\d+P\//, '').replace(/^C\/\S+ \S+ \((.*)\)$/, '$1');
        label.style.color = KIND_BY_ID[record.kind].color;
        label.hidden = true;
        label.addEventListener('click', () => onPick?.(`rock:${record.pdes}`));
        labelLayer.appendChild(label);
        return { k, label, position: new THREE.Vector3(), screen: null, distance: 0, screenPx: 0 };
      });
      rocks.setHiddenKinds(hiddenKinds);
      rocks.update(jd);
    },

    // kinds is a Set of kind ids from smallBodies.js, like 'comet'
    setRocksHidden(kinds) {
      hiddenKinds = kinds;
      rocksShown = KINDS.some(kind => !kinds.has(kind.id));
      rocks?.setHiddenKinds(kinds);
    },

    // highlight a rock's orbit or a spacecraft's path, or pass anything else to clear them
    selectSmall(id) {
      featured = new Set(id ? [id] : []);
      rocks?.select(rockIndex(id));
      selectedShower = showerItem(id) ?? null;
      streams.material.uniforms.uSelected.value = selectedShower ? PARENTS.indexOf(PARENT_BY_ID[selectedShower.shower.parent]) : -1;
      selectedCraft = craftItem(id) ?? null;
      craftLine.visible = !!selectedCraft;
      craftLineTime = null;
    },

    // Facts for the info panel about a rock
    rockFacts(id, date) {
      const k = rockIndex(id);
      if (k < 0) return null;
      const record = rocks.records[k];
      const orbit = rocks.orbit(k);
      const [x, y, z] = positionAt(orbit, julianDay(date));
      const sun = (positions ?? geocentric(date)).sun;
      const fromEarthKm = Math.hypot(x + sun.x, y + sun.y, z + sun.z) * KM_PER_AU;
      // named rocks usually have a Wikipedia article under the same name, like "624 Hektor"
      const named = /^\d+ \D/.test(record.name) || /^\d+[PD]\//.test(record.name);
      return {
        name: record.name,
        pdes: record.pdes,
        kind: KIND_BY_ID[record.kind],
        article: NOTABLE[record.pdes] ?? (named ? record.name : null),
        jpl: jplLink(record.pdes),
        sizeKm: rockRadius(record) * 2 * EARTH_RADIUS_KM,
        sizeKnown: record.size != null,
        sizeGuessed: record.size == null && record.H != null,
        periodDays: periodDays(orbit),
        nearestAu: distanceRange(orbit)[0],
        farthestAu: distanceRange(orbit)[1],
        // for one passing through, the day it's closest to the Sun
        closest: orbit.open ? new Date((orbit.tp - 2440587.5) * 86400000) : null,
        fromEarthKm,
        fromSunKm: Math.hypot(x, y, z) * KM_PER_AU,
        lightSeconds: fromEarthKm / 299792.458
      };
    },

    // The closest rock under the pointer, like { d2, id, position }, or null
    pickRock(x, y, camera, width, height, radius) {
      if (!rocks || !rocksShown || rockOpacity < 0.3) return null;
      const e = new THREE.Matrix4()
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        .multiply(orbits.matrix).elements;
      const hit = rocks.pick(x, y, e, width, height, radius);
      if (!hit) return null;
      return { d2: hit.d2, id: `rock:${rocks.records[hit.k].pdes}`, position: rockAt(hit.k, new THREE.Vector3()) };
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
        if (!p) continue;
        item.holder.position.set(...frame(p.x, p.y, p.z, v));
        if (item.mesh && item.mesh.visible) orient(item.mesh, item.body.id, date, frame);
      }
      // the Moon's orbit drifts a little each day, so redraw it every few hours
      if (moonOrbitTime == null || Math.abs(now - moonOrbitTime) > DAY_MS / 4) {
        moonOrbitTime = now;
        drawMoonOrbit(now);
      }
      const x = new THREE.Vector3(...frame(1, 0, 0, [0, 0, 0], 0, 1));
      const y = new THREE.Vector3(...frame(0, 1, 0, [0, 0, 0], 0, 1));
      const z = new THREE.Vector3(...frame(0, 0, 1, [0, 0, 0], 0, 1));
      orbits.matrix.makeBasis(x, y, z).scale(new THREE.Vector3(AU, AU, AU)).setPosition(byId.sun.holder.position);
      orbits.matrixWorldNeedsUpdate = true;
      craftFrame.matrix.makeBasis(x, y, z).scale(new THREE.Vector3(AU, AU, AU));
      if (selectedCraft) craftFrame.matrix.setPosition(byId[selectedCraft.craft.center].holder.position);
      craftFrame.matrixWorldNeedsUpdate = true;
      if (now !== orbitsTime) drawOrbits(now);
      lagrangePoints(date).forEach((p, i) => lagrange[i].position.set(...frame(p.x, p.y, p.z, v)));
      for (const item of [...heliosphere, ...showers]) item.position.copy(item.local).applyMatrix4(orbits.matrix);
      jd = julianDay(now);
      for (const system of moonSystems) {
        // the planet's equator: x where it crosses Earth's equator, z its north pole
        const { north } = spinAxis(system.planet, date);
        const node = new THREE.Vector3(-north.y, north.x, 0).normalize();
        const pole = new THREE.Vector3(north.x, north.y, north.z);
        const across = pole.clone().cross(node);
        const toScene = d => new THREE.Vector3(...frame(d.x, d.y, d.z, [0, 0, 0], 0, 1));
        system.group.matrix
          .makeBasis(toScene(node), toScene(across), toScene(pole))
          .scale(new THREE.Vector3(1 / EARTH_RADIUS_KM, 1 / EARTH_RADIUS_KM, 1 / EARTH_RADIUS_KM))
          .setPosition(byId[system.planet].holder.position);
        system.group.matrixWorldNeedsUpdate = true;
        const kmScale = new THREE.Vector3(1 / EARTH_RADIUS_KM, 1 / EARTH_RADIUS_KM, 1 / EARTH_RADIUS_KM);
        system.bary.matrix.makeBasis(x, y, z).scale(kmScale);
        system.bary.matrixWorldNeedsUpdate = true;
        for (const item of system.moons) {
          const { moon } = item.body;
          if (moon.barycenter) {
            const planet = byId[system.planet].holder.position;
            const charon = byId['moon:charon']?.holder.position ?? planet;
            system.bary.matrix.setPosition(point.lerpVectors(planet, charon, CHARON_PULL));
            item.holder.position.fromArray(moonOffset(moon, jd, v)).applyMatrix4(system.bary.matrix);
          } else if (moon.j2000) {
            system.bary.matrix.setPosition(byId[system.planet].holder.position);
            item.holder.position.fromArray(moonOffset(moon, jd, v)).applyMatrix4(system.bary.matrix);
          } else {
            item.holder.position.fromArray(moonOffset(moon, jd, v)).applyMatrix4(system.group.matrix);
          }
        }
      }
      if (rocks && (rocks.group.visible || rocks.selected >= 0)) rocks.update(jd);
      for (const item of crafts) {
        item.at = !!craftPosition(item.craft, jd, v);
        if (!item.at) continue;
        item.holder.position.set(...frame(v[0], v[1], v[2], v)).add(byId[item.craft.center].holder.position);
      }
      // Parker's line starts where it is, so it moves with it. The other paths stay put.
      if (selectedCraft && (craftLineTime == null || (selectedCraft.craft.ellipse && jd !== craftLineTime))) {
        drawCraftLine(selectedCraft, jd);
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
        if (body.moon) {
          // how far from its planet it looks, in pixels. Too close and it would just sit on the planet's dot.
          item.apartPx = (holder.position.distanceTo(byId[body.moon.planet].holder.position) / distance) * focal;
          item.fade = moonsShown ? THREE.MathUtils.smoothstep(item.apartPx, 3, 8) : 0;
          uniforms.uOpacity.value *= item.fade;
          holder.visible = item.fade > 0;
        }
        if (mesh) {
          // rings reach past the planet, so they count toward its size
          mesh.visible = item.screenPx * (item.ring ? (2 * body.rings.outerKm) / body.radiusKm : 1) > 0.5;
          if (mesh.visible && !item.textureRequested && item.screenPx > 4) loadTexture(item);
          if (body.id !== 'sun') {
            sunView.subVectors(sun, holder.position).transformDirection(camera.matrixWorldInverse);
            mesh.material.uniforms.uSunView.value.copy(sunView);
            item.ring?.material.uniforms.uSunView.value.copy(sunView);
            // the Earth is at the middle of the scene
            if (body.id === 'moon') mesh.material.uniforms.uEarthView.value.setScalar(0).applyMatrix4(camera.matrixWorldInverse);
          }
        }
      }

      // orbits stay faint near the Earth, so they don't crowd the satellites, and brighten as you zoom out
      moonOrbit.material.opacity = 0.2 + 0.15 * THREE.MathUtils.smoothstep(earthDistance, 8, 30);
      const orbitOpacity = 0.2 + 0.2 * THREE.MathUtils.smoothstep(earthDistance, 300, 3000);
      for (const { line } of orbitLines) line.material.opacity = orbitOpacity;
      // the heliosphere shows once you're out past the planets, and meteor streams among the inner planets
      heliosphereOpacity = THREE.MathUtils.smoothstep(earthDistance, 20 * AU, 120 * AU);
      for (const { mesh } of heliosphere) {
        mesh.visible = heliosphereOpacity > 0;
        mesh.material.uniforms.uOpacity.value = heliosphereOpacity;
      }
      streamOpacity = showersShown
        ? THREE.MathUtils.smoothstep(earthDistance, 0.15 * AU, 0.6 * AU) * (1 - THREE.MathUtils.smoothstep(earthDistance, 15 * AU, 40 * AU))
        : 0;
      // a picked shower stays visible, even when the rest are hidden
      if (selectedShower) streamOpacity = Math.max(streamOpacity, 0.8);
      streams.visible = streamOpacity > 0;
      streams.material.uniforms.uOpacity.value = 0.55 * streamOpacity;
      streams.material.uniforms.uSize.value = 2 * pixelRatio;
      // a moon's orbit shows once it's big enough on screen to tell apart from the planet
      for (const system of moonSystems) {
        const planetDistance = camera.position.distanceTo(byId[system.planet].holder.position);
        for (const { item, line } of system.lines) {
          const orbitPx = ((2 * item.body.moon.a) / EARTH_RADIUS_KM / planetDistance) * focal;
          line.material.opacity = moonsShown ? 0.25 * THREE.MathUtils.smoothstep(orbitPx, 30, 120) : 0;
          line.visible = line.material.opacity > 0;
          if (line.visible) {
            moonPath(item.body.moon, jd, line.geometry.attributes.position.array, MOON_PATH_POINTS);
            line.geometry.attributes.position.needsUpdate = true;
          }
        }
      }
      if (rocks) {
        rockOpacity = rocksShown ? THREE.MathUtils.smoothstep(earthDistance, 150, 1500) : 0;
        // a picked rock stays visible even when it passes close to the Earth
        if (rocksShown && rocks.selected >= 0) rockOpacity = Math.max(rockOpacity, 0.6);
        rocks.style(rockOpacity, pixelRatio);
      }
      // spacecraft show up a little sooner than rocks, so Webb appears once you're past the Moon
      craftOpacity = craftsShown ? THREE.MathUtils.smoothstep(earthDistance, 60, 300) : 0;
      for (const item of crafts) {
        const { center } = item.craft;
        // craft around the Moon or a planet don't crowd the satellites, so they skip that fade
        let opacity = center === 'sun' || center === 'earth' ? craftOpacity : craftsShown ? 1 : 0;
        // and like moons, they fade out once they'd sit right on their center's dot
        if (center !== 'sun') {
          const centerPosition = byId[center].holder.position;
          const apartPx = (item.holder.position.distanceTo(centerPosition) / camera.position.distanceTo(item.holder.position)) * focal;
          opacity *= THREE.MathUtils.smoothstep(apartPx, 3, 8);
        }
        // a picked spacecraft stays visible, even when the rest are hidden
        item.opacity = item === selectedCraft ? Math.max(opacity, 0.8) : opacity;
        item.holder.visible = item.at && item.opacity > 0;
        item.glow.material.uniforms.uSize.value = 6 * pixelRatio;
        item.glow.material.uniforms.uOpacity.value = item.opacity;
      }

      project(camera, width, height);
      const placed = [];
      // Marks with names that aren't bodies, like meteor showers and Lagrange points. Lagrange points
      // show once they're far enough on screen from both of their bodies.
      const lagrangeApart = item =>
        Math.min(
          ...item.between.map(id => (byId[id].screen ? Math.hypot(byId[id].screen.x - item.screen.x, byId[id].screen.y - item.screen.y) : Infinity))
        ) > 24;
      const placeMarks = (list, visible, check = () => true) => {
        for (const item of list) {
          const { label, position } = item;
          let show = visible && !!projectOne(item, position, camera, width, height);
          if (show) show = check(item) && !behindEarth(camera.position, position) && !hidden(item);
          let x = 0;
          let y = 0;
          if (show) {
            x = item.screen.x - 4;
            y = item.screen.y - 8;
            const box = { left: x + 8, right: x + 12 + label.textContent.length * 5.5, top: y, bottom: y + 16 };
            show = !placed.some(o => box.left < o.right && box.right > o.left && box.top < o.bottom && box.bottom > o.top);
            if (show) placed.push(box);
          }
          if (label.hidden === show) label.hidden = !show;
          if (show) label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        }
      };
      for (const id of labelOrder) {
        const item = byId[id];
        const { label, holder } = item;
        let show = !!item.screen && item.screenPx < 0.3 * Math.min(width, height);
        // close to the Earth the planets are just dots in the sky, so only the Sun, the Moon and picked ones get names
        if (show && id !== 'sun' && id !== 'moon' && !featured.has(id)) show = earthDistance > 40;
        if (show && item.body.moon) show = item.fade > 0.9 && item.apartPx > 16;
        if (show && id !== 'earth') show = !behindEarth(camera.position, holder.position);
        if (show) show = !hidden(item);
        let x = 0;
        let y = 0;
        if (show) {
          const textWidth = label.textContent.length * 7 + 10;
          const gap = Math.max(3, item.screenPx / 2) + 4;
          y = item.screen.y - 9;
          const free = box => !placed.some(o => box.left < o.right && box.right > o.left && box.top < o.bottom && box.bottom > o.top);
          // right of the dot, or left of it if something's already there
          x = item.screen.x + gap;
          let box = { left: x, right: x + textWidth, top: y, bottom: y + 18 };
          if (!free(box)) {
            x = item.screen.x - gap - textWidth;
            box = { left: x, right: x + textWidth, top: y, bottom: y + 18 };
          }
          show = free(box);
          if (show) placed.push(box);
        }
        if (label.hidden === show) label.hidden = !show;
        if (show) label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      }

      // then meteor showers, the picked one first
      placeMarks(selectedShower ? [selectedShower] : [], true);
      placeMarks(
        showers.filter(item => item !== selectedShower),
        showersShown && streamOpacity > 0.5
      );

      // then spacecraft
      for (const item of crafts) {
        const { label, holder } = item;
        let show = holder.visible && item.opacity > 0.5 && !!projectOne(item, holder.position, camera, width, height);
        if (show) show = !behindEarth(camera.position, holder.position) && !hidden(item);
        let x = 0;
        let y = 0;
        if (show) {
          x = item.screen.x + 7;
          y = item.screen.y - 9;
          const box = { left: x, right: x + label.textContent.length * 6.5 + 10, top: y, bottom: y + 18 };
          show = !placed.some(o => box.left < o.right && box.right > o.left && box.top < o.bottom && box.bottom > o.top);
          if (show) placed.push(box);
        }
        if (label.hidden === show) label.hidden = !show;
        if (show) label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      }

      // famous rocks get names too, after the planets, once you're out among them
      for (const item of rockLabels) {
        const { label, position } = item;
        let show = rockOpacity > 0.5 && rocks.shown(item.k);
        if (show) {
          rockAt(item.k, position);
          point.copy(position).applyMatrix4(camera.matrixWorldInverse);
          show = point.z < 0;
          item.distance = -point.z;
        }
        let x = 0;
        let y = 0;
        if (show) {
          point.copy(position).project(camera);
          item.screen = { x: (point.x + 1) * 0.5 * width, y: (1 - point.y) * 0.5 * height };
          show = !behindEarth(camera.position, position) && !hidden(item);
        }
        if (show) {
          x = item.screen.x + 7;
          y = item.screen.y - 9;
          const box = { left: x, right: x + label.textContent.length * 6.5 + 10, top: y, bottom: y + 18 };
          show = !placed.some(o => box.left < o.right && box.right > o.left && box.top < o.bottom && box.bottom > o.top);
          if (show) placed.push(box);
        }
        if (label.hidden === show) label.hidden = !show;
        if (show) label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      }

      placeMarks(lagrange, true, lagrangeApart);
      placeMarks(heliosphere, heliosphereOpacity > 0.5);

      // star and constellation names go last, so they never cover anything closer.
      // They're far past everything, in their direction from the camera.
      for (const item of [...starMarks, ...constellationMarks]) item.position.copy(camera.position).addScaledVector(item.direction, 1e12);
      placeMarks(starMarks, true);
      placeMarks(constellationMarks, constellationsShown);
    },

    // Bodies under the pointer can be picked like satellites. Returns screen spots for each body.
    spots(camera, width, height) {
      const out = [];
      const earthDistance = camera.position.length();
      project(camera, width, height);
      for (const item of items) {
        if (!item.screen || (item.body.id === 'earth' && earthDistance < 40) || hidden(item)) continue;
        if (item.body.moon && item.fade < 0.5) continue;
        out.push({
          id: item.body.id,
          ...item.screen,
          radiusPx: item.screenPx / 2,
          position: item.holder.position
        });
      }
      for (const item of crafts) {
        if (!item.holder.visible || item.opacity < 0.3 || !projectOne(item, item.holder.position, camera, width, height)) {
          continue;
        }
        if (hidden(item)) continue;
        out.push({ id: `craft:${item.craft.id}`, ...item.screen, radiusPx: 0, position: item.holder.position });
      }
      // a meteor shower can be picked where its name is showing
      for (const item of showers) {
        if (item.label.hidden || !item.screen) continue;
        out.push({ id: `shower:${item.shower.id}`, ...item.screen, radiusPx: 0, position: item.position });
      }
      return out;
    },

    dispose() {
      rocks?.dispose();
      labelLayer.remove();
    }
  };
}
