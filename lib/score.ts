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

const round1 = (n: number) => Math.round(n * 10) / 10;

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

export function scoreRoutes(
  profile: DriverProfile,
  fastRisks: RiskFactor[],
  safeRisks: RiskFactor[],
): ScoreResult {
  const fast = scoreRoute(fastRisks, profile);
  const safe = scoreRoute(safeRisks, profile);

  // PLAN.md §5 추천 규칙 — 단순 "점수 낮은 쪽"으로 짜면 저부담 경로가 항상 이겨 추천이 안 뒤집힌다
  const recommendedRoute =
    fast.total <= COMFORT_THRESHOLD
      ? "fast"
      : safe.total < fast.total * 0.7
        ? "safe"
        : "single";

  const top = [...fast.rows].sort((a, b) => b.weighted - a.weighted).slice(0, 2);
  const reasons = [
    recommendedRoute === "fast"
      ? `빠른 경로 부담점수 ${fast.total} — 편안 임계값 ${COMFORT_THRESHOLD} 이하`
      : recommendedRoute === "safe"
        ? `빠른 경로 부담점수 ${fast.total} — 임계값 ${COMFORT_THRESHOLD} 초과`
        : `두 경로의 부담 차이가 작음 (${fast.total} / ${safe.total})`,
    ...top.map((r) => `${r.factor} ${r.weighted}점`),
  ];

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
