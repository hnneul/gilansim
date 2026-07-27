// 목적지 주차장 — 초보 운전자가 가장 어려워하는 평행주차를 피할 수 있게 돕는다.
//
// 데이터에는 구획이 평행식인지 직각식인지 알려주는 컬럼이 없다. `주차장유형`을 프록시로 쓴다:
//   노상 = 도로 노면에 그린 구획  → 연석 옆 평행주차일 확률이 높다
//   노외 = 도로 밖 전용 부지·주차빌딩 → 직각(수직)주차일 확률이 높다
// 확정이 아니라 확률이다. 그래서 문구도 단정하지 않고, 출처에 프록시임을 명시한다.
// 생성 과정과 프록시 근거는 scripts/build-parking-data.mjs 주석에 있다.

// 데이터(data/parking-data.json) 자체는 lib/scenario.ts 가 물린다. 여기는 판정 로직만 둬서
// 번들러 없이도 검증이 돌아간다 — node --experimental-strip-types lib/parking.check.ts

export type ParkingSpot = {
  name: string;
  type: string; // "노상" | "노외"
  spaces: number | null;
  fee: string | null;
  walkM: number;
  at: [number, number]; // [위도, 경도] — 카드 안 미니 지도에 찍는다
};

export type Parking = {
  label: string;
  at: [number, number]; // 목적지 좌표 (미니 지도 중심)
  walkM: number;
  total: number;
  byType: Record<string, number>;
  spots: ParkingSpot[];
};

export type ParallelOdds = {
  level: "high" | "mixed" | "low";
  onStreet: number;
  offStreet: number;
  headline: string;
  detail: string;
};

/**
 * 목적지 주변 주차장 구성 → 평행주차를 만날 확률 판정.
 *
 * 판정 기준은 개수 비율이다. 도착해서 한 곳이 만차면 옆으로 옮기게 되므로,
 * "가장 가까운 한 곳"이 아니라 "주변에 뭐가 깔려 있나"가 실제로 겪는 확률에 가깝다.
 *
 * @param novice 초보 여부(score.ts의 isNovice). 숫자 판정은 같고 **문구만** 갈린다 —
 *        초보에게는 "노외로 가세요" 권유를, 그 외에는 사실만 준다.
 *        평행주차가 어려운 건 경력의 문제라 데이터가 아니라 말투로 갈라야 하고,
 *        경력자에게 하는 권유는 안 지킬 조언이라 경고의 신뢰도만 깎는다.
 *
 *        차폭은 여기 쓰지 않는다. 평행주차 난이도는 전폭보다 전장에 민감하고,
 *        데이터에 구획 크기가 없어 주차장별로 달라지지 않는다 (연결하려면 주차장법
 *        시행규칙 제3조 구획 규격을 먼저 확보해야 한다).
 */
export function parallelOdds(p: Parking, novice = true): ParallelOdds {
  const onStreet = p.byType["노상"] ?? 0;
  const offStreet = p.total - onStreet;
  const pct = Math.round((100 * onStreet) / p.total);
  const 규모 = `${p.label} 도보 ${p.walkM}m 안 주차장 ${p.total}곳`;

  if (onStreet === 0)
    return {
      level: "low",
      onStreet,
      offStreet,
      headline: novice ? "평행주차를 만날 일이 거의 없습니다" : "주변 주차장이 모두 노외주차장입니다",
      detail: `${규모}이 모두 노외주차장입니다. 노외는 도로 밖 전용 부지라 직각(수직)주차 구획일 확률이 높습니다.`,
    };

  if (pct >= 50)
    return {
      level: "high",
      onStreet,
      offStreet,
      headline: novice ? "평행주차를 만날 확률이 높습니다" : `노상주차장이 ${pct}%입니다`,
      detail:
        `${규모} 중 ${onStreet}곳(${pct}%)이 노상주차장입니다. 노상은 도로 노면에 그린 구획이라 연석 옆 평행주차일 확률이 높습니다.` +
        (novice && offStreet ? ` 평행주차가 부담되면 노외주차장 ${offStreet}곳을 먼저 보세요.` : ""),
    };

  return {
    level: "mixed",
    onStreet,
    offStreet,
    headline: novice ? "평행주차 구간이 일부 섞여 있습니다" : `노상 ${onStreet}곳 · 노외 ${offStreet}곳이 섞여 있습니다`,
    detail:
      `${규모} 중 ${onStreet}곳(${pct}%)이 노상주차장입니다.` +
      (novice ? " 아래 노외주차장으로 바로 가면 평행주차를 피할 수 있습니다." : ""),
  };
}

/** 초보에게 권할 주차장 — 노외(직각 확률) 중 가까운 순. 없으면 빈 배열. */
export function recommendedSpots(p: Parking, n = 3): ParkingSpot[] {
  return p.spots.filter((s) => s.type !== "노상").slice(0, n);
}
