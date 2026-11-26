import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { degreesLat, degreesLong, eciToGeodetic, gstime, json2satrec, propagate } from 'satellite.js';
import { CATEGORIES } from '../sats/catalog.js';
import { behindEarth, EARTH_RADIUS_KM, STRIDE, sunDirection, toScene } from '../sats/frames.js';
import { AU, bodyFacts, ECLIPTIC_NORTH, sceneFrame } from '../space/bodies.js';
import { createEarth } from './earth.js';
import { createSatellitePoints } from './satellitePoints.js';
import { createSolarSystem } from './solarSystem.js';
import { createSky, loadSky } from './stars.js';
import { createAurora } from './aurora.js';
import { createClouds } from './clouds.js';
import { AURORA_URL, auroraGrid } from '../space/aurora.js';

const SIZES = {
  station: 11,
  starlink: 2.2,
  kuiper: 3.4,
  oneweb: 3.4,
  gnss: 4,
  earth: 3.6,
  comms: 3.2,
  science: 3.6,
  military: 3.2,
  other: 3
};
const COLORS = Object.fromEntries(CATEGORIES.map(c => [c.id, new THREE.Color(c.color)]));
const ORBIT_POINTS = 256;
const PICK_RADIUS_PX = 14;
const FLY_MS = 1400;
const HOME_DISTANCE = 3.8;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const markerVertex = /* glsl */ `
  uniform float uPixelRatio;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = 30.0 * uPixelRatio;
  }
`;

const markerFragment = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float ring = smoothstep(0.05, 0.0, abs(d - 0.4));
    if (ring < 0.01) discard;
    gl_FragColor = vec4(uColor * ring, 1.0);
    #include <colorspace_fragment>
  }
`;

const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Fill a line with one full orbit, starting at the given time.
function drawOrbitLine(line, satrec, now) {
  const periodMs = ((2 * Math.PI) / satrec.no) * 60000;
  const array = line.geometry.attributes.position.array;
  for (let k = 0; k <= ORBIT_POINTS; k++) {
    const result = propagate(satrec, new Date(now + (k / ORBIT_POINTS) * periodMs));
    if (!result?.position) {
      if (k > 0) array.copyWithin(k * 3, (k - 1) * 3, k * 3);
      continue;
    }
    const { x, y, z } = result.position;
    toScene(x / EARTH_RADIUS_KM, y / EARTH_RADIUS_KM, z / EARTH_RADIUS_KM, array, k * 3);
  }
  line.geometry.attributes.position.needsUpdate = true;
}

export class Globe {
  constructor(container, { onHover, onSelect, onInfo, onTapEmpty, onAnchor, onZone, onAurora, onClouds }) {
    this.container = container;
    this.callbacks = { onHover, onSelect, onInfo, onTapEmpty, onAnchor, onZone, onAurora, onClouds };
    this.clock = { realStart: Date.now(), simStart: Date.now(), speed: 1, version: 0 };
    this.records = [];
    this.categories = [];
    this.shown = new Uint8Array(0);
    this.latest = null;
    this.selected = -1;
    this.satrec = null;
    this.follow = false;
    this.flight = null;
    this.lastInfoAt = 0;
    this.selectedBody = null;
    // the body the camera stays centered on, like 'moon'. The Earth is home.
    this.anchor = 'earth';
    this.fade = 1;
    this.size = { width: 1, height: 1 };

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // the near plane follows the zoom (see frame), so far can reach past Pluto
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.005, 1e9);
    this.camera.position.set(0, 1.2, HOME_DISTANCE);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.08;
    // about 4,000 AU, far enough to see all of Sedna's orbit
    this.controls.maxDistance = 1e8;

    this.globe = createEarth();
    // NOAA's live aurora, checked every 10 minutes while the page is showing
    this.aurora = createAurora(this.globe.sunDirection);
    this.globe.earth.add(this.aurora.mesh);
    this.auroraHidden = false;
    this.auroraTimer = setInterval(() => document.hidden || this.loadAurora(), 10 * 60000);
    this.loadAurora();

    // yesterday's clouds from NASA, a moment after the satellites start loading
    this.clouds = createClouds(this.globe);
    this.globe.earth.add(this.clouds.mesh);
    this.cloudsHidden = false;
    this.cloudsTimer = setTimeout(() => {
      this.clouds
        .load()
        .then(day => this.callbacks.onClouds?.(day))
        .catch(error => console.warn('No clouds', error));
    }, 1500);

    // the real stars load a moment later
    this.stars = new THREE.Group();
    this.stars.renderOrder = -1;
    this.constellationsHidden = false;
    loadSky()
      .then(data => {
        const sky = createSky(data, sceneFrame(new Date()));
        sky.points.renderOrder = sky.lines.renderOrder = -1;
        sky.lines.visible = !this.constellationsHidden;
        this.constellationLines = sky.lines;
        this.stars.add(sky.points, sky.lines);
        this.solar.setSky(sky);
      })
      .catch(error => console.warn('No stars', error));
    this.solar = createSolarSystem(container, { onPick: id => this.selectBody(id) });
    this.scene.add(this.globe.earth, this.globe.glow, this.stars, this.solar.group);

    this.pixelRatio = { value: this.renderer.getPixelRatio() };
    this.marker = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)),
      new THREE.ShaderMaterial({
        vertexShader: markerVertex,
        fragmentShader: markerFragment,
        uniforms: { uPixelRatio: this.pixelRatio, uColor: { value: new THREE.Color() } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    this.marker.frustumCulled = false;
    this.marker.visible = false;

    const orbitGeometry = new THREE.BufferGeometry();
    orbitGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((ORBIT_POINTS + 1) * 3), 3));
    this.orbit = new THREE.Line(
      orbitGeometry,
      new THREE.LineBasicMaterial({ transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.orbit.frustumCulled = false;
    this.orbit.visible = false;
    // orbit lines for a group of satellites, like your favorites
    this.orbitGroup = new THREE.Group();
    this.groupOrbits = [];
    this.scene.add(this.marker, this.orbit, this.orbitGroup);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.listen();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  simNow() {
    const { simStart, realStart, speed } = this.clock;
    return simStart + (Date.now() - realStart) * speed;
  }

  setClock({ simStart, speed }) {
    // only a jump in time makes the worker's last answer useless, a new speed doesn't
    const jumped = Math.abs(simStart - this.simNow()) > 1000;
    this.clock = { realStart: Date.now(), simStart, speed, version: this.clock.version + (jumped ? 1 : 0) };
    this.worker?.postMessage({ type: 'clock', clock: this.clock });
    if (jumped) this.orbitTime = this.groupOrbitsTime = null;
  }

  // Draw the orbits of these satellites (up to 40). Pass null to remove them.
  setGroupOrbits(indices) {
    for (const { line } of this.groupOrbits) {
      line.geometry.dispose();
      line.material.dispose();
    }
    this.orbitGroup.clear();
    this.groupOrbits = (indices ?? []).slice(0, 40).map(index => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((ORBIT_POINTS + 1) * 3), 3));
      const material = new THREE.LineBasicMaterial({
        color: COLORS[this.categories[index]],
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false;
      this.orbitGroup.add(line);
      return { line, satrec: json2satrec(this.records[index]) };
    });
    this.groupOrbitsTime = null;
  }

  setData(records, categories) {
    this.records = records;
    this.categories = categories;
    this.shown = new Uint8Array(records.length).fill(1);

    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
    }
    this.points = createSatellitePoints(records.length);
    this.points.material.uniforms.uPixelRatio = this.pixelRatio;
    const { aColor } = this.points.geometry.attributes;
    this.categories.forEach((category, i) => COLORS[category].toArray(aColor.array, i * 3));
    this.hidden = new Set();
    this.focus = null;
    this.updateSizes();
    this.scene.add(this.points);

    this.worker?.terminate();
    this.latest = null;
    this.worker = new Worker(new URL('../sats/propagate.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => this.receive(data);
    this.worker.postMessage({ type: 'init', records });
    this.worker.postMessage({ type: 'clock', clock: this.clock });

    if (this.anchor === 'earth') this.camera.position.copy(this.homeDirection()).multiplyScalar(HOME_DISTANCE);
  }

  // looking at the Earth with the sunrise line in view
  homeDirection() {
    const view = new THREE.Vector3(...sunDirection(new Date(this.simNow())));
    view.applyAxisAngle(Y_AXIS, 1.0);
    view.y = 0.4;
    return view.normalize();
  }

  // A nice side to look at a body from: partly lit, and turned a little toward the Earth.
  viewDirection(id) {
    if (id === 'earth') return this.homeDirection();
    const at = this.solar.positionOf(id, new THREE.Vector3());
    const toEarth = at.clone().negate().normalize();
    const up = new THREE.Vector3(0, 0.3, 0);
    if (id === 'sun') return toEarth.add(up).normalize();
    const toSun = this.solar.positionOf('sun', new THREE.Vector3()).sub(at).normalize();
    // look down on a meteor shower from above the planets, so its stream crosses the Earth's orbit in view
    if (id.startsWith('shower:')) return this.eclipticNorth().add(toSun.multiplyScalar(0.4)).normalize();
    return toSun.add(toEarth.multiplyScalar(0.7)).add(up).normalize();
  }

  // Fly to a body and keep it in the middle of the view from then on.
  // direction and distance say where the camera ends up, looking back at the body.
  goTo(id, { distance, direction } = {}) {
    this.follow = false;
    const radius = this.solar.radiusOf(id);
    const endDistance = distance ?? (id === 'earth' ? HOME_DISTANCE : this.solar.viewDistanceOf(id));
    const startTarget = this.controls.target.clone();
    const startCamera = this.camera.position.clone();
    const startDistance = startCamera.distanceTo(startTarget);
    const startDir = startCamera.clone().sub(startTarget).normalize();
    const travel = this.solar.positionOf(id, new THREE.Vector3()).distanceTo(startTarget);
    const to = new THREE.Vector3();
    const dir = new THREE.Vector3();
    this.anchor = id;
    this.anchorFrom = null;
    this.fly(
      k => {
        this.solar.positionOf(id, to);
        const endDir = direction ? direction() : this.viewDirection(id);
        dir.copy(startDir).lerp(endDir, k);
        if (dir.lengthSq() < 1e-6) dir.copy(endDir);
        dir.normalize();
        this.controls.target.lerpVectors(startTarget, to, k);
        // zoom smoothly across huge distances, and rise up on long trips to see where we're going
        const zoom = startDistance * Math.pow(endDistance / startDistance, k) + Math.sin(Math.PI * k) * travel * 0.5;
        this.camera.position.copy(this.controls.target).addScaledVector(dir, zoom);
      },
      {
        duration: FLY_MS + Math.min(1600, Math.log10(1 + travel) * 300),
        done: () => (this.controls.minDistance = id === 'earth' ? 1.08 : radius * 1.15)
      }
    );
    // let the camera pass close to things on the way, then stop it going inside the body
    this.controls.minDistance = 0;
    this.lastInfoAt = 0;
    this.callbacks.onAnchor?.(id);
  }

  // straight up from the plane the planets orbit in
  eclipticNorth() {
    const { x, y, z } = ECLIPTIC_NORTH;
    return new THREE.Vector3(...sceneFrame(new Date(this.simNow()))(x, y, z, [0, 0, 0], 0, 1));
  }

  // Fly out over the Sun until the inner planets fit, looking down on the plane they orbit in.
  showSolarSystem() {
    const north = this.eclipticNorth();
    this.goTo('sun', {
      distance: 3.2 * AU,
      // tipped toward the Earth, so it sits near the bottom of the view
      direction: () => {
        const toEarth = this.solar.positionOf('sun', new THREE.Vector3()).negate().normalize();
        return toEarth.multiplyScalar(0.7).add(north).normalize();
      }
    });
  }

  // Select the Sun, the Moon, a planet, a rock (like 'rock:433'), a spacecraft (like 'craft:voyager-1')
  // or a meteor shower (like 'shower:perseids') by id, or pass null.
  selectBody(id) {
    if (id && this.selected >= 0) this.select(-1);
    this.selectedBody = id;
    this.lastInfoAt = 0;
    this.marker.visible = !!id;
    this.solar.selectSmall(id);
    if (id) this.marker.material.uniforms.uColor.value.set(this.solar.colorOf(id));
    this.callbacks.onInfo?.(id ? this.bodyInfo(new Date(this.simNow())) : null);
  }

  bodyInfo(date) {
    const id = this.selectedBody;
    const anchored = this.anchor === id;
    const rock = this.solar.rockFacts(id, date);
    if (rock) return { type: 'rock', id, anchored, ...rock };
    const craft = this.solar.craftFacts(id, date);
    if (craft) return { type: 'craft', id, anchored, ...craft };
    const moon = this.solar.moonFacts(id);
    if (moon) return { type: 'moon', id, anchored, ...moon };
    const shower = this.solar.showerFacts(id, date);
    if (shower) return { type: 'shower', id, anchored, ...shower };
    return { type: 'body', id, anchored, ...bodyFacts(id, date, this.solar.positions() ?? undefined) };
  }

  // Moons, asteroids, comets and spacecraft load later, the first time you zoom out (see onZone)
  setMoons(list) {
    this.solar.setMoons(list);
  }

  setMoonsHidden(hide) {
    this.solar.setMoonsHidden(hide);
  }

  setRocks(records) {
    this.solar.setRocks(records);
  }

  setRocksHidden(kinds) {
    this.solar.setRocksHidden(kinds);
  }

  setSpacecraft(list) {
    this.solar.setSpacecraft(list);
  }

  setCraftsHidden(hide) {
    this.solar.setCraftsHidden(hide);
  }

  setShowersHidden(hide) {
    this.solar.setShowersHidden(hide);
  }

  // Point the camera at an eclipse from eclipses.js. The page sets the clock.
  watchEclipse(eclipse) {
    const moon = () => this.solar.positionOf('moon', new THREE.Vector3()).normalize();
    // the Moon's shadow lands on the side of the Earth facing the Moon
    if (eclipse.type === 'solar') this.goTo('earth', { distance: HOME_DISTANCE, direction: moon });
    // and the Earth's shadow on the side of the Moon facing the Earth
    else this.goTo('moon', { direction: () => moon().negate() });
  }

  // What the camera is looking at and where it sits from there as [x, y, z] in scene units, for links
  getView() {
    return { anchor: this.anchor, offset: this.camera.position.clone().sub(this.controls.target).toArray() };
  }

  // Put the camera back where getView said, right away
  setView(anchor, offset) {
    this.setFollow(false);
    this.flight = null;
    this.anchor = anchor;
    this.anchorFrom = null;
    const at = this.solar.positionOf(anchor, new THREE.Vector3());
    this.controls.target.copy(at);
    this.camera.position.copy(at).add(new THREE.Vector3(...offset));
    this.controls.minDistance = anchor === 'earth' ? 1.08 : this.solar.radiusOf(anchor) * 1.15;
    this.lastInfoAt = 0;
    this.callbacks.onAnchor?.(anchor);
  }

  // Point the camera at an event's view from events.js. The page sets the clock.
  watchEvent(view) {
    if (view.type === 'eclipse') return this.watchEclipse(view.eclipse);
    if (view.type === 'body') {
      this.selectBody(view.id);
      return this.goTo(view.id);
    }
    const north = this.eclipticNorth();
    if (view.type === 'earth') {
      this.selectBody('earth');
      // from the side, a little toward the Sun, so the day side and the tilted poles both show
      return this.goTo('earth', {
        distance: HOME_DISTANCE * 1.3,
        direction: () => {
          const toSun = this.solar.positionOf('sun', new THREE.Vector3()).normalize();
          return toSun.clone().cross(north).normalize().add(toSun.multiplyScalar(0.5)).add(north.clone().multiplyScalar(0.2)).normalize();
        }
      });
    }
    // two planets close in the sky: look past the Earth's edge toward them, the way you'd see them from the ground
    this.selectBody(view.ids[0]);
    this.solar.feature(view.ids);
    this.goTo('earth', {
      distance: HOME_DISTANCE * 1.6,
      direction: () => {
        const [a, b] = view.ids.map(id => this.solar.positionOf(id, new THREE.Vector3()).normalize());
        // turned sideways, so the pair shows just past the Earth's edge
        return a.add(b).normalize().applyAxisAngle(north, THREE.MathUtils.degToRad(20)).negate();
      }
    });
  }

  setAuroraHidden(hide) {
    this.auroraHidden = hide;
  }

  setCloudsHidden(hide) {
    this.cloudsHidden = hide;
  }

  loadAurora() {
    fetch(AURORA_URL)
      .then(response => {
        if (!response.ok) throw new Error(`${response.status}`);
        return response.json();
      })
      .then(json => {
        this.auroraNow = auroraGrid(json);
        this.aurora.update(this.auroraNow);
        this.callbacks.onAurora?.({ peak: this.auroraNow.peak, observed: this.auroraNow.observed });
      })
      .catch(error => console.warn('No aurora', error));
  }

  setConstellationsHidden(hide) {
    this.constellationsHidden = hide;
    if (this.constellationLines) this.constellationLines.visible = !hide;
    this.solar.setConstellationsHidden(hide);
  }

  updateBodySelection(date) {
    const at = this.solar.positionOf(this.selectedBody, new THREE.Vector3());
    this.marker.geometry.attributes.position.array.set([at.x, at.y, at.z]);
    this.marker.geometry.attributes.position.needsUpdate = true;
    // the ring only helps while the body is a dot
    this.marker.visible = this.solar.screenPxOf(this.selectedBody) < 24;
    if (performance.now() - this.lastInfoAt > 200) {
      this.lastInfoAt = performance.now();
      this.callbacks.onInfo?.(this.bodyInfo(date));
    }
  }

  setHidden(hidden) {
    this.hidden = hidden;
    this.updateSizes();
  }

  // Highlight a list of satellites and fade the rest. Pass null to show everything again.
  setFocus(indices) {
    this.focus = indices ? new Set(indices) : null;
    this.updateSizes();
  }

  updateSizes() {
    const { aSize, aFocus } = this.points.geometry.attributes;
    this.categories.forEach((category, i) => {
      const focused = this.focus?.has(i) ?? false;
      let size = this.hidden.has(category) && !focused ? 0 : SIZES[category];
      if (focused) size = Math.max(size * 1.6, 5);
      aSize.array[i] = size;
      aFocus.array[i] = !this.focus || focused ? 1 : 0;
      // only highlighted satellites can be clicked while some are highlighted
      this.shown[i] = size > 0 && aFocus.array[i] ? 1 : 0;
    });
    aSize.needsUpdate = aFocus.needsUpdate = true;
  }

  select(index) {
    this.selectedBody = null;
    this.solar.selectSmall(null);
    this.selected = index;
    this.satrec = index >= 0 ? json2satrec(this.records[index]) : null;
    this.orbitTime = null;
    this.lastInfoAt = 0;
    this.marker.visible = this.orbit.visible = index >= 0;
    if (index >= 0) {
      const color = COLORS[this.categories[index]];
      this.marker.material.uniforms.uColor.value.copy(color);
      this.orbit.material.color.copy(color);
    } else {
      this.setFollow(false);
    }
    if (this.follow && index >= 0) this.flyToSatellite();
    this.callbacks.onSelect?.(index);
    this.callbacks.onInfo?.(index >= 0 ? this.info(new Date(this.simNow())) : null);
  }

  setFollow(follow) {
    if (follow === this.follow) return;
    this.follow = follow && this.selected >= 0;
    if (this.follow) {
      if (this.anchor !== 'earth') {
        this.anchor = 'earth';
        this.controls.minDistance = 1.08;
        this.callbacks.onAnchor?.('earth');
      }
      this.flyToSatellite();
    } else {
      const target = this.controls.target.clone();
      const camera = this.camera.position.clone();
      const away = camera.clone().setLength(Math.max(camera.length(), 3.2));
      this.fly(k => {
        this.controls.target.lerpVectors(target, new THREE.Vector3(), k);
        this.camera.position.lerpVectors(camera, away, k);
      });
    }
    this.lastInfoAt = 0;
  }

  // Swing the camera around the Earth until the selected satellite is in front.
  faceSelected(animate = true) {
    if (this.selected < 0 || this.follow) return;
    const result = propagate(this.satrec, new Date(this.simNow()));
    if (!result?.position) return;
    const { x, y, z } = result.position;
    const to = new THREE.Vector3(...toScene(x, y, z, [0, 0, 0]));
    // satellites far out, like the ones 36,000 km up, would end up behind the camera, so back away
    const satDistance = to.length() / EARTH_RADIUS_KM;
    to.normalize();
    if (this.anchor !== 'earth') {
      return this.goTo('earth', { distance: Math.max(HOME_DISTANCE, satDistance * 1.6), direction: () => to });
    }
    const from = this.camera.position.clone().normalize();
    const startDistance = this.camera.position.length();
    const endDistance =
      satDistance * 1.15 > startDistance ? Math.min(this.controls.maxDistance, satDistance * 1.6) : startDistance;
    const turn = new THREE.Quaternion().setFromUnitVectors(from, to);
    const partial = new THREE.Quaternion();
    const place = k => {
      partial.identity().slerp(turn, k);
      const distance = startDistance + (endDistance - startDistance) * k;
      this.camera.position.copy(from).applyQuaternion(partial).multiplyScalar(distance);
    };
    if (animate) this.fly(place);
    else place(1);
  }

  flyToSatellite() {
    const sat = this.satellitePosition(new THREE.Vector3());
    const up = sat.clone().normalize();
    const behind = this.satelliteVelocity(new THREE.Vector3()).normalize().multiplyScalar(-0.22);
    const offset = up.multiplyScalar(0.12).add(behind);
    const target = this.controls.target.clone();
    const camera = this.camera.position.clone();
    this.fly((k, now) => {
      if (!now) return;
      this.controls.target.lerpVectors(target, now, k);
      this.camera.position.lerpVectors(camera, now.clone().add(offset), k);
    });
  }

  // Runs update(progress, selectedSatellitePosition) every frame for duration ms, with easing.
  fly(update, { duration = FLY_MS, done } = {}) {
    this.flight?.done?.();
    this.flight = { update, start: performance.now(), duration, done };
  }

  satellitePosition(out) {
    return out.fromArray(this.points.geometry.attributes.position.array, this.selected * 3);
  }

  satelliteVelocity(out) {
    if (!this.latest) return out.set(0, 0, 0);
    return out.fromArray(this.latest.buffer, this.selected * STRIDE + 3);
  }

  receive(data) {
    // drop results worked out before the clock last changed
    if (data.version !== this.clock.version) {
      this.worker.postMessage({ type: 'recycle', buffer: data.buffer }, [data.buffer.buffer]);
      return;
    }
    if (this.latest) this.worker.postMessage({ type: 'recycle', buffer: this.latest.buffer }, [this.latest.buffer.buffer]);
    this.latest = data;
    const lit = this.points.geometry.attributes.aLit;
    for (let i = 0; i < this.records.length; i++) lit.array[i] = data.buffer[i * STRIDE + 6];
    lit.needsUpdate = true;
  }

  frame() {
    const now = this.simNow();
    const date = new Date(now);
    this.globe.earth.rotation.y = gstime(date);
    this.globe.earth.updateMatrixWorld();
    this.globe.setSun(sunDirection(date));
    // the aurora is only known for about now, so it fades away when the clock is hours off
    const auroraOff = this.auroraNow ? Math.abs(now - this.auroraNow.forecast.getTime()) / 3600000 : Infinity;
    this.aurora.setOpacity(this.auroraHidden ? 0 : 1 - THREE.MathUtils.smoothstep(auroraOff, 3, 6));
    // clouds are a day old, so they fade away when the clock is a few days off
    const cloudsOff = this.clouds.day ? Math.abs(now - Date.parse(`${this.clouds.day}T12:00Z`)) / 86400000 : Infinity;
    this.clouds.setOpacity(this.cloudsHidden ? 0 : 1 - THREE.MathUtils.smoothstep(cloudsOff, 3, 5));
    this.solar.place(now);
    this.globe.setMoon(this.solar.positionOf('moon', this.moonAt ?? (this.moonAt = new THREE.Vector3())));
    // satellites fade out as you zoom out toward the planets
    this.fade = 1 - THREE.MathUtils.smoothstep(this.camera.position.length(), 15, 120);
    // tell the page when the camera moves between the Earth's neighborhood and space
    const zone = this.camera.position.length() > 100 ? 'space' : 'earth';
    if (zone !== this.zone) {
      this.zone = zone;
      this.callbacks.onZone?.(zone);
    }
    if (this.points) this.points.material.uniforms.uFade.value = this.fade;
    this.orbitGroup.visible = this.fade > 0.05;

    if (this.latest) {
      // fill in the motion between worker updates by moving each satellite along its velocity
      const dt = Math.max(-600, Math.min(600, (now - this.latest.time) / 1000));
      const src = this.latest.buffer;
      const dst = this.points.geometry.attributes.position.array;
      for (let i = 0, n = this.records.length; i < n; i++) {
        const o = i * STRIDE;
        const p = i * 3;
        dst[p] = src[o] + src[o + 3] * dt;
        dst[p + 1] = src[o + 1] + src[o + 4] * dt;
        dst[p + 2] = src[o + 2] + src[o + 5] * dt;
      }
      this.points.geometry.attributes.position.needsUpdate = true;
    }

    const sat = this.selected >= 0 && this.latest ? this.satellitePosition(new THREE.Vector3()) : null;
    const anchorAt = this.solar.positionOf(this.anchor, new THREE.Vector3());
    if (this.flight) {
      const { update, start, duration, done } = this.flight;
      const t = Math.min(1, (performance.now() - start) / duration);
      update(ease(t), sat);
      if (t >= 1) {
        this.flight = null;
        done?.();
      }
    } else if (this.follow && sat && this.followFrom) {
      const delta = sat.clone().sub(this.followFrom);
      this.camera.position.add(delta);
      this.controls.target.add(delta);
    } else if (this.anchorFrom) {
      // the Moon and planets move, so carry the camera along with the one we're looking at
      const delta = anchorAt.clone().sub(this.anchorFrom);
      this.camera.position.add(delta);
      this.controls.target.add(delta);
    }
    this.followFrom = sat;
    this.anchorFrom = anchorAt;
    if (sat) this.updateSelection(now, date, sat);
    if (this.selectedBody) this.updateBodySelection(date);
    // orbits drift slowly, so redrawing every simulated hour is plenty
    if (this.groupOrbits.length && (this.groupOrbitsTime == null || Math.abs(now - this.groupOrbitsTime) > 3600000)) {
      this.groupOrbitsTime = now;
      for (const { line, satrec } of this.groupOrbits) {
        drawOrbitLine(line, satrec, now);
      }
    }

    if (this.pointer && this.pointerMoved) {
      this.pointerMoved = false;
      this.hover(this.pick(this.pointer.x, this.pointer.y));
    }

    // spin slower when zoomed in close
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.controls.rotateSpeed = Math.min(0.6, 0.08 + distance * 0.12);
    // zoom faster when far out, so the planets are a few scrolls away and not hundreds
    this.controls.zoomSpeed = 1 + THREE.MathUtils.clamp(Math.log10(distance / 40), 0, 2);
    this.controls.update();
    // keep the near plane in step with the zoom, so planets millions of km away still draw in the right order
    const near = THREE.MathUtils.clamp(this.camera.position.distanceTo(this.controls.target) * 0.001, 0.005, 10000);
    if (Math.abs(near - this.camera.near) > this.camera.near * 0.05) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    // the stars stay around the camera, between the near and far planes
    this.stars.position.copy(this.camera.position);
    this.stars.scale.setScalar(this.camera.near / 0.005);
    this.solar.view(this.camera, this.size.width, this.size.height, this.renderer.getPixelRatio());
    this.renderer.render(this.scene, this.camera);
  }

  updateSelection(now, date, sat) {
    this.marker.geometry.attributes.position.array.set([sat.x, sat.y, sat.z]);
    this.marker.geometry.attributes.position.needsUpdate = true;

    const periodMs = ((2 * Math.PI) / this.satrec.no) * 60000;
    if (this.orbitTime == null || Math.abs(now - this.orbitTime) > periodMs / 40) {
      this.orbitTime = now;
      drawOrbitLine(this.orbit, this.satrec, now);
    }

    if (performance.now() - this.lastInfoAt > 200) {
      this.lastInfoAt = performance.now();
      this.callbacks.onInfo?.(this.info(date));
    }
  }

  info(date) {
    const record = this.records[this.selected];
    const base = {
      index: this.selected,
      name: record.OBJECT_NAME,
      noradId: record.NORAD_CAT_ID,
      launchYear: Number(record.OBJECT_ID.slice(0, 4)) || null,
      category: this.categories[this.selected],
      inclination: record.INCLINATION,
      periodMin: (2 * Math.PI) / this.satrec.no,
      epoch: record.EPOCH,
      following: this.follow
    };
    const result = propagate(this.satrec, date);
    if (!result?.position) return { ...base, lost: true };
    const geo = eciToGeodetic(result.position, gstime(date));
    const v = result.velocity;
    return {
      ...base,
      lat: degreesLat(geo.latitude),
      lon: degreesLong(geo.longitude),
      altitude: geo.height,
      speed: Math.hypot(v.x, v.y, v.z),
      lit: this.latest ? this.latest.buffer[this.selected * STRIDE + 6] : null
    };
  }

  // Returns the closest satellite or body under the pointer, like { type: 'sat', index: 12 }, or null.
  pick(x, y) {
    if (!this.points) return null;
    const { width, height } = this.renderer.domElement.getBoundingClientRect();
    const viewProjection = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const camera = this.camera.position;
    const candidates = [];
    const consider = (e, type, index, px, py, pz) => {
      const w = e[3] * px + e[7] * py + e[11] * pz + e[15];
      if (w <= 0) return;
      const sx = ((e[0] * px + e[4] * py + e[8] * pz + e[12]) / w + 1) * 0.5 * width;
      const sy = (1 - (e[1] * px + e[5] * py + e[9] * pz + e[13]) / w) * 0.5 * height;
      const d2 = (sx - x) ** 2 + (sy - y) ** 2;
      if (d2 < PICK_RADIUS_PX ** 2) candidates.push({ d2, type, index });
    };

    const positions = this.points.geometry.attributes.position.array;
    const lit = this.points.geometry.attributes.aLit.array;
    const e = viewProjection.elements;
    for (let i = 0; i < this.records.length && this.fade > 0.3; i++) {
      if (!this.shown[i] || lit[i] < 0) continue;
      consider(e, 'sat', i, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    }
    for (const spot of this.solar.spots(this.camera, width, height)) {
      const d = Math.hypot(spot.x - x, spot.y - y);
      // a big Moon on screen can be clicked anywhere, but a satellite in front of it still wins
      const big = spot.radiusPx > PICK_RADIUS_PX;
      if (d < Math.max(PICK_RADIUS_PX, spot.radiusPx)) {
        candidates.push({ d2: big ? PICK_RADIUS_PX ** 2 * 0.9 : d * d, type: 'body', id: spot.id, position: spot.position });
      }
    }
    const rock = this.solar.pickRock(x, y, this.camera, width, height, PICK_RADIUS_PX);
    if (rock) candidates.push({ ...rock, type: 'body' });

    candidates.sort((a, b) => a.d2 - b.d2);
    const point = new THREE.Vector3();
    for (const candidate of candidates) {
      if (candidate.type === 'body') {
        if (candidate.id === 'earth' || !behindEarth(camera, candidate.position)) return candidate;
        continue;
      }
      point.fromArray(positions, candidate.index * 3);
      if (!behindEarth(camera, point)) return candidate;
    }
    return null;
  }

  hover(hit) {
    this.renderer.domElement.style.cursor = hit ? 'pointer' : '';
    if (!hit) return this.callbacks.onHover?.(null);
    const name = hit.type === 'body' ? this.solar.nameOf(hit.id) : this.records[hit.index].OBJECT_NAME;
    this.callbacks.onHover?.({ ...hit, name, x: this.pointer.x, y: this.pointer.y });
  }

  listen() {
    const canvas = this.renderer.domElement;
    const local = event => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    canvas.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse') return;
      this.pointer = local(event);
      this.pointerMoved = true;
    });
    canvas.addEventListener('pointerleave', () => {
      this.pointer = null;
      this.hover(-1);
    });
    canvas.addEventListener('pointerdown', event => {
      this.downAt = local(event);
    });
    canvas.addEventListener('pointerup', event => {
      const up = local(event);
      if (!this.downAt || Math.hypot(up.x - this.downAt.x, up.y - this.downAt.y) > 6) return;
      const hit = this.pick(up.x, up.y);
      // the page can take an empty tap for itself, like to shrink the info panel on phones
      const anything = this.selected >= 0 || this.selectedBody;
      if (!hit && anything && this.callbacks.onTapEmpty?.()) return;
      if (hit?.type === 'body') this.selectBody(hit.id);
      else if (hit || anything) this.select(hit ? hit.index : -1);
    });
  }

  resize() {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (!width || !height) return;
    this.size = { width, height };
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    // on tall phone screens, widen the view so the whole globe still fits side to side
    const fitWidth = (2 * Math.atan(Math.tan((22.5 * Math.PI) / 180) / this.camera.aspect) * 180) / Math.PI;
    this.camera.fov = Math.min(80, Math.max(45, fitWidth));
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    clearInterval(this.auroraTimer);
    clearTimeout(this.cloudsTimer);
    this.resizeObserver.disconnect();
    this.worker?.terminate();
    this.solar.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
