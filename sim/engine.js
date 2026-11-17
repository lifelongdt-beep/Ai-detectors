// 수능 시험장 전파 탐지 시뮬레이션 엔진 (DOM 의존 없음, Node/브라우저 공용)
//
// 모델 요약
//  - 교실 12m x 9m x 3m, 좌석 5열 x 6행 = 30석
//  - 센서(천장/벽면)가 송신 신호의 세기(RSSI)만 수신한다. 내용/파일은 알 수 없다.
//  - 신호 모델: 로그거리 경로손실 + 링크별 고정 음영(static shadowing) + 순간 페이딩
//  - 위치 추정: 3D 격자 위 최대우도(미지의 송신전력은 소거) + 사후확률 -> 좌석별 확률
//  - 활동 분석: 송신 밀도, 버스트(질의) 후 꼬리 트래픽 패턴, 위험도 점수

export const ROOM = { w: 12, h: 3, d: 9 };
export const GRID = { step: 0.25, nx: 49, nz: 37, ys: [0.3, 0.6, 0.9, 1.2, 1.5] };
export const ZONE = { x0: 4.5, x1: 7.5, z0: 0, z1: 1.3 }; // 감독관석(제외 구역)
export const SEAT_COLS = 5;
export const SEAT_ROWS = 6;

export const BANDS = {
  BLE: { name: '블루투스', ref: 40, n: 2.6, sens: -92, color: '#4aa3ff' },
  WIFI: { name: 'Wi-Fi', ref: 40, n: 2.6, sens: -92, color: '#7bdc7b' },
  LTE: { name: '셀룰러', ref: 38, n: 2.7, sens: -84, color: '#ff8a3d' },
  ISM: { name: '소출력무선', ref: 32, n: 2.5, sens: -90, color: '#d36bff' },
};

const N_EST = 2.5; // 추정기가 가정하는 경로손실 지수 (실제값과 일부러 다르게 둠)
const SIGMA_MODEL = 4.0; // 추정기가 가정하는 모델 오차(dB)
const FAST_FADING = 2.0; // 순간 페이딩 표준편차(dB)
export const DT = 0.2; // 센서 샘플 주기(초)

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng) {
  let u = 0;
  while (!u) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function seatList() {
  const seats = [];
  for (let r = 0; r < SEAT_ROWS; r++)
    for (let c = 0; c < SEAT_COLS; c++)
      seats.push({ idx: r * SEAT_COLS + c, id: `R${r + 1}-C${c + 1}`, row: r, col: c, x: 2 + c * 2, z: 2.2 + r * 1.1 });
  return seats;
}

export function sensorLayout(n) {
  const { w, d } = ROOM;
  const all = [
    [0.2, 2.8, 0.2], [w - 0.2, 2.8, d - 0.2], [w - 0.2, 2.8, 0.2], [0.2, 2.8, d - 0.2],
    [0.1, 1.1, d / 2], [w - 0.1, 1.1, d / 2], [w / 2, 1.1, 0.1], [w / 2, 1.1, d - 0.1],
    [w / 2, 2.8, d / 2], [w / 4, 2.8, d / 2], [(3 * w) / 4, 2.8, d / 2], [w / 2, 2.8, d / 4],
  ];
  return all.slice(0, n).map(([x, y, z], i) => ({ id: i + 1, x, y, z }));
}

// ---------- 송신 행동 모델 ----------
function burstBehavior({ startAt, per, idleP, q, upP, resp, respP }, rng) {
  let next = startAt, phaseEnd = -1, phase = 'idle';
  return (t) => {
    if (t < startAt) return { p: 0, phase: 'off' };
    if (phase === 'idle' && t >= next) { phase = 'up'; phaseEnd = t + q; }
    else if (phase === 'up' && t >= phaseEnd) { phase = 'resp'; phaseEnd = t + resp[0] + rng() * (resp[1] - resp[0]); }
    else if (phase === 'resp' && t >= phaseEnd) { phase = 'idle'; next = t + per[0] + rng() * (per[1] - per[0]); }
    return { p: phase === 'up' ? upP : phase === 'resp' ? respP : idleP, phase };
  };
}
const streamBehavior = (startAt) => (t) => t < startAt ? { p: 0, phase: 'off' } : { p: 0.6 + 0.2 * Math.sin(t / 3), phase: 'stream' };
const pulseBehavior = (startAt) => (t) => t < startAt ? { p: 0, phase: 'off' } : { p: (t - startAt) % 3 < 1 ? 0.5 : 0.02, phase: 'pulse' };

const camStream = (startAt, p) => (t) => (t < startAt ? { p: 0, phase: 'off' } : { p, phase: 'stream' });

const DEVICE = {
  wifi_cam: (s) => ({ label: '무선 카메라(Wi-Fi 영상 전송)', band: 'WIFI', tx: 15, y: 0.9, cheat: true, act: camStream(s, 0.85) }),
  fpv_cam: (s) => ({ label: '무선 영상 송신기(5.8GHz)', band: 'ISM', tx: 14, y: 0.9, cheat: true, act: camStream(s, 0.95) }),
  sd_cam: (s) => ({ label: 'SD저장형 카메라(전파 없음)', band: 'WIFI', tx: -120, y: 0.9, cheat: true, silent: true, act: camStream(s, 0) }),
  phone_ai: (s, rng) => ({ label: '스마트폰 AI 질의', band: 'LTE', tx: 20, y: 0.7, cheat: true,
    act: burstBehavior({ startAt: s, per: [20, 50], idleP: 0.03, q: 1.5, upP: 0.9, resp: [4, 9], respP: 0.35 }, rng) }),
  earbud: (s) => ({ label: '무선 이어폰(음성 중계)', band: 'BLE', tx: 2, y: 1.15, cheat: true, act: streamBehavior(s) }),
  relay_phone: (s, rng) => ({ label: '원격 도우미 연결 폰', band: 'LTE', tx: 20, y: 0.7, cheat: true,
    act: burstBehavior({ startAt: s, per: [15, 30], idleP: 0.25, q: 2, upP: 0.8, resp: [3, 6], respP: 0.5 }, rng) }),
  watch: (s, rng) => ({ label: '스마트워치', band: 'BLE', tx: 0, y: 0.95, cheat: true,
    act: burstBehavior({ startAt: s, per: [30, 70], idleP: 0.02, q: 2, upP: 0.6, resp: [0.1, 0.3], respP: 0.3 }, rng) }),
  glasses: (s, rng) => ({ label: '스마트안경(촬영/AI)', band: 'WIFI', tx: 14, y: 1.2, cheat: true,
    act: burstBehavior({ startAt: s, per: [40, 90], idleP: 0.08, q: 3, upP: 0.9, resp: [5, 9], respP: 0.3 }, rng) }),
  microtx: (s) => ({ label: '초소형 송신기', band: 'ISM', tx: 10, y: 0.9, cheat: true, act: pulseBehavior(s) }),
  forgotten: (s, rng) => ({ label: '전원 켜진 휴대폰(부주의)', band: 'LTE', tx: 18, y: 0.6, cheat: false,
    act: burstBehavior({ startAt: 0, per: [28, 34], idleP: 0.01, q: 0.6, upP: 0.9, resp: [0.1, 0.2], respP: 0.2 }, rng) }),
};

export const SCENARIOS = {
  clean: { name: '정상 시험 (이상 없음 + 감독관 휴대폰)', help: '오탐이 없는지 확인' },
  phone: { name: '스마트폰 AI 질의 1명', help: 'LTE로 AI에 문제를 물어보는 경우' },
  earbud: { name: '무선 이어폰 + 원격 도우미', help: 'BLE 음성 스트림 + 연결 폰' },
  wearable: { name: '스마트워치 + 스마트안경', help: '소형 웨어러블 기반 AI 활용' },
  camera: { name: '초소형 카메라 (시험지 촬영·외부 전송)', help: 'Wi-Fi 영상, 무선 영상 송신기, 전파 없는 SD 저장형' },
  multi: { name: '복합 (인접 2명 + 오탐 포함)', help: '여러 유형이 동시에, 인접 좌석, 부주의 폰 포함' },
};

function buildScenario(name, rng, seats) {
  const pickSeat = (taken) => {
    let s;
    do { s = seats[Math.floor(rng() * seats.length)]; } while (taken.has(s.idx));
    taken.add(s.idx);
    return s;
  };
  const taken = new Set();
  const list = [];
  const add = (kind, seat, startAt, rng2, extra = {}) => {
    const d = DEVICE[kind](startAt, rng2);
    const jitter = () => (rng() - 0.5) * 0.5;
    list.push({ id: `E${list.length + 1}`, kind, seat, startAt, ...d,
      pos: { x: seat.x + jitter(), y: d.y, z: seat.z + jitter() }, ...extra });
  };
  const start = () => 5 + rng() * 35;
  // 감독관 휴대폰: 모든 시나리오에 존재 (제외 구역 검증용)
  list.push({ id: 'E0', kind: 'invigilator', seat: null, ...DEVICE.forgotten(0, rng), label: '감독관 휴대폰',
    cheat: false, pos: { x: 6, y: 1.0, z: 0.6 } });
  if (name === 'phone') add('phone_ai', pickSeat(taken), start(), rng);
  if (name === 'earbud') { const s = pickSeat(taken); const t0 = start(); add('earbud', s, t0, rng); add('relay_phone', s, t0, rng); }
  if (name === 'wearable') { add('watch', pickSeat(taken), start(), rng); add('glasses', pickSeat(taken), start(), rng); }
  if (name === 'camera') {
    add('wifi_cam', pickSeat(taken), start(), rng);
    add('fpv_cam', pickSeat(taken), start(), rng);
    add('sd_cam', pickSeat(taken), start(), rng);
  }
  if (name === 'multi') {
    const a = pickSeat(taken);
    add('phone_ai', a, start(), rng);
    const nb = seats.find((s) => s.row === a.row && s.col === (a.col < SEAT_COLS - 1 ? a.col + 1 : a.col - 1));
    taken.add(nb.idx);
    add('glasses', nb, start(), rng);
    const e = pickSeat(taken); const t0 = start(); add('earbud', e, t0, rng); add('relay_phone', e, t0, rng);
    add('microtx', pickSeat(taken), start(), rng);
    add('forgotten', pickSeat(taken), 0, rng);
  }
  return list;
}

// ---------- 센서 구성 (고정 설치형 / 감독관 폰 / 혼합) ----------
export const SENSOR_MODES = {
  fixed: { name: '고정 센서 설치형', help: '전용 센서를 교실에 설치 (전 대역 탐지)' },
  phones: { name: '감독관 폰 6대 (설치 없음)', help: '교실 3 + 복도 3, 블루투스/Wi-Fi만 탐지' },
  hybrid: { name: '혼합 (고정 센서 + 감독관 폰)', help: '고정 센서의 사각지대를 폰이 보완' },
};
export const CORRIDOR_X = -1.3; // 복도(교실 왼쪽 벽 바깥)
const WALL_LOSS = 9; // 실제 벽 감쇠(dB)
const WALL_EST = 8; // 추정기가 아는 벽 감쇠(조금 틀리게 둠)
const PHONE_BANDS = new Set(['BLE', 'WIFI']); // 일반 스마트폰이 앱으로 관측 가능한 대역
const PHONE_FADING = 2.5, PHONE_STATIC = 3.5; // 손에 든 폰: 신체 가림으로 변동이 더 큼

function makeRoute(points, speed, y, phase = 0) {
  const pts = [...points, points[0]], seg = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) { const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); seg.push(d); total += d; }
  return (t) => {
    let u = (((t * speed + phase) % total) + total) % total;
    for (let i = 0; i < seg.length; i++) {
      if (u <= seg[i]) { const a = pts[i], b = pts[i + 1], f = seg[i] ? u / seg[i] : 0; return { x: a[0] + (b[0] - a[0]) * f, y, z: a[1] + (b[1] - a[1]) * f }; }
      u -= seg[i];
    }
    return { x: pts[0][0], y, z: pts[0][1] };
  };
}

function buildSensors(mode, fixedCount, patrol) {
  const out = [];
  if (mode !== 'phones') for (const s of sensorLayout(fixedCount)) out.push({ id: out.length + 1, kind: 'fixed', label: `S${out.length + 1}`, bands: null, hall: false, x: s.x, y: s.y, z: s.z });
  if (mode !== 'fixed') {
    const stations = [[6, 0.9], [1.0, 8.4], [11.0, 8.4]];
    const routes = [[[3, 1.3], [3, 8.3], [5, 8.3], [5, 1.3]], [[7, 1.3], [7, 8.3], [9, 8.3], [9, 1.3]], [[1, 1.2], [1, 8.5], [11, 8.5], [11, 1.2]]];
    const hallZ = [1.5, 4.5, 7.5], hallR = [[0.5, 3.2], [3.0, 6.0], [5.8, 8.6]];
    for (let k = 0; k < 3; k++) {
      const route = patrol.room ? makeRoute(routes[k], 0.6, 1.3, k * 9) : null;
      const p0 = route ? route(0) : { x: stations[k][0], y: 1.3, z: stations[k][1] };
      out.push({ id: out.length + 1, kind: 'phone', label: `교실${k + 1}`, bands: PHONE_BANDS, hall: false, route, x: p0.x, y: p0.y, z: p0.z, bx: p0.x, bz: p0.z });
    }
    for (let k = 0; k < 3; k++) {
      const route = patrol.hall ? makeRoute([[CORRIDOR_X, hallR[k][0]], [CORRIDOR_X, hallR[k][1]]], 0.7, 1.3, k * 3) : null;
      const p0 = route ? route(0) : { x: CORRIDOR_X, y: 1.3, z: hallZ[k] };
      out.push({ id: out.length + 1, kind: 'phone', label: `복도${k + 1}`, bands: PHONE_BANDS, hall: true, route, x: p0.x, y: p0.y, z: p0.z, bx: p0.x, bz: p0.z });
    }
  }
  return out;
}

function hashGauss(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  const r = mulberry32(h >>> 0);
  return gauss(r);
}

// ---------- 위치 추정 ----------
function buildGrid(seats) {
  const { nx, nz, step } = GRID;
  const seatOf = new Int16Array(nx * nz).fill(-1);
  const inZone = new Uint8Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const x = ix * step, z = iz * step;
    let best = -1, bd = 1.3;
    for (const s of seats) { const d = Math.hypot(x - s.x, z - s.z); if (d < bd) { bd = d; best = s.idx; } }
    seatOf[iz * nx + ix] = best;
    if (x >= ZONE.x0 && x <= ZONE.x1 && z >= ZONE.z0 && z <= ZONE.z1) inZone[iz * nx + ix] = 1;
  }
  return { seatOf, inZone };
}

// dets: [{L, mean}] 들린 관측 묶음, unds: [{L}] 송신 중인데 안 들린 묶음
function locate(g, seats, band, dets, unds) {
  const { nx, nz, ys } = GRID, ny = ys.length, B = BANDS[band];
  const cells = nx * nz * ny, costs = new Float32Array(cells), nd = dets.length;
  let minC = Infinity;
  for (let c = 0; c < cells; c++) {
    let sum = 0;
    for (let k = 0; k < nd; k++) sum += dets[k].mean + dets[k].L[c];
    const Q = sum / nd;
    let cost = 0;
    for (let k = 0; k < nd; k++) { const v = dets[k].mean + dets[k].L[c] - Q; cost += v * v; }
    for (const u of unds) { const ex = Q - u.L[c] - (B.sens + 3); if (ex > 0) cost += ex * ex; }
    const tx = Q + B.ref; // 암시되는 송신전력: 비현실적이면 벌점
    if (tx > 27) cost += (tx - 27) ** 2;
    if (tx < -15) cost += (-15 - tx) ** 2;
    costs[c] = cost;
    if (cost < minC) minC = cost;
  }
  let tot = 0, ex = 0, ey = 0, ez = 0, ex2 = 0, ey2 = 0, ez2 = 0, zoneMass = 0;
  const seatMass = new Float64Array(seats.length), xz = new Float32Array(nx * nz);
  const k = 1 / (2 * SIGMA_MODEL * SIGMA_MODEL);
  for (let iy = 0; iy < ny; iy++) for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const c = (iy * nz + iz) * nx + ix, w = Math.exp(-(costs[c] - minC) * k);
    const x = ix * GRID.step, y = ys[iy], z = iz * GRID.step;
    tot += w; ex += w * x; ey += w * y; ez += w * z; ex2 += w * x * x; ey2 += w * y * y; ez2 += w * z * z;
    const xi = iz * nx + ix;
    xz[xi] += w;
    if (g.seatOf[xi] >= 0) seatMass[g.seatOf[xi]] += w;
    if (g.inZone[xi]) zoneMass += w;
  }
  ex /= tot; ey /= tot; ez /= tot;
  const varx = Math.max(0, ex2 / tot - ex * ex), vary = Math.max(0, ey2 / tot - ey * ey), varz = Math.max(0, ez2 / tot - ez * ez);
  for (let i = 0; i < xz.length; i++) xz[i] /= tot;
  const top = [...seatMass].map((m, i) => ({ idx: i, id: seats[i].id, p: m / tot })).sort((a, b) => b.p - a.p).slice(0, 3);
  return { x: ex, y: ey, z: ez, rH: Math.sqrt(varx + varz), rV: Math.sqrt(vary), seats: top,
    zoneMass: zoneMass / tot, rms: Math.sqrt(minC / nd), xz };
}

// ---------- 시뮬레이션 ----------
export class Simulation {
  constructor({ seed = 1, sensorCount = 8, calibrated = false, scenario = 'phone', sensorMode = 'fixed',
    patrol = { room: true, hall: true }, posErr = 0.5, decorr = 0.7 } = {}) {
    this.opts = { seed, sensorCount, calibrated, scenario, sensorMode, patrol, posErr, decorr };
    this.rng = mulberry32(seed);
    this.t = 0; this.tick = 0;
    this.seats = seatList();
    this.sensors = buildSensors(sensorMode, sensorCount, patrol);
    this.minDetect = sensorMode === 'fixed' ? 2 : 1;
    this.window = sensorMode === 'fixed' ? 20 : 40;
    this.grid = buildGrid(this.seats);
    this.lcache = new Map();
    this.emitters = buildScenario(scenario, this.rng, this.seats);
    const sigma = calibrated ? 1.2 : 3.5; // 현장 사전측정(캘리브레이션)은 고정 센서에만 적용
    for (const e of this.emitters) {
      e.nTrue = BANDS[e.band].n + (this.rng() - 0.5) * 0.6;
      e.off = this.sensors.map(() => gauss(this.rng) * sigma);
      e.on = false; e.phase = 'off';
    }
    this.tracks = new Map();
    this.alerts = [];
    this.events = [];
    this.heat = new Float32Array(GRID.nx * GRID.nz);
  }

  // 이 센서 구성으로는 원리상 볼 수 없는 대역
  get blindBands() {
    const seen = new Set(Object.keys(BANDS));
    for (const s of this.sensors) if (!s.bands) return [];
    for (const b of PHONE_BANDS) seen.delete(b);
    return [...seen];
  }

  moveSensors() {
    for (const s of this.sensors) {
      if (s.kind !== 'phone') continue;
      if (s.route) { const p = s.route(this.t); s.x = p.x; s.y = p.y; s.z = p.z; }
      // 폰이 스스로 믿는 위치 = 실제 위치 + 천천히 변하는 오차 (실내 위치 추정 한계)
      s.ex = 0.995 * (s.ex || 0) + gauss(this.rng) * this.opts.posErr * 0.1;
      s.ez = 0.995 * (s.ez || 0) + gauss(this.rng) * this.opts.posErr * 0.1;
      s.bx = s.x + s.ex; s.bz = s.z + s.ez;
    }
  }

  observe(e) {
    const B = BANDS[e.band], arr = new Array(this.sensors.length).fill(null), obs = [];
    let heard = 0;
    this.sensors.forEach((s, i) => {
      if (s.bands && !s.bands.has(e.band)) return; // 이 센서는 해당 대역을 볼 수 없음
      const d = Math.max(0.5, Math.hypot(e.pos.x - s.x, e.pos.y - s.y, e.pos.z - s.z));
      const fixed = s.kind === 'fixed';
      const stat = fixed ? e.off[i] : hashGauss(`${this.opts.seed}|${e.id}|${s.id}|${Math.round(s.x / this.opts.decorr)},${Math.round(s.z / this.opts.decorr)}`) * PHONE_STATIC;
      const r = Math.round(e.tx - B.ref - 10 * e.nTrue * Math.log10(d) - (s.hall ? WALL_LOSS : 0) + stat + gauss(this.rng) * (fixed ? FAST_FADING : PHONE_FADING));
      const ok = r >= B.sens;
      const o = fixed ? { key: `F${s.id}`, px: s.x, py: s.y, pz: s.z, wall: 0 }
        : { px: Math.round(s.bx / 0.5) * 0.5, py: s.y, pz: Math.round(s.bz / 0.5) * 0.5, wall: s.hall ? WALL_EST : 0 };
      if (!fixed) o.key = `P${s.id}:${o.px},${o.pz}`;
      o.r = ok ? r : null;
      obs.push(o);
      if (ok) { arr[i] = r; heard++; }
    });
    return { arr, obs, heard };
  }

  getL(o) {
    let L = this.lcache.get(o.key);
    if (L) return L;
    const { nx, nz, ys, step } = GRID, ny = ys.length;
    L = new Float32Array(nx * nz * ny);
    for (let iy = 0; iy < ny; iy++) for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const d = Math.max(0.5, Math.hypot(ix * step - o.px, ys[iy] - o.py, iz * step - o.pz));
      L[(iy * nz + iz) * nx + ix] = 10 * N_EST * Math.log10(d) + o.wall;
    }
    this.lcache.set(o.key, L);
    return L;
  }

  advance(seconds) {
    const n = Math.max(1, Math.round(seconds / DT));
    for (let i = 0; i < n; i++) this.step();
  }

  step() {
    this.t += DT; this.tick++;
    this.moveSensors();
    for (const e of this.emitters) {
      const { p, phase } = e.act(this.t);
      e.phase = phase;
      e.on = this.rng() < p;
      if (!e.on) continue;
      const o = this.observe(e);
      if (o.heard < this.minDetect) continue; // 최소 센서 수 이상에서 들려야 '탐지'
      this.ingest(e, o);
    }
    if (this.tick % 5 === 0) this.housekeeping();
  }

  ingest(e, o) {
    let tr = this.tracks.get(e.id);
    if (!tr) {
      tr = { key: e.id, name: `T${this.tracks.size + 1}`, band: e.band, firstSeen: this.t, samples: [], onTimes: [],
        est: null, risk: 0, level: 0, patternCount: 0, burstCount: 0, openBursts: [], lastBurst: -99,
        history: [], lastOnT: this.t, lastRssi: o.arr, excluded: false, tags: [], cls: '미분류 송신원', cell: 0 };
      this.tracks.set(e.id, tr);
    }
    tr.samples.push({ t: this.t, obs: o.obs });
    tr.onTimes.push(this.t);
    tr.lastOnT = this.t; tr.lastRssi = o.arr;
    this.events.push({ type: 'tx', key: e.id, band: e.band, t: this.t });
  }

  countOn(tr, t0, t1) { let c = 0; for (const x of tr.onTimes) if (x >= t0 && x < t1) c++; return c; }

  housekeeping() {
    const t = this.t;
    for (let i = 0; i < this.heat.length; i++) this.heat[i] *= 0.995;
    for (const tr of this.tracks.values()) {
      while (tr.samples.length && tr.samples[0].t < t - this.window) tr.samples.shift();
      while (tr.onTimes.length && tr.onTimes[0] < t - 60) tr.onTimes.shift();
      tr.history.push(this.countOn(tr, t - 1, t + 0.01) / 5);
      if (tr.history.length > 180) tr.history.shift();
      this.analyzeActivity(tr);
      this.estimate(tr);
      this.score(tr);
    }
  }

  analyzeActivity(tr) {
    const t = this.t;
    // 질의(버스트) 탐지: 최근 1초 밀집 + 직전 3초 한산
    if (t - tr.lastBurst > 10 && this.countOn(tr, t - 1, t + 0.01) >= 4 && this.countOn(tr, t - 4, t - 1) <= 3) {
      tr.lastBurst = t; tr.burstCount++; tr.openBursts.push(t);
    }
    // 버스트 10초 뒤: 후속(응답/ACK) 트래픽이 이어졌는지 확인 -> '질의→응답' 패턴
    tr.openBursts = tr.openBursts.filter((t0) => {
      if (t < t0 + 10) return true;
      if (this.countOn(tr, t0 + 2, t0 + 10) >= 5) tr.patternCount++;
      return false;
    });
  }

  estimate(tr) {
    const agg = new Map();
    for (const s of tr.samples) for (const o of s.obs) {
      let a = agg.get(o.key);
      if (!a) { a = { o, sum: 0, cnt: 0, tot: 0 }; agg.set(o.key, a); }
      a.tot++;
      if (o.r != null) { a.sum += o.r; a.cnt++; }
    }
    const need = this.opts.sensorMode === 'phones' ? 1 : 2;
    const dets = [], unds = [];
    for (const a of agg.values()) {
      if (a.cnt >= need && a.cnt >= 0.3 * a.tot) dets.push({ L: this.getL(a.o), mean: a.sum / a.cnt });
      else if (a.tot >= 2 && a.cnt === 0) unds.push({ L: this.getL(a.o) });
    }
    if (dets.length < 3) { tr.est = null; return; }
    const e = locate(this.grid, this.seats, tr.band, dets, unds);
    tr.est = e;
    tr.excluded = e.zoneMass > 0.8;
    if (!tr.excluded) for (let i = 0; i < this.heat.length; i++) this.heat[i] += e.xz[i] * 0.15;
  }

  score(tr) {
    const t = this.t;
    const win = Math.max(20, Math.min(60, t - tr.firstSeen + 1)); // 탐지 직후 표본 부족으로 활동률이 과대계산되는 것 방지
    const duty = tr.onTimes.length / (win / DT);
    tr.duty = duty;
    let s = 10 + duty * 70 + Math.min(tr.patternCount * 14, 42) + Math.min(tr.burstCount * 3, 9);
    if (tr.band === 'ISM') s += 20;
    if ((tr.band === 'BLE' || tr.band === 'WIFI' || tr.band === 'ISM') && duty > 0.4) s += 15;
    tr.risk = Math.min(100, Math.round(s));
    // 유형 추정
    tr.tags = [];
    if (tr.band === 'BLE' && duty > 0.4) { tr.cls = '무선 이어폰·음성 중계 의심'; tr.tags.push('지속 스트림'); }
    else if ((tr.band === 'WIFI' || tr.band === 'ISM') && duty > 0.45) { tr.cls = '카메라 의심 (지속 영상 스트림)'; tr.tags.push('지속 고활동'); }
    else if (tr.band === 'ISM') { tr.cls = '소출력 송신기 의심'; tr.tags.push('주기적 펄스'); }
    else if (tr.patternCount >= 1) { tr.cls = (tr.band === 'WIFI' ? '스마트안경' : tr.band === 'BLE' ? '웨어러블' : '스마트폰') + ' AI 질의 의심'; }
    else if (duty < 0.06) tr.cls = '저활동 장치(배경 통신 추정)';
    else tr.cls = '미분류 송신원';
    if (tr.patternCount) tr.tags.push(`질의→응답 ${tr.patternCount}회`);
    if (tr.excluded) tr.cls = '감독관석 구역 신호 (제외)';
    const level = tr.excluded ? 0 : tr.risk >= 60 ? 3 : tr.risk >= 30 ? 2 : 1;
    tr.level = level; // 현재 단계(내려갈 수 있음)
    if (level > (tr.maxLevel || 0) || (tr.excluded && !tr.alerted)) { // 경보는 단계가 처음 오를 때만
      tr.maxLevel = Math.max(level, tr.maxLevel || 0); tr.alerted = true;
      const seats = tr.est ? tr.est.seats.filter((x) => x.p > 0.12).map((x) => `${x.id}(${Math.round(x.p * 100)}%)`).join(', ') : '측위 불가';
      const label = tr.excluded ? '정보' : ['', '관찰', '주의', '경고'][level];
      this.alerts.unshift({ t, name: tr.name, level, label, text: `${tr.cls} · 후보 좌석 ${seats}` });
    }
  }

  // 시뮬레이션 정답 대비 오차 (검증용; 실제 환경에서는 알 수 없음)
  truthFor(tr) {
    const e = this.emitters.find((x) => x.id === tr.key);
    if (!e || !tr.est) return null;
    const errH = Math.hypot(tr.est.x - e.pos.x, tr.est.z - e.pos.z);
    const err3 = Math.hypot(tr.est.x - e.pos.x, tr.est.y - e.pos.y, tr.est.z - e.pos.z);
    const top = tr.est.seats.map((s) => s.idx);
    return { emitter: e, errH, err3, top1: e.seat ? top[0] === e.seat.idx : null, top3: e.seat ? top.includes(e.seat.idx) : null };
  }

  // 정답 기준: 이미 송신을 시작했는데 아직 탐지 못 한 부정행위 기기 (검증용)
  missed() {
    return this.emitters.filter((e) => e.cheat && this.t > e.startAt + 60 && !this.tracks.has(e.id));
  }
}
