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

// 실측(data/route-data.json): 5.16도로 80분 / 평화로 71분 — 최단거리 경로가 오히려 9분 느리다
const 빠른경로 = { risks: FAST, durationMin: 80 };
const 저부담경로 = { risks: SAFE, durationMin: 71 };

const a = scoreRoutes(초보, 빠른경로, 저부담경로);
const b = scoreRoutes(베테랑, 빠른경로, 저부담경로);

console.log("초보  ", a.recommendedRoute, `fast=${a.fastScore} safe=${a.safeScore}`);
console.log("베테랑", b.recommendedRoute, `fast=${b.fastScore} safe=${b.safeScore}`);

// 최단거리 경로가 시간까지 손해면 부담이 낮아도 추천하지 않는다
assert.equal(a.recommendedRoute, "safe", "초보에게는 저부담 경로를 추천해야 한다");
assert.equal(b.recommendedRoute, "safe", "시간 이득이 없으면 베테랑에게도 저부담 경로다");

// 부담점수는 프로필에 따라 크게 달라진다 (PDF Core 완료 기준)
assert.ok(a.fastScore > b.fastScore * 1.5, "초보의 부담점수가 베테랑보다 뚜렷이 높아야 한다");

// 고속주행은 초보에게만 적용된다
assert.ok(a.breakdown.some((r) => r.factor === "고속주행 구간"));
assert.ok(!b.breakdown.some((r) => r.factor === "고속주행 구간"));

// 근거 카드가 비지 않는다 (§3: 부담 요인 2개 이상)
assert.ok(a.breakdown.filter((r) => r.route === "fast").length >= 2);

// 결정론적: 같은 입력이면 같은 출력
assert.deepEqual(scoreRoutes(초보, 빠른경로, 저부담경로), a);

// --- 브리핑 (폴백) ---

const 이름 = { fast: "5.16도로 경유", safe: "평화로 경유" };
const 경로 = {
  fast: { name: 이름.fast, risks: FAST, durationMin: 80 },
  safe: { name: 이름.safe, risks: SAFE, durationMin: 71 },
};
const 초보브리핑 = briefing(초보, a, 경로);
const 베테랑브리핑 = briefing(베테랑, b, 경로);

console.log("\n[초보]  ", 초보브리핑.join("\n         "));
console.log("[베테랑]", 베테랑브리핑.join("\n         "));

// 같은 경로를 추천하더라도 이유가 달라진다 (PDF Core: "부담도 또는 추천 이유가 달라진다")
assert.notDeepEqual(초보브리핑, 베테랑브리핑);
assert.notEqual(초보브리핑[0], 베테랑브리핑[0], "추천 이유 문장이 프로필에 따라 달라야 한다");
assert.equal(초보브리핑.length, 3);

// 추천된 경로를 브리핑한다 (실제로 달릴 길)
assert.ok(초보브리핑[0].startsWith(이름.safe));
assert.ok(베테랑브리핑[0].startsWith(이름.safe));

// 시간 손해를 문장에서 밝힌다 — 이 시나리오의 핵심 사실
for (const b of [초보브리핑, 베테랑브리핑]) {
  assert.ok(b[0].includes("9분"), `최단거리 경로의 시간 손해가 문장에 없음: ${b[0]}`);
}

// 미확보 상태인 risk.value가 문장에 새어나가지 않는다
for (const line of [...초보브리핑, ...베테랑브리핑]) {
  assert.ok(!line.includes("미확보"), `출처 미확보 값이 문장에 노출됨: ${line}`);
}

console.log("\n✅ 추천 이유 개인화 + 브리핑 정상");
