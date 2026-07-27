// 머니 샷 자체 검증 (점수 엔진 + 브리핑) — node lib/score.check.ts
// ⚠️ 아래 위험요인은 검증용 더미다. 출처가 없어 실제 시나리오 데이터가 아니다.

import assert from "node:assert";
import { scoreRoutes, type DriverProfile, type RiskFactor } from "./score.ts";
import { briefing } from "./briefing.ts";

const dummy = (type: RiskFactor["type"], label: string): RiskFactor => ({
  type,
  label,
  location: "-",
  coord: [0, 0],
  value: "-",
  source: "검증용 더미 (실데이터 아님)",
});

const FAST = [
  dummy("accidentZone", "사고다발구간"),
  dummy("sharpCurve", "연속 급커브"),
  dummy("steepSlope", "급경사"),
];
const SAFE = [dummy("complexJunction", "복잡 교차로"), dummy("highSpeed", "고속주행 구간")];

const 초보: DriverProfile = {
  experienceYears: 1,
  drivingFrequency: "low",
  jejuExperience: false,
  vehicleSize: "suv",
  timeOfDay: "day",
};
const 베테랑: DriverProfile = {
  experienceYears: 10,
  drivingFrequency: "high",
  jejuExperience: true,
  vehicleSize: "sedan",
  timeOfDay: "day",
};

const a = scoreRoutes(초보, FAST, SAFE);
const b = scoreRoutes(베테랑, FAST, SAFE);

console.log("초보  ", a.recommendedRoute, `fast=${a.fastScore} safe=${a.safeScore}`);
console.log("베테랑", b.recommendedRoute, `fast=${b.fastScore} safe=${b.safeScore}`);

// 머니 샷: 같은 경로 · 같은 위험요인 · 프로필만 바꿨을 때 추천이 뒤집힌다
assert.equal(a.recommendedRoute, "safe", "초보에게는 저부담 경로를 추천해야 한다");
assert.equal(b.recommendedRoute, "fast", "베테랑에게는 빠른 경로를 추천해야 한다");

// 고속주행은 초보에게만 적용된다
assert.ok(a.breakdown.some((r) => r.risk.label === "고속주행 구간"));
assert.ok(!b.breakdown.some((r) => r.risk.label === "고속주행 구간"));

// 근거 카드가 비지 않는다 (§3: 부담 요인 2개 이상)
assert.ok(a.breakdown.filter((r) => r.route === "fast").length >= 2);

// 결정론적: 같은 입력이면 같은 출력
assert.deepEqual(scoreRoutes(초보, FAST, SAFE), a);

// --- 브리핑 (폴백) ---

const 이름 = { fast: "5.16도로 경유", safe: "평화로 경유" };
const 초보브리핑 = briefing(초보, a, 이름);
const 베테랑브리핑 = briefing(베테랑, b, 이름);

console.log("\n[초보]  ", 초보브리핑.join("\n         "));
console.log("[베테랑]", 베테랑브리핑.join("\n         "));

// 프로필을 바꾸면 브리핑도 통째로 달라진다
assert.notDeepEqual(초보브리핑, 베테랑브리핑);
assert.equal(초보브리핑.length, 3);

// 추천된 경로를 브리핑한다 (실제로 달릴 길)
assert.ok(초보브리핑[0].startsWith(이름.safe));
assert.ok(베테랑브리핑[0].startsWith(이름.fast));

// 미확보 상태인 risk.value가 문장에 새어나가지 않는다
for (const line of [...초보브리핑, ...베테랑브리핑]) {
  assert.ok(!line.includes("미확보"), `출처 미확보 값이 문장에 노출됨: ${line}`);
}

console.log("\n✅ 머니 샷 성립 + 브리핑 정상");
