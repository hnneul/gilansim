// 머니 샷 자체 검증 — node lib/score.check.ts
// ⚠️ 아래 위험요인은 검증용 더미다. 출처가 없어 실제 시나리오 데이터가 아니다.

import assert from "node:assert";
import { scoreRoutes, type DriverProfile, type RiskFactor } from "./score.ts";

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

console.log("✅ 머니 샷 성립");
