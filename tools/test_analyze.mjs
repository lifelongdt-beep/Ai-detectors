// 합성 로그로 분석 도구 검증: node tools/test_analyze.mjs
import { analyze, posXZ } from './analyze_logs.mjs';
import assert from 'node:assert/strict';

const truth = posXZ('R3-C2'); // 숨은 기기 위치 (x=4, z=4.4)
const rssiAt = (p, base = -40) => base - 26 * Math.log10(Math.max(0.7, Math.hypot(posXZ(p).x - truth.x, posXZ(p).z - truth.z)));
const rows = [];
const emit = (t, obs, phase, pos, type, id, rssi) => rows.push(`${t},${obs},${phase},${pos},${type},${id},${Math.round(rssi)},0`);
// 기준선: 공유기(모든 위치에서 약 -50) — 정상 기기
for (let t = 0; t < 60; t++) for (const [o, p] of [['교실1', 'R1-C3'], ['교실2', 'R6-C1'], ['복도1', 'H1']]) emit(t * 1000, o, 'BASE', p, 'WIFI', 'router01', -50);
// 시험: 공유기는 계속, 새 기기는 R3-C2 근처에서 송신. 관측자들이 순찰하며 위치를 바꿈
const patrol = { 교실1: ['R2-C1', 'R3-C1', 'R3-C3', 'R4-C2'], 교실2: ['R5-C5', 'R4-C4', 'R3-C4', 'R2-C3'], 복도1: ['H1', 'H2', 'H2', 'H1'] };
for (let t = 100; t < 400; t++) for (const [o, ps] of Object.entries(patrol)) {
  const p = ps[Math.floor((t - 100) / 75) % ps.length];
  emit(t * 1000, o, 'EXAM', p, 'WIFI', 'router01', -50);
  if (t % 2 === 0) emit(t * 1000, o, 'EXAM', p, 'BLE', 'dev1abcd', rssiAt(p) - (o.startsWith('복도') ? 9 : 0));
}
const res = analyze([rows.slice(0, rows.length >> 1).join('\n'), rows.slice(rows.length >> 1).join('\n')]);

assert.equal(res.devices.length, 1, '기준선(공유기)은 제외되고 새 기기 1개만 남아야 함');
const d = res.devices[0];
assert.equal(d.id, 'dev1abcd');
assert.ok(d.activity > 0.3, `활동도 ${d.activity}`);
const err = Math.hypot(d.est.x - truth.x, d.est.z - truth.z);
assert.ok(err < 1.3, `위치 오차 ${err.toFixed(2)}m`);
assert.ok(d.candidateSeats.includes('R3-C2') || d.candidateSeats.some((s) => ['R3-C1', 'R3-C3', 'R2-C2', 'R4-C2'].includes(s)), `후보 ${d.candidateSeats}`);
console.log(`OK: 새 기기 ${d.id}, 오차 ${err.toFixed(2)} m, 후보 좌석 ${d.candidateSeats.join(', ')}, 활동 ${(d.activity * 100).toFixed(0)}%`);
