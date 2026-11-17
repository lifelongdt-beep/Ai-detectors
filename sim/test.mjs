// 사용법: node sim/test.mjs   — 센서 구성별 탐지율·위치 정확도·오탐 통계
import { Simulation } from './engine.js';

const median = (a) => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const QUICK = process.argv.includes('--quick'); // CI용 스모크 테스트
const TRIALS = QUICK ? 3 : 30, DURATION = QUICK ? 90 : 180;
const pct = (x, n) => (n ? `${Math.round((100 * x) / n)}%` : '-').padStart(4);

const CONFIGS = [
  ['고정 4개', { sensorMode: 'fixed', sensorCount: 4 }],
  ['고정 8개', { sensorMode: 'fixed', sensorCount: 8 }],
  ['고정 8개+캘리브레이션', { sensorMode: 'fixed', sensorCount: 8, calibrated: true }],
  ['감독관 전용 단말 6대 (순찰)', { sensorMode: 'phones' }],
  ['감독관 전용 단말 6대 (제자리)', { sensorMode: 'phones', patrol: { room: false, hall: false } }],
  ['혼합 (고정4 + 폰6)', { sensorMode: 'hybrid', sensorCount: 4 }],
];
// 기기 유형별로 따로 평가 (phone=LTE, earbud=BLE+LTE, wearable=BLE+WIFI)
const SCEN = QUICK ? [['phone', '스마트폰(LTE)']] : [['phone', '스마트폰(LTE)'], ['earbud', '이어폰(BLE)+폰(LTE)'], ['wearable', '워치(BLE)+안경(WiFi)']];

console.log(`부정행위 기기 탐지율 / 위치 정확도 (${TRIALS}회 x ${DURATION}초, 좌석 간격 2.0m x 1.1m)\n`);
for (const [sk, sname] of SCEN) {
  console.log(`■ ${sname}`);
  console.log('구성                        | 기기 탐지율 | 수평오차(중앙값) | 좌석 1순위 | 3순위내');
  for (const [name, opts] of CONFIGS) {
    let total = 0, found = 0, t1 = 0, t3 = 0, loc = 0; const eH = [];
    for (let seed = 1; seed <= TRIALS; seed++) {
      const sim = new Simulation({ seed, scenario: sk, ...opts });
      sim.advance(DURATION);
      for (const e of sim.emitters.filter((x) => x.cheat)) {
        total++;
        const tr = sim.tracks.get(e.id);
        if (!tr) continue;
        found++;
        const tf = sim.truthFor(tr);
        if (!tf) continue;
        loc++; eH.push(tf.errH); if (tf.top1) t1++; if (tf.top3) t3++;
      }
    }
    console.log(`${name.padEnd(24)} | ${pct(found, total)}        | ${Number.isNaN(median(eH)) ? '   -' : median(eH).toFixed(2).padStart(7) + ' m'}      | ${pct(t1, total)}       | ${pct(t3, total)}`);
  }
  console.log('');
}

// 오탐 점검: 정상 시험(감독관 석 폰만) 에서 학생 구역 경보가 없어야 함
if (QUICK) { console.log('quick 모드: 오탐 점검 생략'); process.exit(0); }
console.log('■ 정상 시험 오탐 (감독관 석 폰만 존재, 주의 이상 경보 발생 횟수)');
for (const [name, opts] of CONFIGS) {
  let fp = 0;
  for (let seed = 1; seed <= TRIALS; seed++) {
    const sim = new Simulation({ seed, scenario: 'clean', ...opts });
    sim.advance(300);
    if ([...sim.tracks.values()].some((t) => !t.excluded && t.level >= 2)) fp++;
  }
  console.log(`${name.padEnd(24)} | ${fp}/${TRIALS}`);
}
