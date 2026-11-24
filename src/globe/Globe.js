import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { degreesLat, degreesLong, eciToGeodetic, gstime, json2satrec, propagate } from 'satellite.js';
import { CATEGORIES } from '../sats/catalog.js';
import { behindEarth, EARTH_RADIUS_KM, STRIDE, sunDirection, toScene } from '../sats/frames.js';
import { flyPath, pathOf, toLatLon, trackAt } from '../planes/motion.js';
import { createEarth } from './earth.js';
import { createPlanePoints } from './planePoints.js';
import { createSatellitePoints } from './satellitePoints.js';
import { createStars } from './stars.js';

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
const PLANE_SIZE = 5;
// how long planes take to slide onto their new paths when fresh data arrives
const PLANE_BLEND_MS = 3000;
// planes only fly in straight lines, so they fade out when you move this far from the data's time
const PLANE_FADE_START_MS = 5 * 60000;
const PLANE_FADE_END_MS = 10 * 60000;
// the line in front of a selected plane shows where it's headed over the next 10 minutes
const PLANE_AHEAD_S = 600;
const PLANE_AHEAD_POINTS = 32;

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
  constructor(container, { onHover, onSelect, onInfo, onTapEmpty }) {
    this.container = container;
    this.callbacks = { onHover, onSelect, onInfo, onTapEmpty };
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
    this.planeList = [];
    this.planePaths = [];
    // plane times are seconds from here, so they fit in the graphics card's 32-bit numbers
    this.planeBase = Math.floor(Date.now() / 1000);
    this.selectedPlane = null;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.005, 1000);
    this.camera.position.set(0, 1.2, 3.8);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.08;
    this.controls.maxDistance = 40;

    this.globe = createEarth();
    this.scene.add(this.globe.earth, this.globe.glow, createStars());

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

    const aheadGeometry = new THREE.BufferGeometry();
    aheadGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PLANE_AHEAD_POINTS * 3), 3));
    this.planeAhead = new THREE.Line(
      aheadGeometry,
      new THREE.LineDashedMaterial({ dashSize: 0.004, gapSize: 0.003, transparent: true, opacity: 0.7, depthWrite: false })
    );
    this.planeAhead.frustumCulled = false;
    this.planeAhead.visible = false;
    // planes ride on the Earth, so they turn with it
    this.globe.earth.add(this.planeAhead);

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

    // start with the sunrise line in view
    const view = new THREE.Vector3(...sunDirection(new Date(this.simNow())));
    view.applyAxisAngle(new THREE.Vector3(0, 1, 0), 1.0);
    view.y = 0.4;
    this.camera.position.copy(view.normalize().multiplyScalar(3.8));
  }

  // Load a fresh list of planes. Planes we already had slide from their old path to the new one.
  setPlanes(list, dataTime) {
    const old = new Map(this.planeList.map((plane, i) => [plane.icao, this.planePaths[i]]));
    const paths = list.map(plane => pathOf(plane, this.planeBase));
    this.planeOldPaths = list.map((plane, i) => old.get(plane.icao) ?? paths[i]);
    if (this.planePoints) {
      this.globe.earth.remove(this.planePoints);
      this.planePoints.geometry.dispose();
      this.planePoints.material.dispose();
    }
    const points = createPlanePoints(list.length);
    points.material.uniforms.uPixelRatio = this.pixelRatio;
    const a = points.geometry.attributes;
    paths.forEach((path, i) => {
      const before = this.planeOldPaths[i];
      a.aStart.array.set(path.start, i * 3);
      a.aDir.array.set(path.dir, i * 3);
      a.aRate.array[i] = path.rate;
      a.aT0.array[i] = path.t0;
      a.aOldStart.array.set(before.start, i * 3);
      a.aOldDir.array.set(before.dir, i * 3);
      a.aOldRate.array[i] = before.rate;
      a.aOldT0.array[i] = before.t0;
      a.aSize.array[i] = PLANE_SIZE;
    });
    this.planePoints = points;
    this.planeList = list;
    this.planePaths = paths;
    this.planeDataTime = dataTime;
    this.planeBlendStart = old.size ? performance.now() : -Infinity;
    points.visible = !this.hidden?.has('planes');
    this.globe.earth.add(points);
  }

  setHidden(hidden) {
    this.hidden = hidden;
    this.updateSizes();
    if (this.planePoints) this.planePoints.visible = !hidden.has('planes');
    if (hidden.has('planes') && this.selectedPlane) this.selectPlane(null);
  }

  planesShown() {
    return this.planePoints?.visible && this.planePoints.material.uniforms.uOpacity.value > 0.3;
  }

  // Select a plane by its ICAO address, or pass null. Satellites and planes can't both be selected.
  selectPlane(icao) {
    if (icao && this.selected >= 0) this.select(-1);
    this.selectedPlane = icao;
    this.planeAhead.visible = this.marker.visible = !!icao;
    if (icao) this.marker.material.uniforms.uColor.value.set('#ffffff');
    this.lastInfoAt = 0;
    if (!icao) this.callbacks.onInfo?.(null);
  }

  selectedPlaneIndex() {
    if (!this.selectedPlane) return -1;
    if (this.planeList[this.selectedPlaneCache]?.icao !== this.selectedPlane) {
      this.selectedPlaneCache = this.planeList.findIndex(plane => plane.icao === this.selectedPlane);
    }
    return this.selectedPlaneCache;
  }

  // Swing the camera around until the selected plane is in front, and zoom in a little.
  facePlane() {
    const i = this.selectedPlaneIndex();
    if (i < 0) return;
    const to = this.globe.earth.localToWorld(new THREE.Vector3(...flyPath(this.planePaths[i], this.planeTime()))).normalize();
    const from = this.camera.position.clone().normalize();
    const startDistance = this.camera.position.length();
    const endDistance = Math.min(startDistance, 1.6);
    const turn = new THREE.Quaternion().setFromUnitVectors(from, to);
    const partial = new THREE.Quaternion();
    this.fly(k => {
      partial.identity().slerp(turn, k);
      this.camera.position.copy(from).applyQuaternion(partial).multiplyScalar(startDistance + (endDistance - startDistance) * k);
    });
  }

  planeTime() {
    return this.simNow() / 1000 - this.planeBase;
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
    this.selectedPlane = null;
    this.planeAhead.visible = false;
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

  // Runs update(progress, selectedSatellitePosition) every frame for FLY_MS, with easing.
  fly(update) {
    this.flight = { update, start: performance.now() };
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

  // Where plane i is right now and which way it's headed, sliding between paths like the shader does.
  planeNow(i, t, blend) {
    const heading = [0, 0, 0];
    const position = flyPath(this.planePaths[i], t, [0, 0, 0], heading);
    if (blend < 1) {
      const oldHeading = [0, 0, 0];
      const oldPosition = flyPath(this.planeOldPaths[i], t, [0, 0, 0], oldHeading);
      const r = Math.hypot(...this.planePaths[i].start);
      const mixed = position.map((p, k) => oldPosition[k] + (p - oldPosition[k]) * blend);
      const length = Math.hypot(...mixed);
      for (let k = 0; k < 3; k++) {
        position[k] = (mixed[k] / length) * r;
        heading[k] = oldHeading[k] + (heading[k] - oldHeading[k]) * blend;
      }
    }
    return { position, heading };
  }

  updatePlanes(now) {
    const uniforms = this.planePoints.material.uniforms;
    const t = now / 1000 - this.planeBase;
    const blend = Math.min(1, (performance.now() - this.planeBlendStart) / PLANE_BLEND_MS);
    const away = Math.abs(now - this.planeDataTime);
    uniforms.uTime.value = t;
    uniforms.uBlend.value = blend;
    uniforms.uOpacity.value = 1 - THREE.MathUtils.clamp((away - PLANE_FADE_START_MS) / (PLANE_FADE_END_MS - PLANE_FADE_START_MS), 0, 1);
    if (!this.selectedPlane) return;
    const i = this.selectedPlaneIndex();
    // the plane landed or flew out of range since the last update
    if (i < 0) return this.selectPlane(null);

    const { position, heading } = this.planeNow(i, t, blend);
    const world = this.globe.earth.localToWorld(new THREE.Vector3(...position));
    this.marker.geometry.attributes.position.array.set([world.x, world.y, world.z]);
    this.marker.geometry.attributes.position.needsUpdate = true;
    this.marker.visible = this.planeAhead.visible = this.planesShown();

    const path = this.planePaths[i];
    const ahead = this.planeAhead.geometry.attributes.position.array;
    const step = [0, 0, 0];
    for (let k = 0; k < PLANE_AHEAD_POINTS; k++) {
      flyPath(path, t + (k / (PLANE_AHEAD_POINTS - 1)) * PLANE_AHEAD_S, step);
      ahead.set(step, k * 3);
    }
    // start the line at the plane even while it's still sliding onto its new path
    ahead.set(position, 0);
    this.planeAhead.geometry.attributes.position.needsUpdate = true;
    this.planeAhead.computeLineDistances();

    if (performance.now() - this.lastInfoAt > 200) {
      this.lastInfoAt = performance.now();
      const plane = this.planeList[i];
      this.callbacks.onInfo?.({
        type: 'plane',
        ...plane,
        ...toLatLon(position),
        track: trackAt(position, heading),
        shown: this.planesShown()
      });
    }
  }

  frame() {
    const now = this.simNow();
    const date = new Date(now);
    this.globe.earth.rotation.y = gstime(date);
    this.globe.earth.updateMatrixWorld();
    this.globe.setSun(sunDirection(date));
    if (this.planePoints) this.updatePlanes(now);

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
    if (this.flight) {
      const t = Math.min(1, (performance.now() - this.flight.start) / FLY_MS);
      this.flight.update(ease(t), sat);
      if (t >= 1) this.flight = null;
    } else if (this.follow && sat && this.followFrom) {
      const delta = sat.clone().sub(this.followFrom);
      this.camera.position.add(delta);
      this.controls.target.add(delta);
    }
    this.followFrom = sat;
    if (sat) this.updateSelection(now, date, sat);
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
    this.controls.update();
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

  // Returns the closest satellite or plane under the pointer, like { type: 'plane', index: 12 }, or null.
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
    let e = viewProjection.elements;
    for (let i = 0; i < this.records.length; i++) {
      if (!this.shown[i] || lit[i] < 0) continue;
      consider(e, 'sat', i, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    }
    if (this.planesShown()) {
      // plane positions are in the Earth's frame, so fold the Earth's turn into the matrix
      e = viewProjection.clone().multiply(this.globe.earth.matrixWorld).elements;
      const t = this.planeTime();
      const p = [0, 0, 0];
      for (let i = 0; i < this.planePaths.length; i++) {
        flyPath(this.planePaths[i], t, p);
        consider(e, 'plane', i, p[0], p[1], p[2]);
      }
    }

    candidates.sort((a, b) => a.d2 - b.d2);
    const point = new THREE.Vector3();
    for (const candidate of candidates) {
      if (candidate.type === 'sat') point.fromArray(positions, candidate.index * 3);
      else this.globe.earth.localToWorld(point.fromArray(flyPath(this.planePaths[candidate.index], this.planeTime())));
      if (!behindEarth(camera, point)) return candidate;
    }
    return null;
  }

  hover(hit) {
    this.renderer.domElement.style.cursor = hit ? 'pointer' : '';
    if (!hit) return this.callbacks.onHover?.(null);
    const name =
      hit.type === 'sat'
        ? this.records[hit.index].OBJECT_NAME
        : this.planeList[hit.index].callsign || this.planeList[hit.index].icao.toUpperCase();
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
      if (!hit && (this.selected >= 0 || this.selectedPlane) && this.callbacks.onTapEmpty?.()) return;
      if (hit?.type === 'plane') this.selectPlane(this.planeList[hit.index].icao);
      else if (hit || this.selected >= 0 || this.selectedPlane) this.select(hit ? hit.index : -1);
    });
  }

  resize() {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (!width || !height) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    // on tall phone screens, widen the view so the whole globe still fits side to side
    const fitWidth = (2 * Math.atan(Math.tan((22.5 * Math.PI) / 180) / this.camera.aspect) * 180) / Math.PI;
    this.camera.fov = Math.min(80, Math.max(45, fitWidth));
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.worker?.terminate();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
