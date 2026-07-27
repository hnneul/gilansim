// 출발 전 브리핑 — PLAN.md §3 ④
//
// 폴백 경로다. AI 없이 계산 결과만으로 문장을 조립하므로 인터넷이 끊겨도 동작한다.
// AI 연동 시에는 이 함수가 실패·지연 시의 대체 경로가 된다.

import { COMFORT_THRESHOLD, activeWeights, type DriverProfile, type RiskType, type ScoreResult } from "./score.ts";

// 요인 종류별 대응 행동.
// 이 문장들은 출처가 필요 없다 — 위험요인의 존재를 주장하는 게 아니라
// 그 종류에 대한 일반 안전운전 수칙이기 때문이다. (§5 원칙)
const ACTION: Record<RiskType, string> = {
  accidentZone: "사고가 잦은 곳이니 앞차와의 거리를 평소보다 넉넉히 두세요.",
  sharpCurve: "커브에 들어가기 전에 미리 속도를 줄이고, 커브 안에서는 브레이크를 밟지 않는 것이 안전합니다.",
  narrowRoad: "맞은편 차가 오면 넓은 곳에서 미리 기다렸다가 교행하세요.",
  steepSlope: "긴 내리막에서는 엔진브레이크를 함께 쓰고 풋브레이크만으로 버티지 마세요.",
  complexJunction: "교차로에 들어가기 전에 갈 방향의 차로를 미리 잡아두면 급한 차선 변경을 피할 수 있습니다.",
  highSpeed: "주변 차가 빨라도 무리해서 속도를 맞출 필요는 없습니다. 1차로보다 2차로가 편합니다.",
};

/** 위치가 비어 있으면 요인 이름만 쓴다 */
const spot = (r: ScoreResult["breakdown"][number]) => {
  const loc = r.risk.location.trim();
  return loc && loc !== "-" ? `${loc}의 ${r.risk.label}` : r.risk.label;
};

/** 2~3문장. risk.value는 쓰지 않는다 — 아직 "미확보"라 문장에 넣으면 거짓이 된다. */
export function briefing(
  profile: DriverProfile,
  result: ScoreResult,
  names: { fast: string; safe: string },
): string[] {
  const { recommendedRoute: pick, fastScore, safeScore } = result;
  const target = pick === "safe" ? "safe" : "fast"; // 실제로 달릴 경로를 브리핑한다

  const lead =
    pick === "safe"
      ? `${names.safe}를 추천합니다. ${names.fast}는 부담점수 ${fastScore}점으로 편안 임계값 ${COMFORT_THRESHOLD}점을 넘었습니다.`
      : pick === "fast"
        ? `${names.fast}를 추천합니다. 부담점수 ${fastScore}점으로 편안 임계값 ${COMFORT_THRESHOLD}점 이하입니다.`
        : `두 경로의 부담 차이가 크지 않습니다(${fastScore}점 / ${safeScore}점). 익숙한 경로를 이용하세요.`;

  const top = result.breakdown
    .filter((r) => r.route === target)
    .sort((a, b) => b.weighted - a.weighted)
    .slice(0, 2);

  const watch = top.length
    ? `${names[target]}에서 부담이 가장 큰 곳은 ${top.map(spot).join(", ")}입니다. ` +
      [...new Set(top.map((r) => ACTION[r.risk.type]))].join(" ")
    : `${names[target]}에는 확인된 위험요인이 없습니다.`;

  const conditions = activeWeights(profile).map((s) => s.replace(/\s*×.*$/, ""));
  const why = conditions.length
    ? `${conditions.join(" · ")} 조건이 반영된 결과입니다.`
    : `추가 가중치 없이 기본 점수 그대로 계산된 결과입니다.`;

  return [lead, watch, why];
}
