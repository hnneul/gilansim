// AI 응답 검증기 검증 — node --experimental-strip-types lib/ai.check.ts
//
// 네트워크를 타지 않는다. 여기서 지켜야 할 건 모델이 좋은 문장을 쓰는가가 아니라,
// **나쁜 응답을 확실히 버리는가**다. 검증기가 새면 계획서의 "확인되지 않은 위험요인은
// 생성하지 않는다"가 프롬프트에 적힌 부탁으로만 남는다 — 모델은 언제든 어길 수 있다.
//
// 실제 모델 응답 확인은 lib/ai.smoke.ts 가 한다 (키가 필요해 따로 뒀다).

import assert from "node:assert";
import { verify, promptOf, factsOf, type Facts } from "./ai.ts";
import { scoreRoutes, type DriverProfile, type RiskFactor } from "./score.ts";

const 초보: DriverProfile = {
  experienceYears: 1,
  drivingFrequency: "low",
  jejuExperience: false,
  vehicleSize: "compact",
  timeOfDay: "day",
};

const risk = (type: RiskFactor["type"], label: string, exposure: number): RiskFactor => ({
  type,
  label,
  location: "서귀포시 남원읍 하례리",
  coord: [33.3, 126.6],
  value: "급커브 42곳",
  exposure,
  source: "테스트",
});

const 경로 = [
  { name: "5.16도로 경유", badge: "내비 최단거리", durationMin: 63, distanceKm: 43, risks: [risk("sharpCurve", "연속 급커브", 0.29)] },
  { name: "평화로 경유", badge: "맞춤 저부담", durationMin: 58, distanceKm: 52.8, risks: [risk("highSpeed", "고속주행 구간", 0.48)] },
];
const result = scoreRoutes(초보, 경로[0], 경로[1]);
const facts = factsOf("제주공항 → 서귀포 매일올레시장", 초보, result, 경로);
const prompt = promptOf(facts);

// --- ① 사실 묶음에 필요한 게 다 담기는가 ---
assert.equal(facts.경로.length, 2);
assert.equal(facts.추천경로, "평화로 경유", "추천은 계산이 정한 값이어야 한다");
assert.ok(facts.운전자조건.includes("운전경력 1년 이하"), "가중치 조건이 빠졌다");
assert.ok(facts.경로[0].요인[0].행동수칙.includes("커브"), "행동수칙을 AI에게 줘야 한다");
// 프롬프트에 사실이 실제로 들어갔는가 — 숫자 검증이 이 문자열을 기준으로 돈다
assert.ok(prompt.includes("63") && prompt.includes("52.8"), "소요시간·거리가 프롬프트에 없다");
// 요인별 점수는 주지 않는다 — 모델이 다른 경로의 점수를 붙이는 걸 막으려고 뺐다
// 여는 따옴표까지 붙여 본다 — 그냥 `점수":` 로 보면 경로 단위 `"부담점수":` 에 걸린다
assert.ok(!prompt.includes('"점수":'), "요인에 점수가 실려 있다");
assert.ok(prompt.includes('"부담점수":'), "경로 단위 부담점수는 있어야 한다");

// 요인은 부담이 큰 순서여야 한다. 두 경로에 같은 이름의 요인이 있을 때가 함정이다 —
// breakdown 을 factor 만으로 찾으면 항상 fast 행이 잡혀 safe 의 정렬이 뒤집힌다.
// 실제로 그렇게 틀렸고, 모델이 "부담이 가장 큰 요인은 (2순위 요인)"이라고 말해서 드러났다.
const 같은이름 = factsOf("정렬", 초보, ...(() => {
  const rs = [
    { ...경로[0], risks: [risk("narrowRoad", "좁은 교행 구간", 0.31), risk("sharpCurve", "연속 급커브", 0.29)] },
    { ...경로[1], risks: [risk("narrowRoad", "좁은 교행 구간", 0.03), risk("highSpeed", "고속주행 구간", 0.48)] },
  ];
  return [scoreRoutes(초보, rs[0], rs[1]), rs] as const;
})());
// safe: 좁은 교행 5.1 < 고속주행 24.4 — 여기가 뒤집혔던 자리다
assert.equal(같은이름.경로[1].요인[0].이름, "고속주행 구간", "safe 요인 정렬이 뒤집혔다");
// fast: 좁은 교행 31.5 < 급커브 35.3 (노출은 좁은 교행이 크지만 기본점수가 급커브가 높다)
assert.equal(같은이름.경로[0].요인[0].이름, "연속 급커브", "fast 요인 정렬이 틀렸다");

// --- ② 정상 응답은 통과한다 ---
// 숫자는 이 픽스처가 실제로 계산한 값이어야 한다 (fast 35.3 / safe 24.4).
// 처음엔 실제 화면에서 본 63.5를 적었다가 ④의 검증에 걸렸다 — 검증기가 의도대로 동작한다는 뜻이다.
const 정상 = {
  summary: "5.16도로 경유는 5분 더 걸리고 부담점수도 35.3점으로 더 높습니다.",
  briefing: [
    "평화로 경유를 추천합니다. 5.16도로 경유는 부담점수 35.3점으로 부담이 더 큽니다.",
    "고속주행 구간이 부담이 큽니다. 주변 차가 빨라도 무리해서 속도를 맞출 필요는 없습니다.",
  ],
};
assert.ok(verify(정상, facts), "정상 응답이 걸러졌다");
assert.equal(verify(정상, facts)!.briefing.length, 2);

// --- ③ 확인되지 않은 요인을 말하면 버린다 (계획서 원칙) ---
const 금지문장 = [
  "이 구간은 사고다발 지점을 2곳 지납니다.",
  "급경사 구간이 이어집니다.",
  "안개가 끼면 더 위험합니다.",
  "날씨에 따라 달라질 수 있습니다.",
  "어린이보호구역을 지납니다.",
];
for (const s of 금지문장)
  assert.equal(verify({ ...정상, briefing: [정상.briefing[0], s] }, facts), null, `걸러야 한다: ${s}`);
// summary 쪽도 같은 기준으로 본다 — 근거 카드에 올라가는 문장이다
assert.equal(verify({ ...정상, summary: "사고다발구간이 더 많습니다." }, facts), null);

// --- ④ 주지 않은 숫자를 만들면 버린다 ---
assert.equal(
  verify({ ...정상, briefing: [정상.briefing[0], "급커브가 118곳 있습니다."] }, facts),
  null,
  "사실에 없는 숫자를 통과시켰다",
);
// 사실에 있는 숫자는 통과한다 (43km, 42곳은 프롬프트에 있다)
assert.ok(verify({ ...정상, briefing: [정상.briefing[0], "43km 구간에 급커브 42곳이 있습니다."] }, facts));

// --- ④-2 브리핑은 추천 경로의 요인만 말한다 (Supporting 2 완료 기준) ---
// 추천은 평화로(safe)이므로 5.16도로에만 있는 "연속 급커브"는 브리핑에 못 나온다.
// 실제 모델이 이걸 어기는 걸 봤다 — 프롬프트 지시만으로는 안 막힌다.
assert.equal(facts.추천경로, "평화로 경유");
assert.equal(
  verify({ ...정상, briefing: [정상.briefing[0], "연속 급커브 구간에서는 미리 속도를 줄이세요."] }, facts),
  null,
  "추천하지 않는 경로의 요인이 브리핑에 통과했다",
);
// 같은 이름의 요인이 양쪽에 다 있으면 언급해도 위반이 아니다
const 공통 = factsOf("테스트", 초보, result, [
  { ...경로[0], risks: [risk("narrowRoad", "좁은 교행 구간", 0.29)] },
  { ...경로[1], risks: [risk("narrowRoad", "좁은 교행 구간", 0.48)] },
]);
assert.ok(
  verify({ summary: "두 경로 모두 좁은 교행 구간이 있습니다.", briefing: ["평화로 경유를 추천합니다.", "좁은 교행 구간에서는 넓은 곳에서 기다렸다가 교행하세요."] }, 공통),
  "양쪽에 공통인 요인은 브리핑에 쓸 수 있어야 한다",
);
// summary 에서 두 경로를 비교하는 건 막지 않는다 (Supporting 1 이 요구하는 일이다)
assert.ok(
  verify({ ...정상, summary: "5.16도로 경유는 연속 급커브가 있어 부담이 더 큽니다." }, facts),
  "summary 의 경로 비교를 막아버렸다",
);

// --- ⑤ 문장 수 제약 (완료 기준 "2~3개의 짧은 문장") ---
assert.equal(verify({ ...정상, briefing: ["한 문장뿐"] }, facts), null, "1문장은 미달이다");
assert.equal(verify({ ...정상, briefing: ["가", "나", "다", "라"] }, facts), null, "4문장은 초과다");
// 빈 문장은 개수에서 빼고 센다 — 공백으로 개수를 맞추면 안 된다
assert.equal(verify({ ...정상, briefing: [정상.briefing[0], "  "] }, facts), null);

// --- ⑥ 망가진 응답 ---
for (const bad of [null, undefined, 42, "문자열", {}, { summary: "요약만" }, { briefing: ["가", "나"] }, { summary: "", briefing: ["가", "나"] }])
  assert.equal(verify(bad, facts), null, `걸러야 한다: ${JSON.stringify(bad)}`);

console.log("✅ AI 응답 검증기 정상");
console.log(`   프롬프트 ${prompt.length}자 · 금지어·미확인 숫자·문장 수 모두 차단 확인`);
