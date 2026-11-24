import * as THREE from 'three';
import { AU, BODIES, geocentric, KM_PER_AU, planetOrbit, PLANETS, sceneFrame, spinAxis } from '../space/bodies.js';
import {
  ellipsePath,
  jplLink,
  julianDay,
  KIND_BY_ID,
  NOTABLE,
  periodDays,
  positionAt,
  sizeFromH
} from '../space/smallBodies.js';
import { behindEarth, EARTH_RADIUS_KM } from '../sats/frames.js';
import { createRocks } from './rocks.js';

const TEXTURES = import.meta.glob('../space/textures/*', { eager: true, query: '?url', import: 'default' });
const MOON_ORBIT_POINTS = 256;
const MOON_ORBIT_DAYS = 27.32;
const PLANET_ORBIT_POINTS = 360;
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

// Saturn's rings, lit from the side the Sun is on
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
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), material);
  if (body.rings) mesh.add(rings(body));
  return mesh;
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
    const ring = mesh?.children[0] ?? null;
    return { body, holder, mesh, ring, glow, label, radius, screenPx: 0, textureRequested: false };
  });
  const byId = Object.fromEntries(items.map(item => [item.body.id, item]));

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
  let rockLabels = [];
  let jd = julianDay(Date.now());
  const rockIndex = id => (id?.startsWith('rock:') && rocks ? (rocks.index.get(id.slice(5)) ?? -1) : -1);
  const rockRadius = record => (record.size ?? (record.H == null ? 5 : sizeFromH(record.H))) / 2 / EARTH_RADIUS_KM;
  const rockAt = (k, out) => rocks.at(k, out).applyMatrix4(orbits.matrix);
  let rockOpacity = 0;

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
    if (item.ring) loadInto(`${item.body.id}_ring.png`, item.ring);
  };

  let positions = null;
  const point = new THREE.Vector3();
  const sunView = new THREE.Vector3();

  // where each body is on screen, or null when it's behind the camera
  const project = (camera, width, height) => {
    for (const item of items) {
      point.copy(item.holder.position).applyMatrix4(camera.matrixWorldInverse);
      if (point.z >= 0) {
        item.screen = null;
        continue;
      }
      item.distance = -point.z;
      point.copy(item.holder.position).project(camera);
      item.screen = { x: (point.x + 1) * 0.5 * width, y: (1 - point.y) * 0.5 * height };
    }
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

    // Ids are body ids like 'mars', or 'rock:' and a JPL designation like 'rock:433' or 'rock:1P'
    has(id) {
      return !!byId[id] || rockIndex(id) >= 0;
    },

    positionOf(id, out) {
      const k = rockIndex(id);
      if (k >= 0) return rockAt(k, out);
      return out.copy(byId[id].holder.position);
    },

    radiusOf(id) {
      const k = rockIndex(id);
      return k >= 0 ? rockRadius(rocks.records[k]) : byId[id].radius;
    },

    // how far away Go to stops: rocks are tiny, so back off enough to see the neighborhood
    viewDistanceOf(id) {
      return rockIndex(id) >= 0 ? 0.08 * AU : byId[id].radius * 4;
    },

    // how wide the body looks on screen, in pixels
    screenPxOf(id) {
      return rockIndex(id) >= 0 ? 0 : byId[id].screenPx;
    },

    colorOf(id) {
      const k = rockIndex(id);
      return k >= 0 ? KIND_BY_ID[rocks.records[k].kind].color : byId[id].body.color;
    },

    nameOf(id) {
      const k = rockIndex(id);
      return k >= 0 ? rocks.records[k].name : byId[id].body.name;
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
      rocks.update(jd);
    },

    setRocksShown(shown) {
      rocksShown = shown;
    },

    selectRock(id) {
      rocks?.select(rockIndex(id));
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
        nearestAu: orbit.a * (1 - orbit.e),
        farthestAu: orbit.a * (1 + orbit.e),
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
      if (now !== orbitsTime) drawOrbits(now);
      jd = julianDay(now);
      if (rocks && (rocks.group.visible || rocks.selected >= 0)) rocks.update(jd);
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
          // rings reach past the planet, so they count toward its size
          mesh.visible = item.screenPx * (item.ring ? 2.4 : 1) > 0.5;
          if (mesh.visible && !item.textureRequested && item.screenPx > 4) loadTexture(item);
          if (body.id !== 'sun') {
            sunView.subVectors(sun, holder.position).transformDirection(camera.matrixWorldInverse);
            mesh.material.uniforms.uSunView.value.copy(sunView);
            item.ring?.material.uniforms.uSunView.value.copy(sunView);
          }
        }
      }

      // orbits stay faint near the Earth, so they don't crowd the satellites, and brighten as you zoom out
      moonOrbit.material.opacity = 0.2 + 0.15 * THREE.MathUtils.smoothstep(earthDistance, 8, 30);
      const orbitOpacity = 0.2 + 0.2 * THREE.MathUtils.smoothstep(earthDistance, 300, 3000);
      for (const { line } of orbitLines) line.material.opacity = orbitOpacity;
      if (rocks) {
        rockOpacity = rocksShown ? THREE.MathUtils.smoothstep(earthDistance, 150, 1500) : 0;
        // a picked rock stays visible even when it passes close to the Earth
        if (rocksShown && rocks.selected >= 0) rockOpacity = Math.max(rockOpacity, 0.6);
        rocks.style(rockOpacity, pixelRatio);
      }

      project(camera, width, height);
      const placed = [];
      for (const id of LABEL_ORDER) {
        const item = byId[id];
        const { label, holder } = item;
        let show = !!item.screen && item.screenPx < 0.3 * Math.min(width, height);
        // close to the Earth the planets are just dots in the sky, so only the Sun and Moon get names
        if (show && id !== 'sun' && id !== 'moon') show = earthDistance > 40;
        if (show && id !== 'earth') show = !behindEarth(camera.position, holder.position);
        if (show) show = !hidden(item);
        let x = 0;
        let y = 0;
        if (show) {
          x = item.screen.x + Math.max(3, item.screenPx / 2) + 4;
          y = item.screen.y - 9;
          const box = { left: x, right: x + label.textContent.length * 7 + 10, top: y, bottom: y + 18 };
          show = !placed.some(o => box.left < o.right && box.right > o.left && box.top < o.bottom && box.bottom > o.top);
          if (show) placed.push(box);
        }
        if (label.hidden === show) label.hidden = !show;
        if (show) label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      }

      // famous rocks get names too, after the planets, once you're out among them
      for (const item of rockLabels) {
        const { label, position } = item;
        let show = rockOpacity > 0.5;
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
    },

    // Bodies under the pointer can be picked like satellites. Returns screen spots for each body.
    spots(camera, width, height) {
      const out = [];
      const earthDistance = camera.position.length();
      project(camera, width, height);
      for (const item of items) {
        if (!item.screen || (item.body.id === 'earth' && earthDistance < 40) || hidden(item)) continue;
        out.push({
          id: item.body.id,
          ...item.screen,
          radiusPx: item.screenPx / 2,
          position: item.holder.position
        });
      }
      return out;
    },

    dispose() {
      rocks?.dispose();
      labelLayer.remove();
    }
  };
}
