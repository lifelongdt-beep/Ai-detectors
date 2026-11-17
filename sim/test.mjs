// 사용법: node sim/test.mjs   — 센서 수/캘리브레이션별 위치 추정 정확도를 통계로 출력
import { Simulation } from './engine.js';

const median = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const TRIALS = 40, DURATION = 150;
console.log(`단일 스마트폰 AI 질의 시나리오, ${TRIALS}회 x ${DURATION}초 (좌석 간격 2.0m x 1.1m)\n`);
console.log('센서수 | 캘리브레이션 | 수평오차(중앙값) | 3D오차(중앙값) | 좌석 1순위 | 좌석 3순위내 | 경고도달');
for (const calibrated of [false, true]) for (const n of [4, 6, 8, 12]) {
  const eH = [], e3 = []; let t1 = 0, t3 = 0, cnt = 0, alarm = 0;
  for (let seed = 1; seed <= TRIALS; seed++) {
    const sim = new Simulation({ seed, sensorCount: n, calibrated, scenario: 'phone' });
    sim.advance(DURATION);
    const tr = [...sim.tracks.values()].find((x) => sim.truthFor(x) && sim.truthFor(x).emitter.cheat);
    if (!tr) continue;
    const tf = sim.truthFor(tr); if (!tf) continue;
    cnt++; eH.push(tf.errH); e3.push(tf.err3); if (tf.top1) t1++; if (tf.top3) t3++; if (tr.level >= 2) alarm++;
  }
  const pct = (x) => `${Math.round((100 * x) / cnt)}%`.padStart(4);
  console.log(`${String(n).padStart(5)} | ${String(calibrated ? '사용' : '미사용').padEnd(9)} | ${median(eH).toFixed(2).padStart(9)} m | ${median(e3).toFixed(2).padStart(9)} m | ${pct(t1)} | ${pct(t3)} | ${pct(alarm)}`);
}

// 오탐 점검: 정상 시험(감독관 폰만) 에서 학생 구역 경보가 없어야 함
let fp = 0;
for (let seed = 1; seed <= TRIALS; seed++) {
  const sim = new Simulation({ seed, sensorCount: 8, calibrated: false, scenario: 'clean' });
  sim.advance(300);
  if ([...sim.tracks.values()].some((t) => !t.excluded && t.level >= 2)) fp++;
}
console.log(`\n정상 시험 오탐(주의 이상 경보 발생) : ${fp}/${TRIALS} 회 (감독관 폰만 존재, 센서 8개)`);
