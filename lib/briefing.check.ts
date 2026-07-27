// 폴백 해석 문장 검증 — node --experimental-strip-types lib/briefing.check.ts
//
// AI가 죽거나 하루 한도에 걸린 날 화면에 나가는 문장이다. 여기서 볼 건 문장이 예쁜가가 아니라
// **점수를 읊던 옛 말투로 돌아가지 않았는가**다. 이 문장이 앉는 자리는 "내 조건으로 본 이 길"이고
// 부담점수·임계값은 같은 화면이 이미 큰 글씨로 보여준다 — 여기서 또 읊으면 자리가 비는 셈이다.

import assert from "node:assert";
import { briefing } from "./briefing.ts";
import { scoreRoutes, type DriverProfile, type RiskFactor } from "./score.ts";

const 초보: DriverProfile = {
  experienceYears: 1,
  drivingFrequency: "low",
  jejuExperience: false,
  vehicleSize: "compact",
  timeOfDay: "day",
};
const 경력자: DriverProfile = {
  experienceYears: 10,
  drivingFrequency: "high",
  jejuExperience: true,
  vehicleSize: "sedan",
  timeOfDay: "day",
};

const risk = (type: RiskFactor["type"], label: string, exposure: number): RiskFactor => ({
  type,
  label,
  location: "서귀포시 남원읍",
  coord: [33.3, 126.6],
  value: "급커브 42곳",
  exposure,
  source: "테스트",
});

// 실측 구간과 같은 모양: 최단거리 경로가 시간까지 3분 손해다
const fast = { name: "5.16도로 경유", durationMin: 68, risks: [risk("sharpCurve", "연속 급커브", 0.29)] };
const safe = { name: "평화로 경유", durationMin: 65, risks: [risk("highSpeed", "고속주행 구간", 0.48)] };
const 해석 = (p: DriverProfile, r = { fast, safe }) => briefing(p, scoreRoutes(p, r.fast, r.safe), r);

// --- ① 점수를 읊지 않는다 (옛 문장: "부담점수도 63.5점으로 편안 임계값 50점을 넘습니다") ---
for (const p of [초보, 경력자])
  for (const line of 해석(p))
    assert.ok(!/부담점수|임계값|\d+점/.test(line), `점수를 읊었다: ${line}`);

// --- ② 운전자 조건이 문장을 갈라야 한다 (없으면 붙이지 않는다) ---
assert.ok(해석(초보)[0].startsWith("운전을 시작한 지 얼마 안 됐다면 "), 해석(초보)[0]);
assert.ok(해석(경력자)[0].startsWith("두 경로 중에서는 "), 해석(경력자)[0]);

// --- ③ 세 문장이 각각 제 일을 한다 ---
const 초보해석 = 해석(초보);
assert.equal(초보해석.length, 3);
assert.ok(초보해석[0].includes("평화로 경유가 편합니다"), 초보해석[0]); // 추천은 scoreRoutes 가 정한 값
assert.ok(초보해석[0].includes("3분 빠르기도 합니다"), 초보해석[0]); // 시간 이득은 점수와 달리 바로 아는 정보다
assert.ok(초보해석[1].includes("고속주행 구간") && 초보해석[1].includes("48%"), 초보해석[1]);
assert.ok(초보해석[2].includes("압박") && 초보해석[2].includes("2차로"), 초보해석[2]); // 무슨 일이 생기나 + 어떻게
// 추천하지 않는 경로의 요인은 말하지 않는다 (lib/ai.ts verify 가 AI 문장에 거는 것과 같은 규칙)
assert.ok(!초보해석.join(" ").includes("연속 급커브"), 초보해석.join(" "));

// 받침 있는 이름에는 "이"가 붙는다 — 경로 이름이 데이터에서 오니 조사를 골라야 한다
assert.ok(
  해석(초보, { fast, safe: { ...safe, name: "한라산 관통길" } })[0].includes("한라산 관통길이 편합니다"),
);

// --- ④ 비교할 게 없을 때 ---
// 부담이 비슷하면 추천하지 않는다 — 없는 차이를 믿고 길을 고르게 하지 않는다
const 비슷 = 해석(초보, { fast, safe: { ...safe, risks: [risk("sharpCurve", "연속 급커브", 0.29)] } });
assert.ok(비슷[0].includes("익숙한 길"), 비슷[0]);
// 확인된 요인이 없으면 해석할 게 없다 — 두 문장으로 끝낸다 (없는 위험을 만들지 않는다)
const 요인없음 = 해석(초보, { fast: { ...fast, risks: [] }, safe: { ...safe, risks: [] } });
assert.deepEqual(요인없음.length, 2);
assert.ok(요인없음[1].includes("확인된 위험요인이 없습니다"), 요인없음[1]);

console.log("✅ 폴백 해석 문장 정상 — 점수 말투 없음, 조건별 분기·조사·빈 요인 처리 확인");
