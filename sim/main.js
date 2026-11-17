import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { Simulation, ROOM, GRID, ZONE, BANDS, SCENARIOS, SEAT_COLS } from './engine.js';

const $ = (id) => document.getElementById(id);
const COLORS = ['#ff6b6b', '#4aa3ff', '#ffd166', '#7bdc7b', '#d36bff', '#4de1d2', '#ff9ecb', '#c0c0c0'];
const LEVEL = ['제외', '관찰', '주의', '경고'];
const LEVEL_COLOR = ['#8e9bbd', '#4fd18b', '#ffc04d', '#ff5d5d'];

// ---------- 상태 ----------
let sim, playing = true, seed = 1, lastFrame = performance.now(), lastPanel = 0;
const ui = { scenario: $('scenario'), sensors: $('sensors'), calib: $('calib'), speed: $('speed'),
  truth: $('truth'), heat: $('heat'), links: $('links') };
for (const [k, v] of Object.entries(SCENARIOS)) ui.scenario.add(new Option(v.name, k));
ui.scenario.value = 'multi';

// ---------- Three.js 기본 ----------
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1020);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(6, 12.5, 15.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(6, 0.8, 4.4);
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();
scene.add(new THREE.AmbientLight(0xffffff, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(5, 12, 4);
scene.add(sun);

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// 교실 골격
const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x18213d, roughness: 1 }));
floor.position.set(ROOM.w / 2, 0, ROOM.d / 2);
scene.add(floor);
const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(ROOM.w, ROOM.h, ROOM.d)),
  new THREE.LineBasicMaterial({ color: 0x3b4b7d }));
box.position.set(ROOM.w / 2, ROOM.h / 2, ROOM.d / 2);
scene.add(box);
const board = new THREE.Mesh(new THREE.BoxGeometry(4, 1.1, 0.05), new THREE.MeshStandardMaterial({ color: 0x1f5d46 }));
board.position.set(6, 1.6, 0.03);
scene.add(board);
const zoneMesh = new THREE.Mesh(new THREE.PlaneGeometry(ZONE.x1 - ZONE.x0, ZONE.z1 - ZONE.z0).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x4fd18b, transparent: true, opacity: 0.18 }));
zoneMesh.position.set((ZONE.x0 + ZONE.x1) / 2, 0.015, (ZONE.z0 + ZONE.z1) / 2);
scene.add(zoneMesh);

function makeLabel(text, color = '#ffffff', scale = 1) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(2.4 * scale, 0.6 * scale, 1);
  spr.userData.set = (t, col) => {
    if (spr.userData.last === t + col) return; spr.userData.last = t + col;
    const g = c.getContext('2d'); g.clearRect(0, 0, 256, 64);
    g.fillStyle = '#0b1020cc'; g.roundRect(6, 10, 244, 44, 10); g.fill();
    g.fillStyle = col; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 128, 33);
    tex.needsUpdate = true;
  };
  spr.userData.set(text, color);
  return spr;
}
const zoneLabel = makeLabel('감독관석(제외)', '#4fd18b', 0.8); zoneLabel.position.set(6, 0.5, 0.7); scene.add(zoneLabel);
const frontLabel = makeLabel('앞(칠판)', '#9fb4ff', 0.8); frontLabel.position.set(6, 2.6, 0.2); scene.add(frontLabel);

// 열지도 텍스처
const heatCanvas = document.createElement('canvas'); heatCanvas.width = GRID.nx; heatCanvas.height = GRID.nz;
const heatTex = new THREE.CanvasTexture(heatCanvas); heatTex.magFilter = THREE.LinearFilter;
const heatMesh = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w + GRID.step, ROOM.d + GRID.step).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ map: heatTex, transparent: true, depthWrite: false }));
heatMesh.position.set(ROOM.w / 2, 0.03, ROOM.d / 2);
scene.add(heatMesh);

function drawHeat() {
  const g = heatCanvas.getContext('2d'), img = g.createImageData(GRID.nx, GRID.nz);
  let max = 1e-6; for (const v of sim.heat) if (v > max) max = v;
  for (let i = 0; i < sim.heat.length; i++) {
    const v = Math.min(1, sim.heat[i] / max), o = i * 4;
    img.data[o] = 255; img.data[o + 1] = Math.round(220 * (1 - v)); img.data[o + 2] = 40;
    img.data[o + 3] = Math.round(Math.pow(v, 1.3) * 190);
  }
  g.putImageData(img, 0, 0); heatTex.needsUpdate = true;
}

// ---------- 동적 오브젝트 ----------
let dyn = new THREE.Group(); scene.add(dyn);
let trackViz = new Map(), truthViz = [], ripples = [], seatMeshes = [];

function buildWorld() {
  scene.remove(dyn); dyn = new THREE.Group(); scene.add(dyn);
  trackViz = new Map(); ripples = []; truthViz = []; seatMeshes = [];
  const deskMat = new THREE.MeshStandardMaterial({ color: 0x2b3a66 });
  for (const s of sim.seats) {
    const desk = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.5), deskMat);
    desk.position.set(s.x, 0.72, s.z - 0.35); dyn.add(desk);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.6, 12), new THREE.MeshStandardMaterial({ color: 0x6b7aa8 }));
    body.position.set(s.x, 0.75, s.z + 0.15); dyn.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 14), new THREE.MeshStandardMaterial({ color: 0x8fa0d0 }));
    head.position.set(s.x, 1.22, s.z + 0.15); dyn.add(head);
    seatMeshes.push([body, head]);
  }
  const sMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0a6d7d });
  for (const s of sim.sensors) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.14), sMat);
    m.position.set(s.x, s.y, s.z); dyn.add(m);
    const l = makeLabel(`S${s.id}`, '#22d3ee', 0.45); l.position.set(s.x, s.y + 0.3, s.z); dyn.add(l);
  }
  for (const e of sim.emitters) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), new THREE.MeshBasicMaterial({ color: e.cheat ? 0xff5d5d : 0x4fd18b, wireframe: true }));
    g.add(m);
        g.position.set(e.pos.x, e.pos.y, e.pos.z); dyn.add(g); g.visible = false;
    const err = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xffe066 }));
    dyn.add(err); err.visible = false;
    truthViz.push({ e, g, err });
  }
}

function ensureTrackViz(tr) {
  let v = trackViz.get(tr.key);
  if (v) return v;
  const idx = trackViz.size, col = new THREE.Color(BANDS[tr.band].color);
  const group = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 16), new THREE.MeshBasicMaterial({ color: col }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.07, depthWrite: false }));
  const pole = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1, 0)]),
    new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.5 }));
  const label = makeLabel(tr.name, '#fff', 0.6); label.position.y = 0.5;
  group.add(core, halo, pole, label);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sim.sensors.length * 6), 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.45 }));
  lines.frustumCulled = false;
  dyn.add(group, lines);
  group.visible = false;
  v = { group, core, halo, pole, label, lines, idx, ready: false };
  trackViz.set(tr.key, v);
  return v;
}

function spawnRipple(pos, color) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  m.position.copy(pos); dyn.add(m); ripples.push({ m, t0: performance.now() });
}

// ---------- 갱신 ----------
function syncScene(now) {
  const lastRipple = syncScene.lr || (syncScene.lr = new Map());
  for (const ev of sim.events.splice(0)) {
    const tr = sim.tracks.get(ev.key), v = trackViz.get(ev.key);
    if (!tr || !v || !v.ready || (lastRipple.get(ev.key) || 0) > now - 450 || ripples.length > 14) continue;
    lastRipple.set(ev.key, now);
    spawnRipple(v.group.position, new THREE.Color(BANDS[ev.band].color));
  }
  for (const tr of sim.tracks.values()) {
    const v = ensureTrackViz(tr);
    if (!tr.est) continue;
    const target = new THREE.Vector3(tr.est.x, tr.est.y, tr.est.z);
    if (!v.ready) { v.group.position.copy(target); v.ready = true; v.group.visible = true; }
    else v.group.position.lerp(target, 0.15);
    const rh = Math.max(0.25, tr.est.rH * 1.5), rv = Math.max(0.2, tr.est.rV * 1.5);
    v.halo.scale.set(rh, rv, rh);
    v.pole.scale.y = v.group.position.y;
    const c = tr.excluded ? 0 : tr.level;
    v.label.userData.set(`${tr.name} ${LEVEL[c]} ${tr.risk}`, LEVEL_COLOR[c]);
    v.core.scale.setScalar(1 + (sim.t - tr.lastOnT < 0.5 ? 0.6 : 0));
    // 센서 수신선: 최근 송신 시에만 표시
    const pos = v.lines.geometry.attributes.position, recent = sim.t - tr.lastOnT < 0.7 && ui.links.checked;
    sim.sensors.forEach((s, i) => {
      const hit = recent && tr.lastRssi[i] != null;
      pos.setXYZ(i * 2, s.x, s.y, s.z);
      pos.setXYZ(i * 2 + 1, hit ? v.group.position.x : s.x, hit ? v.group.position.y : s.y, hit ? v.group.position.z : s.z);
    });
    pos.needsUpdate = true;
  }
  for (const r of ripples.slice()) {
    const a = (now - r.t0) / 1100;
    if (a >= 1) { dyn.remove(r.m); ripples.splice(ripples.indexOf(r), 1); continue; }
    r.m.scale.setScalar(0.25 + a * 1.4); r.m.material.opacity = 0.7 * (1 - a);
  }
  const showTruth = ui.truth.checked;
  const cheatSeats = new Set(sim.emitters.filter((e) => e.cheat && e.seat).map((e) => e.seat.idx));
  seatMeshes.forEach((m, i) => m.forEach((o) => o.material.color.setHex(showTruth && cheatSeats.has(i) ? 0xb84a4a : o === m[0] ? 0x6b7aa8 : 0x8fa0d0)));
  for (const t of truthViz) {
    t.g.visible = showTruth;
    const tr = sim.tracks.get(t.e.id), v = trackViz.get(t.e.id);
    t.err.visible = showTruth && !!(tr && tr.est && v && v.ready);
    if (t.err.visible) t.err.geometry.setFromPoints([new THREE.Vector3(t.e.pos.x, t.e.pos.y, t.e.pos.z), v.group.position]);
  }
  for (const v of trackViz.values()) v.halo.visible = true;
  heatMesh.visible = ui.heat.checked;
}

const fmt = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function drawPanel() {
  $('clock').textContent = fmt(sim.t);
  const tracks = [...sim.tracks.values()];
  const showTruth = ui.truth.checked;
  $('tracks').innerHTML = tracks.length ? `<table><tr><th>ID</th><th>유형 추정 / 위험도</th><th>후보 좌석(확률)</th>${showTruth ? '<th>오차</th>' : ''}</tr>` +
    tracks.map((tr) => {
      const lv = tr.excluded ? 0 : tr.level, seats = tr.est ? tr.est.seats.filter((s) => s.p > 0.08).map((s) => `${s.id} (${Math.round(s.p * 100)}%)`).join('<br>') : '측위 불가';
      let tcol = '';
      if (showTruth) { const t = sim.truthFor(tr); tcol = `<td>${t ? `${t.errH.toFixed(2)}m<br>${t.top1 === null ? '' : t.top1 ? '✓ 1순위' : t.top3 ? '△ 3순위내' : '✗ 빗나감'}` : '-'}</td>`; }
      return `<tr><td><b>${tr.name}</b><br><span class="chip" style="background:${BANDS[tr.band].color}">${BANDS[tr.band].name}</span></td>
        <td class="lv${lv}">${tr.cls}<br><span class="note">${tr.tags.join(' · ') || '&nbsp;'} · 활동 ${Math.round((tr.duty || 0) * 100)}%</span>
        <div class="bar"><b style="width:${tr.risk}%;background:${LEVEL_COLOR[lv]}"></b></div>
        <span class="note">${LEVEL[lv]} · 위험도 ${tr.risk}${tr.est ? ` · ±${tr.est.rH.toFixed(1)}m` : ''}</span></td>
        <td>${seats}</td>${tcol}</tr>`;
    }).join('') + '</table>' : '<div class="empty">아직 탐지된 송신원이 없습니다.</div>';
  $('alerts').innerHTML = sim.alerts.length ? sim.alerts.slice(0, 40).map((a) =>
    `<div><span class="lv${a.level}">[${fmt(a.t)}] ${a.name} ${a.label}</span> — ${a.text}</div>`).join('') : '<div class="empty">경보 없음</div>';
  drawTimeline(tracks);
  drawHeat();
}

function drawTimeline(tracks) {
  const c = $('timeline'), g = c.getContext('2d'), W = c.width, H = c.height;
  g.clearRect(0, 0, W, H); g.strokeStyle = '#243052'; g.lineWidth = 1;
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, (H * i) / 4); g.lineTo(W, (H * i) / 4); g.stroke(); }
  tracks.forEach((tr, k) => {
    g.strokeStyle = COLORS[k % COLORS.length]; g.lineWidth = 1.5; g.beginPath();
    const n = tr.history.length, off = 180 - n;
    tr.history.forEach((v, i) => { const x = ((off + i) / 179) * W, y = H - 4 - Math.min(1, v) * (H - 8); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke(); g.fillStyle = COLORS[k % COLORS.length]; g.font = '11px sans-serif'; g.fillText(tr.name, 4 + k * 30, 12);
  });
}

function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  if (playing) sim.advance(Math.min(dt * Number(ui.speed.value), 6));
  syncScene(now);
  if (now - lastPanel > 400) { lastPanel = now; drawPanel(); }
  controls.update(); renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function start() {
  sim = new Simulation({ seed, sensorCount: Number(ui.sensors.value), calibrated: ui.calib.checked, scenario: ui.scenario.value });
  $('sensorN').textContent = ui.sensors.value;
  buildWorld(); drawPanel();
}
ui.scenario.onchange = ui.sensors.oninput = ui.calib.onchange = start;
$('reset').onclick = start;
$('reseed').onclick = () => { seed++; start(); };
$('play').onclick = () => { playing = !playing; $('play').textContent = playing ? '일시정지' : '재생'; };
for (const k of ['truth', 'heat', 'links']) ui[k].onchange = () => drawPanel();

resize(); start(); requestAnimationFrame(frame);
window.__sim = () => sim; // 디버깅/검증용
