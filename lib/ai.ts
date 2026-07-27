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

import { ACTION, WHY } from "./briefing.ts";
import type { RiskFactor, ScoreResult, DriverProfile } from "./score.ts";
import { COMFORT_THRESHOLD, activeWeights } from "./score.ts";

/**
 * 후보는 **두 제공자**다 (askModel 이 순서대로 시도한다). 무료 한도는 제공자별로 따로 차므로
 * 한쪽이 마른 날에도 문장이 나온다 — 한 곳만 박아두면 남은 예산을 두고 규칙 문장만 나간다.
 * 대신 답한 쪽이 바뀌면 같은 입력에 문장이 달라진다. 문장을 아예 못 내보내는 것보다는 낫다.
 *
 * 별칭이 아니라 버전이 박힌 이름을 쓴다 — 별칭은 모델이 조용히 올라가 문장이 바뀐다.
 *
 * ① Groq / gpt-oss-120b — 예산이 가장 크다.
 *    분당 8,000토큰 · **모델당 하루 200,000토큰(TPD)**. 먼저 닿는 건 TPD 다
 *    (429 본문: "on tokens per day (TPD): Limit 200000, Used 198869"). 호출당 약 4,000토큰이라
 *    **하루 50번쯤**이고, 시연 리허설 스무 번이면 그날 예산의 절반이 사라진다.
 *    같은 키의 다른 Groq 모델은 후보가 못 된다: 구조화 출력을 지원하는 건 gpt-oss 계열뿐인데
 *    (llama-3.3-70b · llama-3.1-8b · qwen3.6-27b · compound-mini 는 400 "does not support
 *    response format json_schema"), 20b 는 briefing 을 배열이 아니라 문자열로 써서
 *    400 "expected array, but got string" 이 온다. 스키마를 못 지키는 모델은 넣을 수 없다.
 *
 * ② Gemini — 지갑이 다르다. 같은 프롬프트·같은 스키마로 2~3초에 답하고 verify() 를 그대로
 *    통과한다. 무료 쿼터가 Groq 보다 빡빡하고(모델당 20회) 모델별로 갈려서 후보를 둘 둔다
 *    (아래 GEMINI_MODELS 의 실측표).
 *
 * 두 후보가 다 실패하면 캐시(aiSentences)도 규칙 폴백(lib/briefing.ts)도 정상 동작 경로다 —
 * 장식이 아니라 이 앱이 인터넷·한도 없이도 말을 하게 하는 장치다.
 */
const GROQ_MODEL = "openai/gpt-oss-120b";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
/**
 * Gemini 후보. 쿼터가 **모델별**이라 여러 개를 둔다
 * (429 본문: "limit: 20, model: gemini-2.5-flash").
 *
 * 실측(2026-07-28, 같은 프롬프트·같은 스키마):
 *   2.5-flash        2.9초 · 검증 통과 · 무료 20회
 *   3.1-flash-lite   1.9초 · 검증 통과(수치를 한 번 지어내 걸린 적 있음)
 *   3.5-flash        39초 — 통과하지만 TIMEOUT_MS(6초)를 넘어 화면에서 못 쓴다
 *   2.0-flash        429 "limit: 0" — 무료 쿼터가 없다
 *   3.6-flash        400 "invalid argument" — 이 설정으로는 안 받는다
 */
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-3.1-flash-lite"];
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

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

/**
 * verdicts 는 경로 순서(fast, safe)와 같다 — 부르는 쪽이 자기 카드 것만 꺼내 쓴다.
 *
 * 모델에게는 순서로 받지 않고 {경로 이름, 판정} 쌍으로 받아 이름으로 맞춘다. 순서로 받으면
 * 뒤집혀도 스키마를 통과하고, 그러면 평화로 카드에 5.16도로 설명이 붙는다 — 검증으로
 * 잡을 수 없는 거짓말이다. 한때 A·B 기호를 키로 썼는데, 모델이 그 기호를 문장에도 썼다
 * ("B 경로는 부담점수가 29.4로…"). 화면에 나갈 이름을 그대로 키로 쓰면 그 문제가 없다.
 */
export type AiSentences = { summary: string; briefing: string[]; verdicts: string[] };

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
  요인: { 이름: string; 수치: string; 비중: string; 부담설명: string; 행동수칙: string }[];
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
          // 위치(도로명·km)는 주지 않는다 — 화면에서는 지도 마커가 그 일을 하고,
          // 프롬프트에서는 모델이 베껴 쓸 수치 문자열만 하나 더 늘린다.
          수치: k.value,
          // 판정에서 쓸 수 있는 유일한 숫자. 이게 없으면 모델이 비율을 말할 근거가 없어
          // "길게 이어집니다"처럼 뭉갠 말만 나온다 — 29%와 3%가 같은 말이 되는 셈이다.
          비중: `경로의 ${Math.round(k.exposure * 100)}%`,
          // 사람이 검토한 평문. 판정(verdicts)의 말투를 여기서 가져간다 —
          // 초보에게 할 말을 모델이 새로 발명하는 것보다, 검토된 문장을 고쳐 쓰는 쪽이 안전하다.
          부담설명: WHY[k.type],
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
- verdicts: 경로마다 한 줄, "경로"에는 그 경로의 이름을 그대로 적는다. 추천경로면 왜 이 길인지,
  아니면 왜 이 길이 아닌지. **그 경로의 요인만** 쓴다 (다른 경로의 요인을 붙이면 안 된다).
  운전을 처음 하는 사람에게 말하듯 **두 문장, 80자 안의 평문**. 한 문장으로 끝내지 않는다 —
  왜 그런 길인지까지 말해야 추천 이유가 된다.
  숫자를 쓸 거면 그 요인의 **"비중" 하나만** 쓴다("경로의 29%"). "수치"(급커브 42곳,
  최소 반경 7m 같은 것)는 바로 아래 요인 목록이 이미 보여주므로 옮기지 않는다.
  부담이 가장 큰 요인 하나를 골라 그 "부담설명"을 줄여 쓰고, 추천경로면 그래도 신경 쓸
  곳 하나를 덧붙인다. 조언이 아니라 이 길이 어떤 길인지를 말한다
  ("이렇게 하세요"는 briefing 이 한다).
  예(추천 아님): "굽은 길이 절반 가까이 이어집니다. 커브마다 속도를 줄였다 올리기를
  반복하게 되고, 마주 오는 차를 미리 보기 어렵습니다."
  예(추천): "큰길이라 차선만 지키면 됩니다. 다만 주변 차가 빠른 구간이 길어, 속도를
  맞추려 하지 않는 게 편합니다."
  나쁜 예: "고속주행 구간이 25.4km(제한속도 80km/h)이며 연속 급커브가 17곳으로 부담이 큽니다."
- briefing 의 위험요인과 행동수칙은 **추천경로의 것만** 쓴다. 추천하지 않는 경로의 요인은
  briefing 에 넣지 않는다 (summary 에서 두 경로를 비교하는 것은 괜찮다).
- 운전자조건이 있으면 그것이 반영된 결과임을 밝힌다.
- 존댓말, 담백하게. 감탄사·과장·이모지 금지.

출력:
- summary: 두 경로의 차이를 1~2문장으로. 근거 카드 머리말에 들어간다.
- briefing: 출발 전 브리핑 2~3문장. 첫 문장은 추천과 그 이유, 다음은 부담이 큰 지점과 대응 행동.
- verdicts: [{"경로": "경로 이름", "판정": "두 문장, 80자 안"}, …]. 경로마다 하나씩.`;

/** strict 모드는 additionalProperties: false 를 요구한다 */
const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    briefing: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3 },
    // 경로 이름을 함께 받아 이름으로 맞춘다 — 순서만 믿으면 뒤집혀도 통과한다 (AiSentences 주석).
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: { 경로: { type: "string" }, 판정: { type: "string" } },
        required: ["경로", "판정"],
        additionalProperties: false,
      },
      minItems: 2,
      maxItems: 2,
    },
  },
  required: ["summary", "briefing", "verdicts"],
  additionalProperties: false,
} as const;

/**
 * 판정 한 줄의 상한. 두 가지를 다르게 재는데, 실패 모드가 둘이기 때문이다.
 *
 * 처음엔 길이만 80자로 막았다. 그랬더니 모델이 25자짜리("연속 급커브가 많아 속도 조절이
 * 자주 필요합니다.")를 내놓고, 그건 추천 이유라고 부르기엔 너무 얇았다.
 *
 * 실제로 문제였던 건 길이가 아니라 수치 나열이었다: "고속주행 구간이 25.4km(제한속도
 * 80km/h)이며 연속 급커브가 17곳(최소 반경 17m)·굽은 구간 2.5km으로…" — 숫자 다섯 개가
 * 한 문장에 들어가면 바로 아래 요인 목록과 같은 말이 된다. 그래서 숫자 개수를 센다.
 * 길이는 두 문장이 들어갈 만큼 열어두고, 나열만 막는다.
 */
const 판정_최대글자 = 110;
const 판정_최대숫자 = 2;

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
function 다른경로만의요인(facts: Facts, 이름: string): string[] {
  const 이경로 = facts.경로.find((r) => r.이름 === 이름);
  if (!이경로) return []; // 추천이 "없음"(부담 차이 작음)이면 두 경로를 다 말해도 된다
  const 여기있는것 = new Set(이경로.요인.flatMap((f) => [f.이름, f.수치, f.비중]));
  return facts.경로
    .filter((r) => r.이름 !== 이름)
    .flatMap((r) => r.요인)
    .flatMap((f) => [f.이름, f.수치, f.비중])
    .filter((s) => !여기있는것.has(s));
}

/**
 * 응답 검증. 통과하지 못하면 null 을 주고 호출한 쪽이 규칙 기반 문장으로 떨어진다.
 * 여기가 계획서의 "확인되지 않은 위험요인은 생성하지 않는다"를 실제로 지키는 자리다.
 */
export function verify(v: unknown, facts: Facts): AiSentences | null {
  if (typeof v !== "object" || v === null) return null;
  const { summary, briefing, verdicts } = v as Record<string, unknown>;
  if (typeof summary !== "string" || !Array.isArray(briefing)) return null;

  const lines = briefing.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  // 완료 기준이 "2~3개의 짧은 문장"이다. 스키마로도 걸었지만 여기서 한 번 더 본다.
  if (lines.length < 2 || lines.length > 3 || !summary.trim()) return null;

  // 판정을 경로 이름으로 맞춰 경로 순서로 편다 — 순서만 믿으면 뒤집혀도 통과한다.
  // 하나라도 빠지거나 비면 통째로 버린다: 한쪽 카드만 설명이 없는 화면보다
  // 둘 다 규칙 문장으로 떨어지는 쪽이 앞뒤가 맞는다.
  if (!Array.isArray(verdicts)) return null;
  const 이름들 = facts.경로.map((r) => r.이름);
  // 두 경로 이름이 같으면 이름으로 맞출 수 없다 — 같은 문장이 두 카드에 붙는 것보다 폴백이 낫다
  if (new Set(이름들).size !== 이름들.length) return null;
  const 판정 = 이름들.map(
    (이름) =>
      (verdicts as { 경로?: unknown; 판정?: unknown }[]).find((v) => v.경로 === 이름)?.판정,
  );
  if (!판정.every((s): s is string => typeof s === "string" && s.trim().length > 0)) return null;
  if (판정.some((s) => s.trim().length > 판정_최대글자)) return null;
  if (판정.some((s) => (s.match(/\d+(\.\d+)?/g) ?? []).length > 판정_최대숫자)) return null;

  const 전체 = [summary, ...lines, ...판정].join(" ");
  if (금지어.some((w) => 전체.includes(w))) return null;
  if (!숫자가사실에있나(전체, promptOf(facts))) return null;

  // 브리핑에만 적용한다 — summary 는 두 경로를 비교하는 자리다 (Supporting 1)
  const 브리핑 = lines.join(" ");
  if (다른경로만의요인(facts, facts.추천경로).some((w) => 브리핑.includes(w))) return null;

  // 판정은 경로별이라 더 좁게 본다: 그 카드에 다른 길의 요인이 붙으면 안 된다.
  // 이름으로 맞춰 순서 뒤집힘은 막았지만, 모델이 내용을 바꿔 넣는 건 여기서만 걸린다.
  if (facts.경로.some((r, i) => 다른경로만의요인(facts, r.이름).some((w) => 판정[i].includes(w)))) return null;

  return {
    summary: summary.trim(),
    briefing: lines.map((s) => s.trim()),
    verdicts: 판정.map((s) => s.trim()),
  };
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
  // 앞에서부터 시도한다. 한도에 걸린 후보는 0.2초에 429 로 떨어지므로 줄줄이 세워도 싸다.
  for (const 부르기 of [() => groq(prompt), ...GEMINI_MODELS.map((m) => () => gemini(prompt, m))]) {
    const out = await 부르기();
    if (out !== null) return out;
  }
  return null;
}

/** Groq. 실패(한도·타임아웃·파싱)는 전부 null 이고, 부르는 쪽이 다음 후보로 넘어간다. */
async function groq(prompt: string): Promise<unknown | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: GROQ_MODEL,
        // 같은 입력에 같은 문장이 나와야 한다 — 근거 카드의 재현성 조건이다
        temperature: 0,
        // 기본값이지만 명시한다 — 기본이 바뀌면 같은 입력에 다른 문장이 나온다.
        // low 로 낮추면 토큰이 1352까지 줄지만(medium 2035) 문장에서 숫자가 빠진다
        // ("부담점수 29.4" → "부담점수가 낮고"). 근거를 숫자로 말하는 게 이 화면의 요점이다.
        reasoning_effort: "medium",
        // 함부로 올리면 안 된다: Groq 는 이 숫자를 **요청 크기에 합산해서** 분당 토큰 한도와
        // 견준다. 8192 로 뒀다가 413 "Request too large … TPM: Limit 8000, Requested 9708" 로
        // **매번** 튕겼다 — 프롬프트가 작아도 상관없이 항상 실패한다. 4096 이면 프롬프트
        // (약 1,500~1,800토큰)를 더해도 6,000 아래라 여유가 있고, 실측 완성 토큰이 1,700이라
        // 잘리지도 않는다 (상한이 모자라면 400 "Failed to validate JSON" 으로 온다).
        max_completion_tokens: 4096,
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
 * Gemini. Groq 이 죽거나 예산이 마른 날 같은 프롬프트로 같은 모양을 받아온다 —
 * 검증기(verify)는 어느 쪽이 답했는지 모른 채 똑같이 거른다.
 *
 * responseSchema 는 additionalProperties 를 받지 않아서 그 키만 빼고 같은 스키마를 쓴다
 * (스키마를 두 벌로 두면 한쪽만 고치는 사고가 난다).
 *
 * thinkingBudget 0: 생각을 끄면 응답이 2.9초·2,170토큰이다. 이 프롬프트는 사실을 문장으로
 * 옮기는 일이라 생각을 켤 이유가 없고, 무료 한도가 빡빡해서 토큰이 곧 남은 횟수다.
 */
async function gemini(prompt: string, model: string): Promise<unknown | null> {
  const key = process.env.AI_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: additionalProperties없이(SCHEMA),
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    if (!res.ok) return null;

    const text = (await res.json()).candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Gemini 용 스키마 변환. OpenAI 쪽이 요구하는 additionalProperties 를 Gemini 는 거부한다. */
function additionalProperties없이(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(additionalProperties없이);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => k !== "additionalProperties")
        .map(([k, x]) => [k, additionalProperties없이(x)]),
    );
  return v;
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
