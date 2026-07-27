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
 * **초보에게만 쓴다.** 평행주차가 어려운 건 경력의 문제라, 경력자에게는 노상이든 노외든
 * 차이가 없다. 같은 판정을 말투만 낮춰 되풀이하면 안 볼 경고를 하나 더 얹는 것이고,
 * 프록시(주차장유형)로 추정한 값을 굳이 한 번 더 단언하는 셈이다.
 * 경력자에게는 판정 없이 주차장 자체만 보여준다 (nearestSpots).
 *
 * 판정 기준은 개수 비율이다. 도착해서 한 곳이 만차면 옆으로 옮기게 되므로,
 * "가장 가까운 한 곳"이 아니라 "주변에 뭐가 깔려 있나"가 실제로 겪는 확률에 가깝다.
 *
 * 차폭은 여기 쓰지 않는다. 평행주차 난이도는 전폭보다 전장에 민감하고, 데이터에 구획
 * 크기가 없어 주차장별로 달라지지 않는다 (연결하려면 주차장법 시행규칙 제3조 구획
 * 규격을 먼저 확보해야 한다).
 *
 * 화면 문구에 "노상·노외"를 쓰지 않는다 — 주차장법 제2조 법령 용어라 일반 운전자는
 * 안 쓰는 말이다. 데이터 값과 출처 표기에는 원본 그대로 남긴다.
 */
export function parallelOdds(p: Parking): ParallelOdds {
  const onStreet = p.byType["노상"] ?? 0;
  const offStreet = p.total - onStreet;
  const pct = Math.round((100 * onStreet) / p.total);
  const 규모 = `${p.label} 도보 ${p.walkM}m 안 주차장 ${p.total}곳`;

  if (onStreet === 0)
    return {
      level: "low",
      onStreet,
      offStreet,
      headline: "평행주차를 만날 일이 거의 없습니다",
      detail: `${규모}이 모두 도로 밖에 따로 만든 주차장입니다. 칸에 맞춰 대는 직각주차일 확률이 높습니다.`,
    };

  if (pct >= 50)
    return {
      level: "high",
      onStreet,
      offStreet,
      headline: "평행주차를 만날 확률이 높습니다",
      detail:
        `${규모} 중 ${onStreet}곳(${pct}%)이 도로변에 칸을 그린 주차장입니다. 연석 옆 평행주차일 확률이 높습니다.` +
        (offStreet ? ` 평행주차가 부담되면 도로 밖 주차장 ${offStreet}곳을 먼저 보세요.` : ""),
    };

  return {
    level: "mixed",
    onStreet,
    offStreet,
    headline: "평행주차 구간이 일부 섞여 있습니다",
    detail:
      `${규모} 중 ${onStreet}곳(${pct}%)이 도로변에 칸을 그린 주차장입니다.` +
      " 아래 주차장으로 바로 가면 평행주차를 피할 수 있습니다.",
  };
}

/** 초보에게 권할 주차장 — 도로 밖(직각 확률) 중 가까운 순. 없으면 빈 배열. */
export function recommendedSpots(p: Parking, n = 3): ParkingSpot[] {
  return p.spots.filter((s) => s.type !== "노상").slice(0, n);
}

/**
 * 경력자에게 보여줄 주차장 — 유형을 안 가리고 가까운 순.
 * 평행/직각을 구분해 줄 이유가 없으니 걸러내지도 않는다. 가까운 게 곧 좋은 것이다.
 */
export function nearestSpots(p: Parking, n = 5): ParkingSpot[] {
  return p.spots.slice(0, n);
}
