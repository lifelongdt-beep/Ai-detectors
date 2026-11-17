// 인스타 릴스용 홍보영상 렌더러 (1080x1920, 30fps, 20초). 프레임은 시간 t의 순수 함수.
// 사용: render.mjs 가 window.setup() 후 window.frame(i) 를 순서대로 호출한다.
import * as THREE from 'three';
import { Simulation, ROOM, GRID, BANDS } from '../sim/engine.js';

const W = 1080, H = 1920, FPS = 30, DUR = 20;
const BPM = 96, BEAT = 60 / BPM, STEP = BEAT / 4, BAR = BEAT * 4;
const C = { bg: '#07080f', cyan: '#22d3ee', mag: '#ff3df2', lime: '#c6ff3d', red: '#ff3b5c', yellow: '#ffe066', white: '#ffffff', dim: '#8e9bbd' };

const cv = document.getElementById('c');
const ctx = cv.getContext('2d');

// ---------- 유틸 ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOutExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const seg = (t, a, b) => clamp((t - a) / (b - a));
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// 오디오(audio.py)와 같은 킥/스네어 위치 -> 비주얼 펄스
const KICKS = {}, SNARES = {};
for (let b = 0; b < 8; b++) {
  KICKS[b] = b === 0 ? [0] : b === 1 ? [0, 10] : b === 4 ? [0, 8] : b === 7 ? [0] : b % 2 === 0 ? [0, 7, 10] : [0, 6, 10, 14];
  SNARES[b] = [2, 3, 5, 6].includes(b) ? [4, 12] : b === 4 ? [8] : [];
}
const kickTimes = [], snareTimes = [];
for (let b = 0; b < 8; b++) { KICKS[b].forEach((s) => kickTimes.push(b * BAR + s * STEP)); SNARES[b].forEach((s) => snareTimes.push(b * BAR + s * STEP)); }
function pulse(t, times, decay) { let p = 0; for (const k of times) { const d = t - k; if (d >= 0 && d < 1) p = Math.max(p, Math.exp(-d * decay)); } return p; }

// ---------- 텍스트 ----------
function text(s, x, y, o = {}) {
  const { size = 100, fill = C.white, stroke = null, sw = 0, align = 'center', alpha = 1, rot = 0, sx = 1, sy = 1, rgb = 0, shadow = null, base = 'middle', italic = false } = o;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sx, sy);
  if (italic) ctx.transform(1, 0, -0.18, 1, 0, 0);
  ctx.font = `${size}px "Black Han Sans"`; ctx.textAlign = align; ctx.textBaseline = base; ctx.globalAlpha = alpha;
  if (rgb > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ff0040'; ctx.fillText(s, -rgb, 0);
    ctx.fillStyle = '#00e5ff'; ctx.fillText(s, rgb, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (shadow) { ctx.shadowColor = shadow; ctx.shadowBlur = size * 0.3; }
  if (stroke) { ctx.lineWidth = sw; ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.strokeText(s, 0, 0); }
  ctx.fillStyle = fill; ctx.fillText(s, 0, 0);
  ctx.restore();
}
function fitSize(s, maxW, size) { ctx.font = `${size}px "Black Han Sans"`; const w = ctx.measureText(s).width; return w > maxW ? size * maxW / w : size; }
// 슬램 등장: 시작 시각 t0 에서 scale 크게 -> 1, 알파 0 -> 1
function slam(t, t0, dur = 0.22) { const k = seg(t, t0, t0 + dur); return { vis: t >= t0, k, scale: t >= t0 ? lerp(2.2, 1, easeOutExpo(k)) : 1, alpha: t >= t0 ? clamp(k * 5) : 0 }; }
function rect(x, y, w, h, fill, r = 0, alpha = 1) { ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); ctx.restore(); }

// ---------- 배경 ----------
function background(t, rng, accent) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#05060d'); g.addColorStop(0.5, '#0b0e1d'); g.addColorStop(1, '#05060d');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 원근 격자(바닥) - 박자에 맞춰 앞으로 흐름
  ctx.save(); ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.globalAlpha = 0.28;
  const hor = 1100, off = ((t / BEAT) % 1);
  for (let i = 0; i < 16; i++) { const k = (i + off) / 16, y = hor + (H - hor) * k * k; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  for (let i = -12; i <= 12; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 40, hor); ctx.lineTo(W / 2 + i * 260, H); ctx.stroke(); }
  ctx.restore();
  // 상단 격자 (천장 느낌)
  ctx.save(); ctx.strokeStyle = accent; ctx.globalAlpha = 0.12; ctx.lineWidth = 2;
  for (let i = 0; i < 10; i++) { const k = (i + off) / 10, y = 700 - 700 * k * k; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();
}
function overlayFX(t, rng, pulseK) {
  // 스캔라인 + 비네트 + 그레인
  ctx.save(); ctx.globalAlpha = 0.06; ctx.fillStyle = '#000';
  for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 2);
  ctx.restore();
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.65)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = 0.07;
  for (let i = 0; i < 260; i++) { ctx.fillStyle = rng() > 0.5 ? '#fff' : '#000'; ctx.fillRect(rng() * W, rng() * H, 3, 3); }
  ctx.restore();
  // 가끔 가로 글리치 띠
  if (pulseK > 0.55) { const y = rng() * H, h = 20 + rng() * 60; ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = rng() > 0.5 ? C.cyan : C.mag; ctx.fillRect(0, y, W, h); ctx.restore(); }
}
function hudCorners(color = C.cyan, inset = 40, len = 70) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.globalAlpha = 0.9;
  for (const [x, y, dx, dy] of [[inset, inset + 150, 1, 1], [W - inset, inset + 150, -1, 1], [inset, H - inset - 380, 1, -1], [W - inset, H - inset - 380, -1, -1]]) {
    ctx.beginPath(); ctx.moveTo(x, y + dy * len); ctx.lineTo(x, y); ctx.lineTo(x + dx * len, y); ctx.stroke();
  }
  ctx.restore();
}

// ---------- 3D 시뮬레이터 장면 ----------
let sim, three, heatTex, heatCanvas, trackViz = new Map(), simClock = 0, pulses = new Map(), estSince = new Map();
const SIM_SEED = 4;
const simTime = (t) => 20 + Math.max(0, t - 5) * 10; // 영상 5초부터 10배속: 시뮬레이션 20s -> 120s
const SIM_RANGE = [5, 15];

function build3D() {
  const R = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  R.setPixelRatio(1); R.setSize(1080, 1020); R.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1080 / 1020, 0.1, 100);
  scene.add(new THREE.AmbientLight(0xffffff, 0.95));
  const sun = new THREE.DirectionalLight(0xbfd8ff, 0.9); sun.position.set(5, 12, 4); scene.add(sun);

  // 바닥 격자 + 방 윤곽
  const pts = [];
  for (let x = 0; x <= ROOM.w; x++) pts.push(x, 0.01, 0, x, 0.01, ROOM.d);
  for (let z = 0; z <= ROOM.d; z++) pts.push(0, 0.01, z, ROOM.w, 0.01, z);
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x23406e, transparent: true, opacity: 0.8 })));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0b1226 }));
  floor.position.set(ROOM.w / 2, 0, ROOM.d / 2); scene.add(floor);
  const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(ROOM.w, ROOM.h, ROOM.d)), new THREE.LineBasicMaterial({ color: 0x3fa9ff }));
  box.position.set(ROOM.w / 2, ROOM.h / 2, ROOM.d / 2); scene.add(box);
  const board = new THREE.Mesh(new THREE.BoxGeometry(4, 1.1, 0.05), new THREE.MeshBasicMaterial({ color: 0x14634a }));
  board.position.set(6, 1.6, 0.03); scene.add(board);

  const deskM = new THREE.MeshStandardMaterial({ color: 0x2b3a66 }), bodyM = new THREE.MeshStandardMaterial({ color: 0x6b7aa8 }), headM = new THREE.MeshStandardMaterial({ color: 0x9db0e0 });
  for (const s of sim.seats) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.5), deskM); d.position.set(s.x, 0.72, s.z - 0.35); scene.add(d);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.6, 12), bodyM); b.position.set(s.x, 0.75, s.z + 0.15); scene.add(b);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 14), headM); h.position.set(s.x, 1.22, s.z + 0.15); scene.add(h);
  }
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,255,255,0.35)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const sensorViz = [];
  for (const s of sim.sensors) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: 0x22d3ee })); m.position.set(s.x, s.y, s.z); scene.add(m);
    const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x22d3ee, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })); gl.scale.set(1.1, 1.1, 1); gl.position.copy(m.position); scene.add(gl);
    sensorViz.push({ s, m });
  }
  // 열지도
  heatCanvas = document.createElement('canvas'); heatCanvas.width = GRID.nx; heatCanvas.height = GRID.nz;
  heatTex = new THREE.CanvasTexture(heatCanvas); heatTex.magFilter = THREE.LinearFilter;
  const hm = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w + GRID.step, ROOM.d + GRID.step).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: heatTex, transparent: true, depthWrite: false }));
  hm.position.set(ROOM.w / 2, 0.03, ROOM.d / 2); scene.add(hm);
  three = { R, scene, camera, glowTex, sensorViz, heatMesh: hm, ripples: [] };
}

function label3D(text, color) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 96;
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(3.2, 0.96, 1);
  spr.userData.set = (t, col) => {
    if (spr.userData.last === t + col) return; spr.userData.last = t + col;
    const g = c.getContext('2d'); g.clearRect(0, 0, 320, 96);
    g.fillStyle = 'rgba(7,8,15,0.85)'; g.beginPath(); g.roundRect(6, 14, 308, 68, 18); g.fill();
    g.strokeStyle = col; g.lineWidth = 4; g.stroke();
    g.fillStyle = col; g.font = '40px "Black Han Sans"'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 160, 50);
    tex.needsUpdate = true;
  };
  spr.userData.set(text, color);
  return spr;
}
const LV = ['제외', '관찰', '주의', '경고'], LVC = ['#8e9bbd', '#4fd18b', '#ffc04d', '#ff3b5c'];

function trackVizFor(tr) {
  let v = trackViz.get(tr.key);
  if (v) return v;
  const col = new THREE.Color(BANDS[tr.band].color);
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), new THREE.MeshBasicMaterial({ color: col }));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: three.glowTex, color: col, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })); glow.scale.set(2.2, 2.2, 1);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.1, depthWrite: false }));
  const pole = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1, 0)]), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.6 }));
  const label = label3D(tr.name); label.position.y = 0.85;
  g.add(core, glow, halo, pole, label); three.scene.add(g);
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sim.sensors.length * 6), 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.7 })); lines.frustumCulled = false; three.scene.add(lines);
  v = { g, core, glow, halo, pole, label, lines, color: col };
  trackViz.set(tr.key, v);
  return v;
}

let lastEvT = -1;
function stepSim(target) {
  while (simClock < target - 1e-9) {
    sim.step(); simClock = sim.t;
    for (const tr of sim.tracks.values()) if (tr.est && !estSince.has(tr.key)) estSince.set(tr.key, sim.t); // 처음 위치가 잡힌 시각(워커/순서와 무관하게 결정적)
    for (const ev of sim.events.splice(0)) {
      const tr = sim.tracks.get(ev.key); if (!tr) continue;
      let list = pulses.get(ev.key); if (!list) { list = []; pulses.set(ev.key, list); }
      if (!list.length || ev.t - list[list.length - 1].t >= 4.5) list.push({ t: ev.t, rssi: tr.lastRssi.slice() });
    }
  }
}

function update3D(t, mode) {
  const st = simTime(t);
  stepSim(st);
  const { R, scene, camera } = three;
  const kp = pulse(t, kickTimes, 7);
  // 카메라
  const target = new THREE.Vector3(6, 0.8, 4.4);
  if (mode === 'orbit') {
    const k = easeInOut(seg(t, 5, 10));
    const a = lerp(-0.55, 2.55, k), r = lerp(15.5, 11.5, k) - kp * 0.7, h = lerp(8.6, 6.2, k);
    camera.position.set(6 + Math.sin(a) * r, h, 4.4 + Math.cos(a) * r);
  } else {
    const k = seg(t, 10, 12.5);
    camera.position.set(6 + Math.sin(0.3 + k * 0.4) * 1.6, lerp(18.5, 14.8, easeOutExpo(k)) - kp * 0.4, 5.4);
    target.set(6, 0, 4.4);
  }
  camera.fov = 46 - kp * 3; camera.updateProjectionMatrix(); camera.lookAt(target);
  // 열지도
  const g2 = heatCanvas.getContext('2d'), img = g2.createImageData(GRID.nx, GRID.nz);
  let max = 1e-6; for (const v of sim.heat) if (v > max) max = v;
  const heatBoost = mode === 'top' ? 1.0 : 0.75;
  for (let i = 0; i < sim.heat.length; i++) { const v = Math.min(1, sim.heat[i] / max), o = i * 4; img.data[o] = 255; img.data[o + 1] = Math.round(210 * (1 - v)); img.data[o + 2] = 40; img.data[o + 3] = Math.round(Math.pow(v, 1.2) * 230 * heatBoost); }
  g2.putImageData(img, 0, 0); heatTex.needsUpdate = true;
  // 송신원
  const tNow = sim.t;
  for (const tr of sim.tracks.values()) {
    const v = trackVizFor(tr);
    if (!tr.est) { v.g.visible = false; continue; }
    v.g.visible = true; v.g.position.set(tr.est.x, tr.est.y, tr.est.z);
    const age = (tNow - (estSince.get(tr.key) ?? tNow)) / 10; // 영상 초
    const pop = easeOutBack(clamp(age / 0.35));
    const rh = Math.max(0.3, tr.est.rH * 1.4);
    v.halo.scale.set(rh * pop, Math.max(0.25, tr.est.rV * 1.4) * pop, rh * pop);
    v.pole.scale.y = v.g.position.y;
    const lv = tr.excluded ? 0 : tr.level;
    v.label.userData.set(`${tr.name} ${LV[lv]} ${tr.risk}`, LVC[lv]);
    v.core.scale.setScalar(pop * (1 + 0.35 * kp));
    v.glow.scale.setScalar(2.2 * pop * (1 + 0.35 * kp));
    // 수신선: 펄스 직후 0.35초만
    const list = pulses.get(tr.key) || [], pos = v.lines.geometry.attributes.position;
    let lastP = null; for (let i = list.length - 1; i >= 0; i--) { if (list[i].t <= tNow) { lastP = list[i]; break; } }
    const on = lastP && (tNow - lastP.t) / 10 < 0.35;
    sim.sensors.forEach((s, i) => {
      const hit = on && lastP.rssi[i] != null;
      pos.setXYZ(i * 2, s.x, s.y, s.z); pos.setXYZ(i * 2 + 1, hit ? tr.est.x : s.x, hit ? tr.est.y : s.y, hit ? tr.est.z : s.z);
    });
    pos.needsUpdate = true;
  }
  // 파문
  for (const r of three.ripples) scene.remove(r.m); three.ripples = [];
  for (const tr of sim.tracks.values()) {
    const v = trackViz.get(tr.key); if (!v || !tr.est) continue;
    for (const p of pulses.get(tr.key) || []) {
      const age = (tNow - p.t) / 10; if (age < 0 || age > 1.0) continue;
      const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: v.color, transparent: true, opacity: 0.85 * (1 - age), side: THREE.DoubleSide, depthWrite: false }));
      m.position.set(tr.est.x, 0.06, tr.est.z); m.scale.setScalar(0.3 + age * 3.2); scene.add(m); three.ripples.push({ m });
    }
  }
  three.heatMesh.visible = true;
  R.render(scene, camera);
}

// ---------- 장면 ----------
function sceneHook(t, rng, kp) {
  background(t, C.mag, C.mag);
  // CCTV 느낌 HUD
  const blink = Math.floor(t / 0.3125) % 2 === 0;
  if (blink) { ctx.fillStyle = C.red; ctx.beginPath(); ctx.arc(110, 300, 14, 0, 7); ctx.fill(); }
  text('REC', 150, 300, { size: 44, align: 'left', fill: C.red });
  const tc = `CAM-03  ${String(4 + Math.floor(t / 60)).padStart(2, '0')}:${String(15 + Math.floor(t)).padStart(2, '0')}:${String(Math.floor((t % 1) * 30)).padStart(2, '0')}`;
  text(tc, W - 70, 300, { size: 40, align: 'right', fill: C.dim });
  hudCorners(C.mag);
  const l1 = slam(t, 0.0, 0.25), l2 = slam(t, BEAT, 0.25), l3 = slam(t, BEAT * 2, 0.25);
  if (l1.vis) text('수능 시험장', W / 2, 640, { size: fitSize('수능 시험장', 900, 150), alpha: l1.alpha, sx: l1.scale, sy: l1.scale, rgb: 10 * (1 - l1.k) + 3, stroke: '#000', sw: 14 });
  if (l2.vis) text('AI 컷닝', W / 2, 930, { size: fitSize('AI 컷닝', 980, 330), fill: C.mag, alpha: l2.alpha, sx: l2.scale, sy: l2.scale, rgb: 14 * (1 - l2.k) + 4, stroke: '#000', sw: 18, shadow: C.mag });
  if (l3.vis) text('시도 중?', W / 2, 1230, { size: fitSize('시도 중?', 900, 200), fill: C.cyan, alpha: l3.alpha, sx: l3.scale, sy: l3.scale, rgb: 8 * (1 - l3.k) + 3, stroke: '#000', sw: 14, shadow: C.cyan });
  // 1.875~: 신호 끊김 느낌 글리치 블록
  if (t > BEAT * 3) { const k = seg(t, BEAT * 3, BAR); for (let i = 0; i < 6; i++) { ctx.save(); ctx.globalAlpha = 0.25 * k; ctx.fillStyle = i % 2 ? C.cyan : C.mag; ctx.fillRect(rng() * W, 400 + rng() * 900, 200 + rng() * 500, 8 + rng() * 30); ctx.restore(); } }
}

function sceneRadar(t, rng, kp, sk) {
  background(t, C.cyan, C.cyan);
  const lt = t - BAR; // 0..2.5
  const cx = W / 2, cy = 800;
  hudCorners(C.cyan);
  // 링: 박자마다 확장
  for (let b = 0; b < 8; b++) {
    const age = lt - b * BEAT * 0.5; if (age < 0) continue; const a = (age % (BEAT * 2)) / (BEAT * 2);
    ctx.save(); ctx.strokeStyle = C.cyan; ctx.lineWidth = 6 * (1 - a) + 1; ctx.globalAlpha = 0.9 * (1 - a); ctx.beginPath(); ctx.arc(cx, cy, 60 + a * 520, 0, 7); ctx.stroke(); ctx.restore();
  }
  ctx.save(); ctx.strokeStyle = C.cyan; ctx.globalAlpha = 0.35; ctx.lineWidth = 3;
  for (const r of [160, 300, 440, 580]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(cx - 600, cy); ctx.lineTo(cx + 600, cy); ctx.moveTo(cx, cy - 600); ctx.lineTo(cx, cy + 600); ctx.stroke(); ctx.restore();
  // 스윕 + 잔상
  const ang = lt * 2 * Math.PI / (BEAT * 4) * 1.5;
  for (let i = 0; i < 24; i++) { ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang - i * 0.035); ctx.globalAlpha = 0.28 * (1 - i / 24); ctx.fillStyle = C.cyan; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 600, -0.03, 0.03); ctx.fill(); ctx.restore(); }
  // 감지 블립 4개 (박자에 맞춰 순서대로)
  const blips = [[-250, -180, '블루투스', C.cyan, 0], [260, -90, 'Wi-Fi', C.lime, 1], [-170, 230, '셀룰러', C.yellow, 2], [210, 280, '영상 송신', C.mag, 3]];
  for (const [dx, dy, name, col, i] of blips) {
    const t0 = i * BEAT * 0.5 + 0.1; if (lt < t0) continue; const k = easeOutBack(clamp((lt - t0) / 0.3));
    ctx.save(); ctx.translate(cx + dx, cy + dy); ctx.scale(k, k);
    ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 30; ctx.beginPath(); ctx.arc(0, 0, 18 + 6 * Math.sin(lt * 14 + i), 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 44, 0, 7); ctx.stroke();
    ctx.restore();
    text(name, cx + dx, cy + dy - 78 * k, { size: 40, fill: col, alpha: k, stroke: '#000', sw: 8 });
  }
  // 타이틀 슬램
  const a = slam(t, BAR + BEAT * 0.5, 0.2), b = slam(t, BAR + BEAT * 1.5, 0.2);
  if (a.vis) text('전파는', W / 2, 1290, { size: 190, alpha: a.alpha, sx: a.scale, sy: a.scale, rgb: 9 * (1 - a.k) + 2, stroke: '#000', sw: 16 });
  if (b.vis) text('거짓말 안 해', W / 2, 1480, { size: fitSize('거짓말 안 해', 980, 190), fill: C.cyan, alpha: b.alpha, sx: b.scale, sy: b.scale, rgb: 9 * (1 - b.k) + 2, stroke: '#000', sw: 16, shadow: C.cyan });
}

function frame3D(t, rng, kp, title, sub, mode) {
  update3D(t, mode);
  const x = 0, y = 250;
  ctx.save();
  ctx.drawImage(three.R.domElement, x, y);
  ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(16px)'; ctx.globalAlpha = 0.55; ctx.drawImage(three.R.domElement, x, y);
  ctx.restore();
  ctx.save(); ctx.strokeStyle = C.cyan; ctx.lineWidth = 4; ctx.globalAlpha = 0.6; ctx.strokeRect(14, y + 14, W - 28, 1020 - 28); ctx.restore();
  hudCorners(C.cyan, 28, 80);
  text(title, W / 2, 150, { size: 78, rgb: 3 + 8 * kp, stroke: '#000', sw: 10 });
  if (sub) text(sub, W / 2, 222, { size: 40, fill: C.cyan });
}

function sceneSim(t, rng, kp) {
  background(t, C.cyan, C.cyan);
  frame3D(t, rng, kp, '3D 탐지 시뮬레이터', 'SENSORS → SEAT PROBABILITY', 'orbit');
  // 하단 경보 피드 (시뮬레이터가 실제로 낸 경보)
  const st = simTime(t), feed = sim.alerts.filter((a) => a.level > 0 && a.t <= st).slice(0, 2);
  feed.forEach((a, i) => {
    const appear = 5 + (a.t - 20) / 10, k = easeOutExpo(clamp((t - appear) / 0.25));
    const y = 1470 - i * 128, parts = a.text.split(' · 후보 좌석 ');
    ctx.save(); ctx.translate((1 - k) * -700, 0);
    rect(40, y - 54, 1000, 112, 'rgba(7,8,15,0.92)', 22); ctx.strokeStyle = LVC[a.level]; ctx.lineWidth = 5; ctx.beginPath(); ctx.roundRect(40, y - 54, 1000, 112, 22); ctx.stroke();
    text(`${a.name} ${a.label}`, 80, y - 16, { size: 46, fill: LVC[a.level], align: 'left' });
    text(parts[0], 80, y + 28, { size: fitSize(parts[0], 440, 32), fill: C.white, align: 'left' });
    text(parts[1] ? `후보 ${parts[1].split(',')[0]}` : '', 1000, y + 8, { size: 44, fill: C.yellow, align: 'right' });
    ctx.restore();
  });
  const s = slam(t, 7.5, 0.25);
  if (s.vis && t < 9.6) text('좌석 단위로 단서 포착', W / 2, 420, { size: fitSize('좌석 단위로 단서 포착', 940, 110), fill: C.yellow, alpha: s.alpha * (1 - seg(t, 9.3, 9.6)), sx: s.scale, sy: s.scale, rgb: 5, stroke: '#000', sw: 14 });
}

function sceneHeat(t, rng, kp) {
  background(t, C.mag, C.mag);
  frame3D(t, rng, kp, 'HEAT MAP', '확률로 보는 의심 구역', 'top');
  const lt = t - 10;
  const v = lerp(3.0, 0.4, easeOutExpo(clamp(lt / 1.4)));
  const a = slam(t, 10.0, 0.2);
  const cy = 1290;
  rect(60, cy, 960, 270, 'rgba(7,8,15,0.94)', 34);
  ctx.strokeStyle = C.mag; ctx.lineWidth = 5; ctx.beginPath(); ctx.roundRect(60, cy, 960, 270, 34); ctx.stroke();
  text(`±${v.toFixed(1)}m`, W / 2, cy + 105, { size: 190, fill: C.mag, rgb: 5 + 7 * kp, stroke: '#000', sw: 12, shadow: C.mag, sx: 1 + 0.05 * kp, sy: 1 + 0.05 * kp });
  text('현장 캘리브레이션 시 평균 위치 오차', W / 2, cy + 200, { size: 42, fill: C.white });
  text('*가상 시험장 시뮬레이션(센서 8개) 기준', W / 2, cy + 248, { size: 30, fill: C.dim });
}

function sceneStats(t, rng, kp) {
  background(t, C.lime, C.lime);
  const lt = t - 12.5;
  text('이렇게 만들었다', W / 2, 190, { size: 84, rgb: 3 + 6 * kp, stroke: '#000', sw: 10 });
  const cards = [
    ['0', '인터넷 권한', '감독관 전용 단말 앱은 외부로 전송할 수 없게 설계', C.cyan, 0.0],
    ['0/30', '정상 시험 오탐*', '감독관석 신호는 자동으로 제외', C.lime, BEAT * 0.75 + 0.0],
    ['5층', '다층 방어', '입실 검사 · 전파 · 광학 · 장비 · 감독 절차', C.mag, BEAT * 1.5],
  ];
  cards.forEach(([big, ttl, sub, col, t0], i) => {
    const s = slam(t, 12.5 + t0, 0.22), y = 330 + i * 380;
    if (!s.vis) return;
    ctx.save(); ctx.translate(W / 2, y + 160); ctx.scale(lerp(1.5, 1, easeOutExpo(s.k)), lerp(1.5, 1, easeOutExpo(s.k))); ctx.globalAlpha = s.alpha; ctx.translate(-W / 2, -(y + 160));
    rect(60, y, 960, 330, 'rgba(10,14,30,0.92)', 34);
    ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.beginPath(); ctx.roundRect(60, y, 960, 330, 34); ctx.stroke();
    text(big, 300, y + 150, { size: fitSize(big, 420, 190), fill: col, rgb: 5 * (1 - s.k) + 1, shadow: col, stroke: '#000', sw: 10 });
    text(ttl, 780, y + 105, { size: 58, fill: C.white });
    text(sub, 780, y + 200, { size: fitSize(sub, 420, 34), fill: C.dim });
    ctx.restore();
  });
  text('*가상 데이터 시뮬레이션 기준', W / 2, 1490, { size: 34, fill: C.dim });
}

function sceneList(t, rng, kp) {
  const lt = t - 15;
  const words = ['스마트폰', '무선 이어폰', '스마트워치', '스마트안경', '초소형 카메라'];
  const step = STEP * 2; // 0.3125s
  const idx = Math.floor(lt / step);
  if (idx < words.length) {
    const inv = idx % 2 === 1;
    ctx.fillStyle = inv ? '#f4f4f4' : '#07080f'; ctx.fillRect(0, 0, W, H);
    if (!inv) background(t, C.mag, C.mag);
    const k = easeOutExpo(clamp((lt - idx * step) / 0.12));
    const col = inv ? '#07080f' : [C.cyan, C.mag, C.lime, C.yellow, C.red][idx];
    text(words[idx], W / 2, 900, { size: fitSize(words[idx], 980, 230), fill: col, sx: lerp(1.5, 1, k), sy: lerp(1.5, 1, k), rgb: inv ? 0 : 8 * (1 - k) + 2, stroke: inv ? null : '#000', sw: 14 });
    text(String(idx + 1).padStart(2, '0'), 90, 330, { size: 120, fill: col, align: 'left', alpha: 0.9 });
    text('SIGNAL DETECTED', W / 2, 1180, { size: 50, fill: col, alpha: 0.9 });
  } else {
    background(t, C.cyan, C.cyan); hudCorners(C.cyan);
    const a = slam(t, 15 + step * 5 + 0.05, 0.2), b = slam(t, 15 + step * 5 + BEAT, 0.2);
    if (a.vis) text('전파를 내는 순간', W / 2, 800, { size: fitSize('전파를 내는 순간', 980, 150), alpha: a.alpha, sx: a.scale, sy: a.scale, rgb: 8 * (1 - a.k) + 2, stroke: '#000', sw: 14 });
    if (b.vis) text('단서가 된다', W / 2, 1040, { size: fitSize('단서가 된다', 980, 210), fill: C.yellow, alpha: b.alpha, sx: b.scale, sy: b.scale, rgb: 8 * (1 - b.k) + 2, stroke: '#000', sw: 16, shadow: C.yellow });
    text('*전파를 내지 않는 기기는 입실 전 검사로', W / 2, 1290, { size: 34, fill: C.dim });
  }
}

function sceneCTA(t, rng, kp) {
  background(t, C.mag, C.mag); hudCorners(C.mag);
  const lt = t - BAR * 7;
  const a = slam(t, BAR * 7, 0.3);
  // 스캔 라인
  const sy = 280 + ((lt * 500) % 1100); ctx.save(); ctx.globalAlpha = 0.25; ctx.fillStyle = C.cyan; ctx.fillRect(0, sy, W, 6); ctx.restore();
  text('AI-DETECTORS', W / 2, 640, { size: fitSize('AI-DETECTORS', 1000, 190), alpha: a.alpha, sx: a.scale, sy: a.scale, rgb: 10 * (1 - a.k) + 3 + 6 * kp, stroke: '#000', sw: 16, shadow: C.mag });
  const b = slam(t, BAR * 7 + BEAT * 0.5, 0.2), c = slam(t, BAR * 7 + BEAT, 0.2);
  if (b.vis) text('수능 AI 부정행위', W / 2, 860, { size: 100, fill: C.cyan, alpha: b.alpha, sx: b.scale, sy: b.scale, stroke: '#000', sw: 12 });
  if (c.vis) text('전파 탐지 프로토타입', W / 2, 990, { size: 100, fill: C.white, alpha: c.alpha, sx: c.scale, sy: c.scale, stroke: '#000', sw: 12 });
  const d = slam(t, BAR * 7 + BEAT * 1.5, 0.2);
  if (d.vis) {
    ctx.save(); ctx.globalAlpha = d.alpha; rect(120, 1130, 840, 150, C.lime, 75);
    text('프로필 링크에서 3D 데모 체험', W / 2, 1205, { size: fitSize('프로필 링크에서 3D 데모 체험', 780, 60), fill: '#07080f' }); ctx.restore();
    text('github.com/lifelongdt-beep/Ai-detectors', W / 2, 1350, { size: 38, fill: C.dim, alpha: d.alpha });
    text('※ 가상 데이터 시뮬레이션 기반 연구용 프로토타입이며 실제 성능을 보증하지 않습니다', W / 2, 1420, { size: 28, fill: C.dim, alpha: d.alpha * 0.9 });
  }
}

// ---------- 프레임 ----------
const CUTS = [BAR * 1, BAR * 2, BAR * 4, BAR * 5, BAR * 6, BAR * 7];
function drawFrame(i) {
  const t = i / FPS, rng = mulberry32(i * 7919 + 13);
  const kp = pulse(t, kickTimes, 8), sk = pulse(t, snareTimes, 10);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  // 킥에 맞춘 화면 흔들림/줌
  const amp = (t < BAR * 2 ? 6 : 14) * kp + 8 * sk;
  ctx.save();
  ctx.translate(W / 2 + (rng() - 0.5) * amp, H / 2 + (rng() - 0.5) * amp); const zoom = 1 + 0.025 * kp + 0.015 * sk; ctx.scale(zoom, zoom); ctx.translate(-W / 2, -H / 2);
  if (t < BAR) sceneHook(t, rng, kp);
  else if (t < BAR * 2) sceneRadar(t, rng, kp, sk);
  else if (t < BAR * 4) sceneSim(t, rng, kp);
  else if (t < BAR * 5) sceneHeat(t, rng, kp);
  else if (t < BAR * 6) sceneStats(t, rng, kp);
  else if (t < BAR * 7) sceneList(t, rng, kp);
  else sceneCTA(t, rng, kp);
  ctx.restore();
  overlayFX(t, rng, kp);
  // 컷 포인트 플래시
  for (const c of CUTS) { const d = t - c; if (d >= 0 && d < 0.18) { ctx.save(); ctx.globalAlpha = 0.85 * (1 - d / 0.18); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.restore(); } }
  // 페이드 아웃 / 인
  const fo = seg(t, DUR - 0.3, DUR), fi = 1 - seg(t, 0, 0.12);
  if (fo > 0 || fi > 0) { ctx.save(); ctx.globalAlpha = Math.max(fo, fi); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}

window.setup = async function () {
  sim = new Simulation({ seed: SIM_SEED, scenario: 'multi', sensorMode: 'fixed', sensorCount: 8, calibrated: true });
  let all = ''; for (let c = 0xac00; c <= 0xd7a3; c++) all += String.fromCharCode(c);
  await document.fonts.load('40px "Black Han Sans"', all + 'AI-DETECTORS REC CAM0123456789±.%/*');
  await document.fonts.ready;
  build3D();
  return true;
};
window.frame = function (i) { drawFrame(i); return cv.toDataURL('image/jpeg', 0.93); };
window.__frames = FPS * DUR;
