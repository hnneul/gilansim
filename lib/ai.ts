// 생성형 AI 문장 — 계획서 Core·Supporting 1·2 의 "생성형 AI가 작성한다"
//
// AI가 만드는 것은 문장뿐이다. 숫자·위험요인·추천 결과는 전부 계산이 정하고(lib/score.ts),
// AI는 그 결과를 읽어 한국어로 옮긴다. 그래서 부담점수도 근거 카드의 수치도 AI 때문에
// 흔들리지 않는다 — 근거 카드의 완료 기준이 "동일 입력에서 같은 근거"이기 때문이다.
//
// "확인되지 않은 위험요인은 생성하지 않는다"는 프롬프트로 부탁할 일이 아니라 코드로 막을
// 일이다. 그래서 응답을 verify() 로 거른다: 우리가 데이터를 확보하지 못한 요인을 언급하거나
// 주지 않은 숫자를 쓰면 응답을 버리고 규칙 기반 문장(lib/briefing.ts)으로 떨어진다.
//
// 호출 1회로 두 개를 받는다 — 같은 사실을 두 번 보낼 이유가 없다:
//   summary  근거 카드용 두 경로 차이 1~2문장 (Supporting 1)
//   briefing 출발 전 브리핑 2~3문장 (Supporting 2 + Core 추천 이유)

import { ACTION } from "./briefing.ts";
import type { RiskFactor, ScoreResult, DriverProfile } from "./score.ts";
import { COMFORT_THRESHOLD, activeWeights } from "./score.ts";

/**
 * Groq. 모델을 버전까지 고정한다 — 별칭을 쓰면 모델이 조용히 올라가 같은 입력에
 * 다른 문장이 나오고, 근거를 재현할 수 없게 된다.
 *
 * 왜 Gemini 가 아닌가: 무료 한도가 모델당 **하루 20회 / 분당 5회**였다
 * (429 응답의 QuotaFailure 로 확인. 2.5-flash·3.6-flash 둘 다 같아서 모델을 바꿔
 * 피할 수 있는 한도가 아니었다). 시연 리허설 몇 번에 다 태우고 폴백이 떴다.
 *
 * Groq 무료 한도 (x-ratelimit-* 응답 헤더로 실측, 2026-07-28):
 *   하루 1,000회 · 분당 8,000토큰. 호출당 약 1,185토큰이라 분당 6~7회가 실질 상한이고,
 *   하루 1,000회는 Gemini 무료의 50배다.
 *
 * 왜 이 모델인가: Groq 에서 llama-3.3-70b·llama-3.1-8b 는 `json_schema` 응답 형식을
 * 지원하지 않는다(400). 스키마로 모양을 보장받는 편이 문장을 파싱해 건지는 것보다 안전하다.
 */
const MODEL = "openai/gpt-oss-120b";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

/** 넘기면 규칙 기반 문장으로 간다. 브리핑이 늦게 뜨는 것보다 안 뜨는 게 낫진 않다. */
const TIMEOUT_MS = 6000;

/**
 * 언급하면 응답을 버리는 말들. 전부 우리가 데이터를 확보하지 못한 요인이다
 * (사고다발·급경사는 요인에서 제외했고, 기상은 Stretch로 미구현).
 * 두 글자 이상만 넣는다 — "비" 처럼 한 글자를 막으면 "비교"·"부담" 같은 정상 문장이 걸린다.
 */
const 금지어 = [
  "사고다발", "사고 다발", "사고이력", "사고 이력", "급경사", "빙판", "결빙",
  "안개", "강풍", "폭우", "적설", "날씨", "기상", "스쿨존", "어린이보호구역",
  "과속단속", "무인단속", "통행료",
];

export type AiSentences = { summary: string; briefing: string[] };

type RouteFacts = {
  이름: string;
  성격: string;
  소요시간분: number | null;
  거리km: number | null;
  부담점수: number;
  /**
   * 부담이 큰 순서. 요인별 점수는 일부러 넣지 않는다 — 모델이 한쪽 경로의 요인 점수를
   * 다른 경로 요인에 붙이는 걸 봤다("부담점수 28.2점인 좁은 교행 구간(평화로 1.1km)",
   * 28.2는 5.16도로 값이다). 요인 이름이 양쪽에 같으면 어느 가드에도 걸리지 않는다.
   * 요인별 점수는 근거 카드가 계산 결과로 직접 보여주므로 AI가 알 필요도 없다.
   */
  요인: { 이름: string; 위치: string; 수치: string; 행동수칙: string }[];
};

export type Facts = {
  구간: string;
  운전자조건: string[];
  추천경로: string;
  편안임계값: number;
  경로: RouteFacts[];
};

/**
 * 계산 결과 → AI에게 줄 사실 묶음. 여기 없는 건 AI도 모른다.
 * 프롬프트 조립을 순수 함수로 떼어놔서 ai.check.ts 가 네트워크 없이 검증한다.
 *
 * 실시간 혼잡 문구는 일부러 넣지 않는다. 무료 한도가 하루 20회뿐인데(아래 MODEL 주석),
 * 캐시 키가 프롬프트다. 혼잡 문구는 "중앙로 3.6km 서행" → "중앙로 4km 서행" 처럼
 * 로드마다 바뀌어서 넣으면 캐시가 거의 안 맞고 새로고침 몇 번에 한도를 태운다.
 * 소요시간은 추천 이유의 핵심이라 남긴다 — 몇 분 동안은 같은 값이라 캐시가 맞는다.
 * 혼잡은 경로 카드 배지가 이미 보여주므로 문장에서 잃는 게 없다.
 */
export function factsOf(
  label: string,
  profile: DriverProfile,
  result: ScoreResult,
  routes: { name: string; badge: string; durationMin: number | null; distanceKm: number | null; risks: RiskFactor[] }[],
): Facts {
  const 점수 = [result.fastScore, result.safeScore];
  const ROUTE_ID = ["fast", "safe"] as const; // routes 배열 순서 = breakdown 의 route 값
  return {
    구간: label,
    운전자조건: activeWeights(profile).map((s) => s.replace(/\s*×.*$/, "")),
    추천경로:
      result.recommendedRoute === "single"
        ? "없음 (두 경로의 부담 차이가 작음)"
        : routes[result.recommendedRoute === "fast" ? 0 : 1].name,
    편안임계값: COMFORT_THRESHOLD,
    경로: routes.map((r, i) => ({
      이름: r.name,
      성격: r.badge,
      소요시간분: r.durationMin,
      거리km: r.distanceKm,
      부담점수: 점수[i],
      요인: r.risks
        .map((k) => ({
          이름: k.label,
          위치: k.location,
          수치: k.value,
          행동수칙: ACTION[k.type],
          // route 로 먼저 좁힌다. "좁은 교행 구간"처럼 두 경로에 같은 이름이 있으면
          // factor 만으로 찾으면 항상 fast 행이 잡혀 정렬이 뒤집힌다 (실제로 그랬다).
          부담: result.breakdown.find((b) => b.route === ROUTE_ID[i] && b.factor === k.label)?.weighted ?? 0,
        }))
        // 부담이 큰 것부터. 점수는 정렬에만 쓰고 프롬프트에서는 뺀다 (RouteFacts 주석 참고)
        .sort((a, b) => b.부담 - a.부담)
        .map(({ 부담: _, ...쓸것 }) => 쓸것),
    })),
  };
}

const RULES = `너는 제주 렌터카 초보 운전자에게 경로를 안내하는 도우미다.
아래 사실만 사용해 한국어 문장을 쓴다.

지켜야 할 것:
- 사실에 있는 수치만 쓴다. 새 숫자를 만들거나 반올림하지 않는다.
- 각 경로의 "요인"은 부담이 큰 순서로 나열돼 있다. 요인별 점수는 주지 않았으니 말하지 않는다.
  부담점수는 경로 단위 값(부담점수 필드)만 쓴다.
- 사실에 없는 위험요인(사고 이력, 경사, 날씨, 단속 등)은 언급하지 않는다.
- 운전 조언은 각 요인의 "행동수칙" 문장을 근거로만 말한다. 직접 만들지 않는다.
- 추천경로가 왜 추천인지 부담점수와 소요시간으로 설명한다.
- briefing 의 위험요인과 행동수칙은 **추천경로의 것만** 쓴다. 추천하지 않는 경로의 요인은
  briefing 에 넣지 않는다 (summary 에서 두 경로를 비교하는 것은 괜찮다).
- 운전자조건이 있으면 그것이 반영된 결과임을 밝힌다.
- 존댓말, 담백하게. 감탄사·과장·이모지 금지.

출력:
- summary: 두 경로의 차이를 1~2문장으로. 근거 카드 머리말에 들어간다.
- briefing: 출발 전 브리핑 2~3문장. 첫 문장은 추천과 그 이유, 다음은 부담이 큰 지점과 대응 행동.`;

/** strict 모드는 additionalProperties: false 를 요구한다 */
const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    briefing: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3 },
  },
  required: ["summary", "briefing"],
  additionalProperties: false,
} as const;

/** 문장에 쓰인 숫자가 전부 프롬프트 안에 있던 것인가 */
function 숫자가사실에있나(text: string, prompt: string): boolean {
  return (text.match(/\d+(\.\d+)?/g) ?? []).every((n) => prompt.includes(n));
}

/**
 * 추천하지 않는 경로에만 있는 요인의 이름·수치.
 *
 * 브리핑은 "선택 경로에서 실제로 확인된 위험요인만" 써야 한다(Supporting 2 완료 기준).
 * 프롬프트로도 지시하지만 실제로 어기는 걸 봤다 — 평화로를 추천하면서 5.16도로의
 * 급커브를 브리핑에 넣었다. 그래서 코드로 막는다.
 *
 * 두 경로에 같이 있는 요인(좁은 교행 구간 등)은 빼야 한다 — 추천 경로에도 있는 요인이니
 * 언급해도 위반이 아니다.
 */
function 다른경로만의요인(facts: Facts): string[] {
  const 추천 = facts.경로.find((r) => r.이름 === facts.추천경로);
  if (!추천) return []; // 추천이 "없음"(부담 차이 작음)이면 두 경로를 다 말해도 된다
  const 추천것 = new Set(추천.요인.flatMap((f) => [f.이름, f.수치]));
  return facts.경로
    .filter((r) => r.이름 !== facts.추천경로)
    .flatMap((r) => r.요인)
    .flatMap((f) => [f.이름, f.수치])
    .filter((s) => !추천것.has(s));
}

/**
 * 응답 검증. 통과하지 못하면 null 을 주고 호출한 쪽이 규칙 기반 문장으로 떨어진다.
 * 여기가 계획서의 "확인되지 않은 위험요인은 생성하지 않는다"를 실제로 지키는 자리다.
 */
export function verify(v: unknown, facts: Facts): AiSentences | null {
  if (typeof v !== "object" || v === null) return null;
  const { summary, briefing } = v as Record<string, unknown>;
  if (typeof summary !== "string" || !Array.isArray(briefing)) return null;

  const lines = briefing.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  // 완료 기준이 "2~3개의 짧은 문장"이다. 스키마로도 걸었지만 여기서 한 번 더 본다.
  if (lines.length < 2 || lines.length > 3 || !summary.trim()) return null;

  const 전체 = [summary, ...lines].join(" ");
  if (금지어.some((w) => 전체.includes(w))) return null;
  if (!숫자가사실에있나(전체, promptOf(facts))) return null;

  // 브리핑에만 적용한다 — summary 는 두 경로를 비교하는 자리다 (Supporting 1)
  const 브리핑 = lines.join(" ");
  if (다른경로만의요인(facts).some((w) => 브리핑.includes(w))) return null;

  return { summary: summary.trim(), briefing: lines.map((s) => s.trim()) };
}

export function promptOf(facts: Facts): string {
  return `${RULES}\n\n[사실]\n${JSON.stringify(facts, null, 1)}`;
}

/**
 * 모델 호출만. 파싱된 원본을 그대로 준다 — verify() 와 떼어놨기 때문에
 * ai.smoke.ts 가 검증에 걸린 응답을 눈으로 볼 수 있다. 폴백만 조용히 뜨는 상태가
 * 가장 잡기 어려운 고장이다.
 */
export async function askModel(prompt: string): Promise<unknown | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: MODEL,
        // 같은 입력에 같은 문장이 나와야 한다 — 근거 카드의 재현성 조건이다
        temperature: 0,
        // 기본값이지만 명시한다 — 기본이 바뀌면 같은 입력에 다른 문장이 나온다.
        // low 로 낮추면 토큰이 1352까지 줄지만(medium 2035) 문장에서 숫자가 빠진다
        // ("부담점수 29.4" → "부담점수가 낮고"). 근거를 숫자로 말하는 게 이 화면의 요점이다.
        reasoning_effort: "medium",
        messages: [{ role: "user", content: prompt }],
        response_format: {
          type: "json_schema",
          json_schema: { name: "sentences", strict: true, schema: SCHEMA },
        },
      }),
    });
    if (!res.ok) return null;

    const text = (await res.json()).choices?.[0]?.message?.content;
    if (typeof text !== "string") return null;
    return JSON.parse(text);
  } catch {
    return null; // 네트워크·타임아웃·JSON 파싱 실패 모두 여기로 모인다
  }
}

/**
 * 프롬프트 → 결과 캐시. temperature 0 이라 같은 프롬프트에 같은 답이 나오므로
 * 캐싱이 최적화가 아니라 원래 동작이다. 무료 한도가 하루 단위로 걸려 있어서
 * 같은 화면을 두 번 그리는 데 두 번 부를 이유가 없다.
 *
 * 프롬프트에 실시간 소요시간·혼잡이 들어가므로 교통이 바뀌면 자연히 다시 부른다 —
 * 낡은 문장을 붙들고 있지 않는다. 서버 메모리라 재시작하면 비는데 그래도 맞다.
 */
const 캐시 = new Map<string, AiSentences>();
const CACHE_MAX = 200;

/**
 * 계획서 Core·Supporting 1·2 의 AI 문장. 실패·지연·검증 실패는 모두 null 이다 —
 * 호출한 쪽은 lib/briefing.ts 의 규칙 기반 문장을 그대로 쓰면 된다.
 */
export async function aiSentences(facts: Facts): Promise<AiSentences | null> {
  const prompt = promptOf(facts);
  const 있던것 = 캐시.get(prompt);
  if (있던것) return 있던것;

  const out = verify(await askModel(prompt), facts);
  if (out) {
    // 오래된 것만 골라 버릴 값어치가 없다 — 통째로 비우고 다시 채운다
    if (캐시.size >= CACHE_MAX) 캐시.clear();
    캐시.set(prompt, out);
  }
  return out;
}
