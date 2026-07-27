// 머니 샷 자체 검증 (점수 엔진 + 브리핑) — node lib/score.check.ts
// ⚠️ 아래 위험요인은 검증용 더미다. 출처가 없어 실제 시나리오 데이터가 아니다.

import assert from "node:assert";
import { scoreRoutes, type DriverProfile, type RiskFactor } from "./score.ts";
import { briefing } from "./briefing.ts";

/** exposure를 안 주면 기준 노출(20%)로 둔다 — 노출 배수 1.0이라 기존 기대값과 비교하기 쉽다 */
const dummy = (type: RiskFactor["type"], label: string, exposure = 0.2): RiskFactor => ({
  type,
  label,
  location: "-",
  coord: [0, 0],
  value: "-",
  exposure,
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

// --- 실시간 교통이 뒤집는 경우 ---
// 굳힌 값에서는 최단거리 경로가 항상 더 느려서 위 분기만 돌았다. lib/traffic.ts 가
// 실시간 소요시간을 넣기 시작하면(평화로에 사고·정체) 아래 분기가 처음으로 갈린다.
// 여기가 §5 추천 규칙의 "시간을 얻는 대신 부담을 감수한다"는 교환이 실제로 계산되는 자리다.
const 정체난저부담 = { risks: SAFE, durationMin: 85 }; // 평화로가 막혀 5.16도로보다 5분 느려짐

const c = scoreRoutes(초보, 빠른경로, 정체난저부담);
const d = scoreRoutes(베테랑, 빠른경로, 정체난저부담);
console.log("실시간 역전 — 초보  ", c.recommendedRoute, `fast=${c.fastScore} safe=${c.safeScore}`);
console.log("실시간 역전 — 베테랑", d.recommendedRoute, `fast=${d.fastScore} safe=${d.safeScore}`);

// 초보: 시간 이득이 생겨도 부담점수가 임계값을 넘고 저부담 쪽이 30% 이상 낮으므로 저부담 유지.
// 추천은 그대로여도 이유가 "시간 이득 없음"에서 "부담 차이가 커서"로 바뀐다 — 브리핑이 달라진다.
assert.equal(c.recommendedRoute, "safe", "초보는 시간 이득보다 부담 차이가 크면 저부담 경로다");
assert.ok(
  !c.reasons[0].includes("시간 이득이 없음"),
  `실시간 역전 시 추천 이유가 바뀌어야 한다: ${c.reasons[0]}`,
);

// 베테랑: 부담점수가 임계값 이하라 시간 이득이 생기면 최단거리 경로로 넘어간다
assert.equal(d.recommendedRoute, "fast", "베테랑은 부담이 임계값 이하면 빠른 쪽을 추천한다");

// 고속주행은 경력이 쌓이면 부담이 크게 줄지만 요인 자체는 남는다.
// 요인을 제거해버리면 베테랑의 근거 카드가 한 줄로 비어 완료 기준(2개 이상)에 미달했다.
const 초보고속 = a.breakdown.find((r) => r.factor === "고속주행 구간");
const 베테랑고속 = b.breakdown.find((r) => r.factor === "고속주행 구간");
assert.ok(초보고속 && 베테랑고속, "고속주행 요인이 사라졌다");
assert.ok(
  베테랑고속.weighted < 초보고속.weighted * 0.3,
  `경력에 따른 감소가 부족: ${초보고속.weighted} → ${베테랑고속.weighted}`,
);

// 근거 카드가 비지 않는다 — 어떤 프로필에서도 경로마다 부담요인 2개 이상 (PDF Supporting 1 완료 기준)
for (const [name, r] of [["초보", a], ["베테랑", b]] as const)
  for (const route of ["fast", "safe"] as const)
    assert.ok(
      r.breakdown.filter((x) => x.route === route).length >= 2,
      `${name}/${route} 부담요인 2개 미달`,
    );

// 결정론적: 같은 입력이면 같은 출력
assert.deepEqual(scoreRoutes(초보, 빠른경로, 저부담경로), a);

// --- 부담이 낮은 쪽을 추천한다 ---
// 실측(공항→성산일출봉): 소요시간이 60분 = 60분으로 같아 "시간 이득 없음" 분기로 떨어지면서
// 부담 36점 경로가 35.9점 경로를 제치고 "맞춤 저부담 · 추천" 배지를 달았다.
// 점수를 계산해 놓고 안 보는 분기였다. 이제 ① 차이가 무의미하면 추천을 접고,
// ② 시간 이득이 없으면 부담이 낮은 쪽을 고른다.
const 큰부담 = { risks: [dummy("narrowRoad", "좁은 교행", 0.3)], durationMin: 60 };
const 작은부담 = { risks: [dummy("narrowRoad", "좁은 교행", 0.05)], durationMin: 60 };
const 같은부담 = { risks: [dummy("narrowRoad", "좁은 교행", 0.3)], durationMin: 60 };

const 무의미 = scoreRoutes(초보, 큰부담, 같은부담);
assert.equal(무의미.recommendedRoute, "single", `부담이 같으면 추천을 접어야 한다: ${무의미.fastScore}/${무의미.safeScore}`);

// fast 쪽이 부담이 낮은데 시간 이득도 없는 경우 — 전에는 무조건 safe 였다
const 역전 = scoreRoutes(초보, 작은부담, 큰부담);
assert.equal(
  역전.recommendedRoute,
  "fast",
  `부담이 낮은 쪽을 추천해야 한다: fast=${역전.fastScore} safe=${역전.safeScore}`,
);

// 브리핑 문장도 추천을 따라가야 한다 (전에는 시간손해만 보고 safe 를 추천한다고 썼다)
const 역전브리핑 = briefing(초보, 역전, {
  fast: { name: "가벼운길", risks: 작은부담.risks, durationMin: 60 },
  safe: { name: "무거운길", risks: 큰부담.risks, durationMin: 60 },
});
assert.ok(역전브리핑[0].startsWith("가벼운길"), `브리핑이 추천과 어긋난다: ${역전브리핑[0]}`);
const 무의미브리핑 = briefing(초보, 무의미, {
  fast: { name: "가길", risks: 큰부담.risks, durationMin: 60 },
  safe: { name: "나길", risks: 같은부담.risks, durationMin: 60 },
});
assert.ok(무의미브리핑[0].includes("차이가 크지 않습니다"), `추천을 접은 구간의 브리핑: ${무의미브리핑[0]}`);

// --- 노출 크기 반영 ---
// 같은 종류의 요인이라도 노출이 길면 점수가 커야 한다.
// 실데이터에서 좁은 길 13.1km(31%)와 1.6km(3%)가 똑같이 28.4점으로 나왔던 버그의 회귀 방지.
const 긴좁은길 = { risks: [dummy("narrowRoad", "좁은 교행", 0.31)], durationMin: 80 };
const 짧은좁은길 = { risks: [dummy("narrowRoad", "좁은 교행", 0.03)], durationMin: 71 };
const 노출 = scoreRoutes(초보, 긴좁은길, 짧은좁은길);
assert.ok(
  노출.fastScore > 노출.safeScore * 3,
  `노출 차이가 점수에 반영되지 않음: ${노출.fastScore} vs ${노출.safeScore}`,
);

// 근거 카드가 곱셈식을 복원할 수 있어야 한다 (기본 × 노출 × 조건 = 점수)
for (const row of a.breakdown) {
  const 복원 = Math.round(row.base * row.exposure * row.multiplier * 10) / 10;
  assert.equal(복원, row.weighted, `${row.factor} 곱셈식 불일치: ${복원} ≠ ${row.weighted}`);
  assert.ok(row.exposure > 0 && row.multiplier > 0);
}

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
