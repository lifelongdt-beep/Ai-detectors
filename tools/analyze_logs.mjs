// 사용법: node tools/analyze_logs.mjs 로그1.csv 로그2.csv ... [--json]
// 안드로이드 신호 로거가 저장한 CSV(여러 폰)를 합쳐 기준선에 없던 새 기기를 찾고,
// 관측자 위치 태그(좌석/복도)와 신호 세기로 대략의 위치를 추정한다. 결과는 감독관 확인용 단서다.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function posXZ(p) {
  let m = /^R(\d+)-C(\d+)$/.exec(p);
  if (m) return { x: 2 + (Number(m[2]) - 1) * 2, z: 2.2 + (Number(m[1]) - 1) * 1.1 }; // sim/engine.js 좌석 배치와 동일
  m = /^H(\d)$/.exec(p);
  if (m) return { x: -1.3, z: [1.5, 4.5, 7.5][Number(m[1]) - 1] ?? 4.5 };
  if (p === 'F') return { x: 6, z: 0.6 };
  return null; // '-' (미지정)
}

export function parseLog(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#') || line.startsWith('t_ms,')) continue;
    const f = line.split(',');
    if (f.length < 8) continue;
    rows.push({ t: Number(f[0]), observer: f[1], phase: f[2], pos: f[3], type: f[4], id: f[5], rssi: Number(f[6]), extra: f[7] });
  }
  return rows;
}

export function analyze(texts, { seats = null } = {}) {
  const rows = texts.flatMap(parseLog);
  const baseline = new Set(rows.filter((r) => r.phase === 'BASE').map((r) => r.id));
  const exam = rows.filter((r) => r.phase === 'EXAM');
  if (!exam.length) return { devices: [], baselineSize: baseline.size, examRows: 0 };
  const t0 = Math.min(...exam.map((r) => r.t)), t1 = Math.max(...exam.map((r) => r.t));
  const examSec = Math.max(1, (t1 - t0) / 1000);
  const byId = new Map();
  for (const r of exam) {
    if (baseline.has(r.id)) continue;
    let d = byId.get(r.id);
    if (!d) { d = { id: r.id, type: r.type, n: 0, secs: new Set(), observers: new Set(), bins: new Map() }; byId.set(r.id, d); }
    d.n++; d.secs.add(Math.floor(r.t / 1000)); d.observers.add(r.observer);
    const key = `${r.observer}|${r.pos}`;
    const b = d.bins.get(key) ?? { observer: r.observer, pos: r.pos, sum: 0, cnt: 0 };
    b.sum += r.rssi; b.cnt++; d.bins.set(key, b);
  }
  const seatList = seats ?? Array.from({ length: 30 }, (_, i) => { const r = Math.floor(i / 5), c = i % 5; return { id: `R${r + 1}-C${c + 1}`, x: 2 + c * 2, z: 2.2 + r * 1.1 }; });
  const devices = [...byId.values()].map((d) => {
    const bins = [...d.bins.values()].map((b) => ({ ...b, mean: b.sum / b.cnt, xz: posXZ(b.pos) })).filter((b) => b.xz && b.cnt >= 2)
      .sort((a, b) => b.mean - a.mean);
    const top = bins.slice(0, 4);
    let est = null, nearest = null;
    if (top.length) {
      const w = top.map((b) => 10 ** (b.mean / 10)), W = w.reduce((a, b) => a + b, 0);
      est = { x: top.reduce((s, b, i) => s + b.xz.x * w[i], 0) / W, z: top.reduce((s, b, i) => s + b.xz.z * w[i], 0) / W };
      nearest = [...seatList].sort((a, b) => Math.hypot(a.x - est.x, a.z - est.z) - Math.hypot(b.x - est.x, b.z - est.z)).slice(0, 3).map((s) => s.id);
    }
    return { id: d.id, type: d.type, sightings: d.n, activity: d.secs.size / examSec, observers: d.observers.size,
      strongest: bins[0] ? { pos: bins[0].pos, observer: bins[0].observer, rssi: Math.round(bins[0].mean) } : null,
      est, candidateSeats: nearest, positionsUsed: bins.length };
  }).sort((a, b) => b.activity - a.activity || b.sightings - a.sightings);
  return { devices, baselineSize: baseline.size, examRows: exam.length, examSec };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!files.length) { console.error('사용법: node tools/analyze_logs.mjs 로그1.csv 로그2.csv ... [--json]'); process.exit(1); }
  const res = analyze(files.map((f) => readFileSync(f, 'utf8')));
  if (process.argv.includes('--json')) console.log(JSON.stringify(res, null, 2));
  else {
    console.log(`기준선 기기 ${res.baselineSize}개 · 시험 중 관측 ${res.examRows}건 · 시험 구간 ${Math.round(res.examSec ?? 0)}초`);
    console.log('※ 아래는 확인용 단서이며 부정행위의 증거가 아닙니다. 연결 중인 기기/셀룰러는 이 방식으로 볼 수 없습니다.\n');
    for (const d of res.devices.slice(0, 20)) {
      console.log(`${d.type} ${d.id}  활동 ${(d.activity * 100).toFixed(0)}%  관측 ${d.sightings}회  관측자 ${d.observers}명` +
        `  최강 ${d.strongest ? `${d.strongest.pos}(${d.strongest.observer}) ${d.strongest.rssi}dBm` : '-'}  후보 좌석 ${d.candidateSeats ? d.candidateSeats.join(', ') : '위치 정보 부족'}`);
    }
    if (!res.devices.length) console.log('기준선에 없던 새 기기가 없습니다.');
  }
}
