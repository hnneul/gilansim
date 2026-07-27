// 주행부담점수 엔진 — PLAN.md §5
// 결정론적: 같은 입력이면 언제나 같은 출력. AI는 이 결과를 문장으로 옮길 뿐 재계산하지 않는다.

export type DriverProfile = {
  experienceYears: number;
  drivingFrequency: "low" | "medium" | "high";
  jejuExperience: boolean;
  vehicleSize: "compact" | "sedan" | "suv";
  timeOfDay: "day" | "night";
};

export type RiskType =
  | "accidentZone"
  | "sharpCurve"
  | "narrowRoad"
  | "steepSlope"
  | "complexJunction"
  | "highSpeed";

export type RiskFactor = {
  type: RiskType;
  label: string;
  location: string;
  coord: [number, number];
  value: string;
  source: string; // ★ 필수 — 출처 없으면 데이터에 못 들어감
};

export type ScoreResult = {
  recommendedRoute: "fast" | "safe" | "single";
  fastScore: number;
  safeScore: number;
  reasons: string[];
  // PLAN.md §4 그대로. factor는 RiskFactor.label이며,
  // 근거 카드는 이 이름으로 Route.risks를 되짚어 위치·수치·출처를 가져온다.
  breakdown: { route: "fast" | "safe"; factor: string; base: number; weighted: number }[];
};

export const BASE_SCORE: Record<RiskType, number> = {
  accidentZone: 15,
  sharpCurve: 12,
  narrowRoad: 10,
  steepSlope: 8,
  complexJunction: 6,
  highSpeed: 5,
};

export const COMFORT_THRESHOLD = 50;

/** 고속주행은 초보에게만 부담이다 — 경력이 쌓이면 요인 자체가 사라진다 */
function applies(type: RiskType, p: DriverProfile): boolean {
  return type !== "highSpeed" || p.experienceYears <= 1;
}

/** 프로필 가중치(곱). SUV는 좁은 교행로에만 걸린다 — 차가 크다고 급커브가 더 위험하진 않다. */
function weight(type: RiskType, p: DriverProfile): number {
  let w = 1;
  if (p.experienceYears <= 1) w *= 1.3;
  if (p.drivingFrequency === "low") w *= 1.3;
  if (!p.jejuExperience) w *= 1.2;
  if (p.timeOfDay === "night") w *= 1.15;
  if (type === "narrowRoad" && p.vehicleSize === "suv") w *= 1.4;
  return w;
}

/** 근거 카드 머리말용 — 지금 켜져 있는 가중치 조건 목록 */
export function activeWeights(p: DriverProfile): string[] {
  const out: string[] = [];
  if (p.experienceYears <= 1) out.push("운전경력 1년 이하 ×1.3");
  if (p.drivingFrequency === "low") out.push("최근 운전빈도 낮음 ×1.3");
  if (!p.jejuExperience) out.push("제주 운전경험 없음 ×1.2");
  if (p.timeOfDay === "night") out.push("야간 주행 ×1.15");
  if (p.vehicleSize === "suv") out.push("SUV ×1.4 (좁은 교행로에만)");
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 근거 카드가 "기본 15 × 2.03" 곱셈식을 복원할 때 쓴다 */
export const multiplierOf = (base: number, weighted: number) =>
  Math.round((weighted / base) * 100) / 100;

function scoreRoute(risks: RiskFactor[], p: DriverProfile) {
  const rows = risks
    .filter((r) => applies(r.type, p))
    .map((r) => {
      const base = BASE_SCORE[r.type];
      return { factor: r.label, base, weighted: round1(base * weight(r.type, p)) };
    });
  // 합계는 반올림된 값들의 합 — 근거 카드의 숫자가 총점과 어긋나지 않게
  return { total: round1(rows.reduce((s, r) => s + r.weighted, 0)), rows };
}

type RouteInput = { risks: RiskFactor[]; durationMin: number | null };

export function scoreRoutes(
  profile: DriverProfile,
  fastRoute: RouteInput,
  safeRoute: RouteInput,
): ScoreResult {
  const fast = scoreRoute(fastRoute.risks, profile);
  const safe = scoreRoute(safeRoute.risks, profile);

  // 최단거리 경로가 시간까지 이득인가.
  // 제주공항→서귀포시청 실측에서는 5.16도로가 오히려 6~10분 느려 항상 false다.
  const fastIsQuicker =
    fastRoute.durationMin != null &&
    safeRoute.durationMin != null &&
    fastRoute.durationMin < safeRoute.durationMin;

  // PLAN.md §5 추천 규칙.
  // 시간 이득이 없으면 부담이 큰 경로를 추천할 근거 자체가 없다 —
  // 임계값 분기는 "시간을 얻는 대신 부담을 감수한다"는 교환을 전제로 하기 때문이다.
  const recommendedRoute = !fastIsQuicker
    ? "safe"
    : fast.total <= COMFORT_THRESHOLD
      ? "fast"
      : safe.total < fast.total * 0.7
        ? "safe"
        : "single";

  const top = [...fast.rows].sort((a, b) => b.weighted - a.weighted).slice(0, 2);
  const gap =
    fastRoute.durationMin != null && safeRoute.durationMin != null
      ? fastRoute.durationMin - safeRoute.durationMin
      : null;

  const lead = !fastIsQuicker
    ? gap != null
      ? `최단거리 경로가 ${gap}분 더 걸림 — 시간 이득이 없음 (부담점수 ${fast.total})`
      : `최단거리 경로에 시간 이득이 없음 (부담점수 ${fast.total})`
    : recommendedRoute === "fast"
      ? `빠른 경로 부담점수 ${fast.total} — 편안 임계값 ${COMFORT_THRESHOLD} 이하`
      : recommendedRoute === "safe"
        ? `빠른 경로 부담점수 ${fast.total} — 임계값 ${COMFORT_THRESHOLD} 초과`
        : `두 경로의 부담 차이가 작음 (${fast.total} / ${safe.total})`;

  const reasons = [lead, ...top.map((r) => `${r.factor} ${r.weighted}점`)];

  return {
    recommendedRoute,
    fastScore: fast.total,
    safeScore: safe.total,
    reasons,
    breakdown: [
      ...fast.rows.map((r) => ({ route: "fast" as const, ...r })),
      ...safe.rows.map((r) => ({ route: "safe" as const, ...r })),
    ],
  };
}
