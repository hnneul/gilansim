// 주차장 프록시 검증 — node --experimental-strip-types lib/parking.check.ts
//
// 두 가지를 본다:
//   ① 판정 로직이 경계에서 맞는가 (평행주차 확률을 낮게 말하면 초보를 그대로 보내게 된다)
//   ② 프록시를 뒷받침하는 근거가 실제 데이터에 남아 있는가 — 데이터가 갱신돼 노상·노외
//      구획수 분포가 뒤집히면 "노상=평행"이라는 전제가 무너지므로 여기서 먼저 깨져야 한다.

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parallelOdds, recommendedSpots, type Parking, type ParkingSpot } from "./parking.ts";

const DATA = JSON.parse(readFileSync(fileURLToPath(new URL("../data/parking-data.json", import.meta.url)), "utf8"));

// --- ① 판정 로직 ---
const lot = (type: string, walkM: number): ParkingSpot => ({ name: type + walkM, type, spaces: 10, fee: "무료", walkM, at: [33, 126] });
const make = (onStreet: number, offStreet: number): Parking => ({
  label: "테스트",
  at: [33, 126],
  walkM: 1000,
  total: onStreet + offStreet,
  byType: { 노상: onStreet, 노외: offStreet },
  spots: [...Array(onStreet)].map((_, i) => lot("노상", i * 10)).concat([...Array(offStreet)].map((_, i) => lot("노외", 500 + i * 10))),
});

assert.equal(parallelOdds(make(0, 25)).level, "low"); // 노상 0곳 → 평행 걱정 없음
assert.equal(parallelOdds(make(1, 24)).level, "mixed"); // 한 곳이라도 있으면 low 가 아니다
assert.equal(parallelOdds(make(12, 13)).level, "mixed"); // 48% — 경계 바로 아래
assert.equal(parallelOdds(make(13, 12)).level, "high"); // 52% — 경계 바로 위
assert.equal(parallelOdds(make(1, 1)).level, "high"); // 50% 정확히 → 높은 쪽으로 판정한다
assert.equal(parallelOdds(make(5, 0)).level, "high"); // 전부 노상 = 최악
// 대안이 없으면 "노외를 먼저 보라"고 말하지 않는다 (없는 선택지를 권하면 안 된다)
assert.ok(!parallelOdds(make(5, 0)).detail.includes("먼저"));
assert.ok(parallelOdds(make(5, 1)).detail.includes("먼저"));

// --- 경력별 문구 ---
// 숫자 판정은 경력과 무관해야 한다. 말투만 갈린다 — 판정까지 갈리면 같은 주차장을 두 개로 세는 셈이다.
for (const [on, off] of [[0, 25], [1, 24], [13, 12], [5, 0]] as const) {
  const 초보 = parallelOdds(make(on, off), true);
  const 경력자 = parallelOdds(make(on, off), false);
  assert.equal(초보.level, 경력자.level, `level이 경력에 따라 달라졌다 (노상 ${on})`);
  assert.equal(초보.onStreet, 경력자.onStreet);
  assert.equal(초보.offStreet, 경력자.offStreet);
  assert.notEqual(초보.headline, 경력자.headline, `헤드라인이 안 갈렸다 (노상 ${on})`);
}

// 경력자에게는 권유하지 않는다 — 안 지킬 조언은 경고의 신뢰도만 깎는다
assert.ok(!parallelOdds(make(5, 1), false).detail.includes("먼저"));
assert.ok(!parallelOdds(make(1, 24), false).detail.includes("피할 수 있습니다"));
assert.ok(parallelOdds(make(1, 24), true).detail.includes("피할 수 있습니다"));

// 사실(구획 수·비율)은 양쪽 모두에 남는다 — 말투를 낮추면서 숫자까지 빼면 안 된다
for (const novice of [true, false]) {
  const d = parallelOdds(make(13, 12), novice).detail;
  assert.ok(d.includes("13곳") && d.includes("52%"), `사실이 빠졌다 (novice=${novice})`);
}

// 기본값은 초보 — 인자를 잊은 호출이 경고를 약하게 만들면 안 된다
assert.deepEqual(parallelOdds(make(13, 12)), parallelOdds(make(13, 12), true));

// 개수는 유형 합계가 아니라 total 기준 — 부설 등 제3의 유형이 들어와도 노상이 아니면 노상이 아니다
const withOther: Parking = { ...make(2, 0), total: 10, byType: { 노상: 2 } };
assert.equal(parallelOdds(withOther).offStreet, 8);
assert.equal(parallelOdds(withOther).level, "mixed");

// 추천은 노상을 빼고 가까운 순
const rec = recommendedSpots(make(3, 5));
assert.equal(rec.length, 3);
assert.ok(rec.every((s) => s.type !== "노상"), "노상을 추천하면 안 된다");
assert.deepEqual(rec.map((s) => s.walkM), [500, 510, 520]);
assert.equal(recommendedSpots(make(5, 0)).length, 0);

// --- ② 프록시 근거 (data/parking-data.json) ---
const { 노상: on, 노외: off } = DATA.stats;
assert.ok(off, "노외 표본이 없다");
if (on) {
  // 노상이 노외보다 작은 구획 위주여야 "도로변 몇 칸 = 평행주차"라는 해석이 성립한다
  assert.ok(on.medianSpaces < off.medianSpaces, `노상 중앙값(${on.medianSpaces}면)이 노외(${off.medianSpaces}면)보다 작아야 한다`);
  assert.ok(on.under10Pct > off.under10Pct, "노상이 10면 이하 비중이 더 높아야 한다");
}

/** 두 좌표 사이 미터 (build-parking-data.mjs 와 같은 평면 근사) */
const rad = (deg: number) => (deg * Math.PI) / 180;
const meters = ([la1, lo1]: number[], [la2, lo2]: number[]) =>
  Math.hypot(la2 - la1, (lo2 - lo1) * Math.cos(rad(la1))) * rad(1) * 6371000;

for (const [id, d] of Object.entries(DATA.byDestination) as [string, Parking][]) {
  assert.ok(d.spots.every((s) => s.walkM <= DATA.walkM), `${id}: 도보 반경 밖 주차장이 섞였다`);

  // 지도에 찍을 좌표 — 결측(위경도 없는 85곳)이 새면 엉뚱한 데 핀이 박힌다
  assert.ok(d.at?.length === 2 && d.at.every(Number.isFinite), `${id}: 목적지 좌표가 없다`);
  for (const s of d.spots) {
    assert.ok(s.at?.length === 2 && s.at.every(Number.isFinite), `${id}/${s.name}: 좌표가 없다`);
    // walkM 은 생성 때 계산한 값이다. 좌표에서 다시 재도 같아야 둘이 어긋나지 않는다.
    const 재계산 = meters(d.at, s.at);
    assert.ok(Math.abs(재계산 - s.walkM) < 2, `${id}/${s.name}: 좌표와 walkM 불일치 (${Math.round(재계산)} vs ${s.walkM})`);
    assert.ok(재계산 <= DATA.walkM, `${id}/${s.name}: 좌표가 반경 밖`);
  }
  assert.deepEqual(d.spots.map((s) => s.walkM), [...d.spots.map((s) => s.walkM)].sort((a, b) => a - b), `${id}: 거리순이 아니다`);
  assert.ok(d.spots.length <= d.total);
  assert.ok(d.spots.every((s) => s.type === "노상" || s.type === "노외"), `${id}: 모르는 주차장유형`);
  if (d.total) parallelOdds(d); // 실데이터로도 던지지 않는다
}

console.log("✅ 주차장 평행·직각 프록시 판정 정상");
console.log("   유형별 구획수:", DATA.stats);
for (const [id, d] of Object.entries(DATA.byDestination) as [string, Parking][])
  console.log(`   ${id.padEnd(9)} ${d.total}곳`, d.byType, d.total ? `→ ${parallelOdds(d).level}` : "");
