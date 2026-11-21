import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { degreesLat, degreesLong, eciToGeodetic, gstime, json2satrec, propagate } from 'satellite.js';
import { CATEGORIES } from '../sats/catalog.js';
import { behindEarth, EARTH_RADIUS_KM, STRIDE, sunDirection, toScene } from '../sats/frames.js';
import { createEarth } from './earth.js';
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

export class Globe {
  constructor(container, { onHover, onSelect, onInfo }) {
    this.container = container;
    this.callbacks = { onHover, onSelect, onInfo };
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
    this.scene.add(this.marker, this.orbit);

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
    if (jumped) this.orbitTime = null;
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

  frame() {
    const now = this.simNow();
    const date = new Date(now);
    this.globe.earth.rotation.y = gstime(date);
    this.globe.setSun(sunDirection(date));

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
    if (this.orbitTime == null || Math.abs(now - this.orbitTime) > periodMs / 40) this.drawOrbit(now, periodMs);

    if (performance.now() - this.lastInfoAt > 200) {
      this.lastInfoAt = performance.now();
      this.callbacks.onInfo?.(this.info(date));
    }
  }

  drawOrbit(now, periodMs) {
    this.orbitTime = now;
    const array = this.orbit.geometry.attributes.position.array;
    for (let k = 0; k <= ORBIT_POINTS; k++) {
      const result = propagate(this.satrec, new Date(now + (k / ORBIT_POINTS) * periodMs));
      if (!result?.position) {
        if (k > 0) array.copyWithin(k * 3, (k - 1) * 3, k * 3);
        continue;
      }
      const { x, y, z } = result.position;
      toScene(x / EARTH_RADIUS_KM, y / EARTH_RADIUS_KM, z / EARTH_RADIUS_KM, array, k * 3);
    }
    this.orbit.geometry.attributes.position.needsUpdate = true;
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

  pick(x, y) {
    if (!this.points) return -1;
    const { width, height } = this.renderer.domElement.getBoundingClientRect();
    const e = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements;
    const positions = this.points.geometry.attributes.position.array;
    const lit = this.points.geometry.attributes.aLit.array;
    const camera = this.camera.position;
    const candidates = [];
    for (let i = 0; i < this.records.length; i++) {
      if (!this.shown[i] || lit[i] < 0) continue;
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      const w = e[3] * px + e[7] * py + e[11] * pz + e[15];
      if (w <= 0) continue;
      const sx = ((e[0] * px + e[4] * py + e[8] * pz + e[12]) / w + 1) * 0.5 * width;
      const sy = (1 - (e[1] * px + e[5] * py + e[9] * pz + e[13]) / w) * 0.5 * height;
      const d2 = (sx - x) ** 2 + (sy - y) ** 2;
      if (d2 < PICK_RADIUS_PX ** 2) candidates.push([d2, i]);
    }
    candidates.sort((a, b) => a[0] - b[0]);
    const point = new THREE.Vector3();
    for (const [, i] of candidates) {
      if (!behindEarth(camera, point.fromArray(positions, i * 3))) return i;
    }
    return -1;
  }

  hover(index) {
    this.renderer.domElement.style.cursor = index >= 0 ? 'pointer' : '';
    this.callbacks.onHover?.(
      index >= 0 ? { index, name: this.records[index].OBJECT_NAME, x: this.pointer.x, y: this.pointer.y } : null
    );
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
      const index = this.pick(up.x, up.y);
      if (index >= 0 || this.selected >= 0) this.select(index);
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
