// 출발 전 브리핑 — PLAN.md §3 ④
//
// 폴백 경로다. AI 없이 계산 결과만으로 문장을 조립하므로 인터넷이 끊겨도 동작한다.
// AI 연동 시에는 이 함수가 실패·지연 시의 대체 경로가 된다.

import {
  COMFORT_THRESHOLD,
  activeWeights,
  type DriverProfile,
  type RiskFactor,
  type RiskType,
  type ScoreResult,
} from "./score.ts";

// 요인 종류별 대응 행동.
// 이 문장들은 출처가 필요 없다 — 위험요인의 존재를 주장하는 게 아니라
// 그 종류에 대한 일반 안전운전 수칙이기 때문이다. (§5 원칙)
//
// lib/ai.ts 가 프롬프트에 그대로 실어 보낸다. AI에게 안전 조언을 창작하게 하지 않고
// 사람이 검토한 문구를 주는 쪽이 안전하다 — 틀린 운전 조언은 틀린 숫자보다 위험하다.
export const ACTION: Record<RiskType, string> = {
  accidentZone: "사고가 잦은 곳이니 앞차와의 거리를 평소보다 넉넉히 두세요.",
  sharpCurve: "커브에 들어가기 전에 미리 속도를 줄이고, 커브 안에서는 브레이크를 밟지 않는 것이 안전합니다.",
  narrowRoad: "맞은편 차가 오면 넓은 곳에서 미리 기다렸다가 교행하세요.",
  steepSlope: "긴 내리막에서는 엔진브레이크를 함께 쓰고 풋브레이크만으로 버티지 마세요.",
  complexJunction: "교차로에 들어가기 전에 갈 방향의 차로를 미리 잡아두면 급한 차선 변경을 피할 수 있습니다.",
  highSpeed: "주변 차가 빨라도 무리해서 속도를 맞출 필요는 없습니다. 1차로보다 2차로가 편합니다.",
};

/**
 * 요인 종류별 — 이 길에서 실제로 무슨 일이 생기는가.
 *
 * ACTION 이 "어떻게 하라"면 이건 "왜 힘든가"다. 근거 카드가 원래 곱셈식(기본 × 노출 × 조건)을
 * 먼저 보여줬는데, 이 앱을 쓰는 이유는 점수 검산이 아니라 길을 모르기 때문이다 —
 * 필요한 건 "28.2점이 어떻게 나왔나"가 아니라 "저기 들어가면 뭐가 기다리나"다.
 *
 * ACTION 과 같은 이유로 출처가 필요 없다: 위험요인의 존재를 주장하는 게 아니라
 * 그 종류의 성격을 말하는 것이다. 요인이 거기 있다는 근거는 risk.source 가 댄다.
 */
export const WHY: Record<RiskType, string> = {
  accidentZone: "사고가 반복되는 지점이라 앞차가 갑자기 서는 일이 잦습니다.",
  sharpCurve:
    "커브마다 속도를 줄였다 올리기를 반복하게 됩니다. 커브 안에서는 앞이 보이지 않아 마주 오는 차나 서 있는 차를 미리 볼 수 없습니다.",
  narrowRoad:
    "차로가 하나뿐이라 마주 오는 차가 있으면 한쪽이 비켜서야 합니다. 관광버스나 트럭을 만나면 후진해서 넓은 곳까지 물러나야 할 수도 있습니다.",
  steepSlope: "내리막이 길어 브레이크만 밟고 내려가면 제동이 점점 밀립니다.",
  complexJunction: "차로가 갈라지는 곳이 많아 안내를 한 번 놓치면 급하게 차선을 바꾸게 됩니다.",
  highSpeed: "주변 차가 80km/h로 달려서, 속도를 맞춰야 할 것 같은 압박을 받기 쉽습니다.",
};

/**
 * 받침 유무로 조사를 고른다 — "좁은 교행 구간이"는 맞고 "연속 급커브이"는 틀리다.
 * 요인 이름이 데이터에서 오니 문장을 조립할 때 골라야 한다 (한글 음절은 0xAC00 부터
 * 28개씩 종성이 돌고, 나머지가 0이면 받침이 없다). 한글이 아니면 "가"로 둔다.
 */
function 이가(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 !== 0 ? "이" : "가";
}

/**
 * 경로 한 개에 대한 판정 한 줄 — AI 문장(lib/ai.ts 의 verdicts)을 못 받았을 때 쓴다.
 *
 * 점수를 읊지 않는다. 이 문장이 앉는 자리는 부담점수를 이미 큰 글씨로 보여준 카드를
 * 눌러서 들어온 팝업의 머리말이고, 초보가 알고 싶은 건 "그래서 어떤 길이냐"다.
 *
 * WHY 문장을 그대로 쓰지도 않는다 — 바로 아래 요인 목록이 같은 문장을 이미 보여준다.
 * 여기서는 어느 요인이 제일 큰지만 가리키고 비켜준다.
 *
 * 추천 경로가 항상 점수까지 낮은 건 아니다(시간 이득을 함께 보므로) — 그래서 "더 낮다"고
 * 단정하지 않는다. lib/score.ts 의 추천 규칙을 그대로 옮기지 않으려는 것이다.
 */
export function verdict(
  result: ScoreResult,
  route: { id: "fast" | "safe"; risks: RiskFactor[]; durationMin: number | null },
  /** 상대 경로. 추천 이유는 결국 비교라서 한쪽만 보고는 쓸 수 없다 (소요시간만 쓴다). */
  other: { durationMin: number | null },
): string {
  if (result.recommendedRoute === "single")
    return "두 경로의 부담이 비슷합니다. 어느 쪽으로 가도 크게 다르지 않으니 익숙한 길로 가세요.";

  // 부담이 가장 큰 요인. breakdown 을 route 로 먼저 좁힌다 — 요인 이름이 양쪽에 같으면
  // factor 만으로 찾다가 다른 경로 행이 잡힌다 (lib/ai.ts factsOf 와 같은 함정이다).
  const 최대 = result.breakdown
    .filter((b) => b.route === route.id)
    .sort((a, b) => b.weighted - a.weighted)
    .map((b) => route.risks.find((r) => r.label === b.factor))
    .find((r): r is RiskFactor => !!r);

  const 몫 = 최대 && `경로의 ${Math.round(최대.exposure * 100)}%`;
  const 분 =
    route.durationMin != null && other.durationMin != null ? other.durationMin - route.durationMin : null;

  // "초보에게는"을 붙이지 않는다 — 이 함수는 프로필을 받지 않고, 부담점수가 이미
  // 프로필을 반영한 값이다. 경력 3년 화면에서 "초보에게는"이 뜨는 걸 봤다.
  if (result.recommendedRoute === route.id) {
    const 앞 = 분 != null && 분 > 0 ? `다른 길보다 ${분}분 빠르고 부담도 적어 이 길을 추천합니다.` : "두 경로 중 부담이 적어 이 길을 추천합니다.";
    return 최대 ? `${앞} 그래도 ${최대.label}${이가(최대.label)} ${몫}를 차지하니 그 구간만 신경 쓰세요.` : 앞;
  }
  const 뒤 = 분 != null && 분 < 0 ? ` 게다가 다른 길보다 ${-분}분 더 걸립니다.` : "";
  return 최대
    ? `${최대.label}${이가(최대.label)} ${몫}를 차지해 부담이 큰 길입니다.${뒤}`
    : `이 길은 추천하지 않습니다.${뒤}`;
}

type RouteLike = { name: string; risks: RiskFactor[]; durationMin: number | null };

/** 2~3문장. risk.value는 쓰지 않는다 — 아직 "미확보"라 문장에 넣으면 거짓이 된다. */
export function briefing(
  profile: DriverProfile,
  result: ScoreResult,
  routes: { fast: RouteLike; safe: RouteLike },
): string[] {
  const { recommendedRoute: pick, fastScore, safeScore } = result;
  const target = pick === "safe" ? "safe" : "fast"; // 실제로 달릴 경로를 브리핑한다
  const name = { fast: routes.fast.name, safe: routes.safe.name };

  // 최단거리 경로가 시간까지 손해인 경우 — 그 사실을 먼저 말한다
  const gap =
    routes.fast.durationMin != null && routes.safe.durationMin != null
      ? routes.fast.durationMin - routes.safe.durationMin
      : null;
  const 시간손해 = gap != null && gap > 0;

  // 부담이 임계값을 넘으면 강한 권고, 넘지 않으면 "굳이 선택할 이유가 없다"는 약한 권고
  const 강함 = fastScore > COMFORT_THRESHOLD;

  // pick 을 먼저 본다. 전에는 시간손해로 문장을 갈랐는데, 그건 추천을 두 번 계산하는 것이고
  // 실제로 어긋났다 — 부담 차이가 없어 추천을 접은 구간(pick "single")에서도 시간손해만 보고
  // "평화로를 추천합니다"를 썼다. 추천은 lib/score.ts 한 곳에서만 정한다.
  const lead =
    pick === "single"
      ? `두 경로의 부담 차이가 크지 않습니다(${fastScore}점 / ${safeScore}점). 익숙한 경로를 이용하세요.`
      : pick === "safe"
        ? 시간손해
          ? 강함
            ? `${name.safe}를 추천합니다. ${name.fast}는 거리가 짧지만 ${gap}분 더 걸리고, 부담점수도 ${fastScore}점으로 편안 임계값 ${COMFORT_THRESHOLD}점을 넘습니다.`
            : `${name.safe}를 추천합니다. ${name.fast}의 부담점수 ${fastScore}점은 감당할 수 있는 수준이지만, ${gap}분 더 걸려 굳이 선택할 이유가 없습니다.`
          : `${name.safe}를 추천합니다. ${name.fast}는 부담점수 ${fastScore}점으로 편안 임계값 ${COMFORT_THRESHOLD}점을 넘었습니다.`
        : 시간손해
          ? `${name.fast}를 추천합니다. ${gap}분 더 걸리지만 부담점수가 ${fastScore}점으로 ${name.safe}(${safeScore}점)보다 낮습니다.`
          : `${name.fast}를 추천합니다. 부담점수 ${fastScore}점으로 편안 임계값 ${COMFORT_THRESHOLD}점 이하입니다.`;

  // §4 breakdown은 factor(이름)만 담으므로 Route.risks에서 원본을 되짚는다
  const top = result.breakdown
    .filter((r) => r.route === target)
    .sort((a, b) => b.weighted - a.weighted)
    .slice(0, 2)
    .map((r) => routes[target].risks.find((x) => x.label === r.factor))
    .filter((r): r is RiskFactor => !!r);

  const spot = (r: RiskFactor) => {
    const loc = r.location.trim();
    return loc && loc !== "-" ? `${loc}의 ${r.label}` : r.label;
  };

  const watch = top.length
    ? `${name[target]}에서 부담이 가장 큰 곳은 ${top.map(spot).join(", ")}입니다. ` +
      [...new Set(top.map((r) => ACTION[r.type]))].join(" ")
    : `${name[target]}에는 확인된 위험요인이 없습니다.`;

  const conditions = activeWeights(profile).map((s) => s.replace(/\s*×.*$/, ""));
  const why = conditions.length
    ? `${conditions.join(" · ")} 조건이 반영된 결과입니다.`
    : `추가 가중치 없이 기본 점수 그대로 계산된 결과입니다.`;

  return [lead, watch, why];
}
