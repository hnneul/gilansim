// 목적지 주변 착한가격업소 — 거리 필터만 한다.
//
// 원래 이 타입과 접근자는 lib/scenario.ts 안에 있었고, 주석에 "판정할 게 없어 lib 파일을
// 따로 두지 않는다"고 적어 뒀다. 임의 목적지를 받게 되면서 그 전제가 바뀌었다 —
// 목적지별로 미리 잘라둘 수 없으니 런타임에 거르는 로직이 생겼고, 그 로직은 데이터
// 임포트(`@/data/...` 별칭) 없이 검증할 수 있는 자리에 있어야 한다 (lib/parking.ts 와 같은 이유).

export type GoodpriceShop = {
  name: string;
  kind: string; // 음식점 / 이미용 / 세탁업 / 숙박업 / 목욕업 / 기타
  addr: string;
  tel: string | null;
  time: string | null;
  menu: string[]; // "흑돼지정식 9,000원" 형태의 대표 품목
  since: string | null; // "2020년 4월 선정"
  distM: number;
  at: [number, number]; // [위도, 경도]
};

/** 좌표째로 굳혀둔 업소 한 곳 (data/goodprice-data.json). 거리는 런타임에 붙인다. */
export type Shop = Omit<GoodpriceShop, "distM">;

export type Goodprice = {
  label: string;
  at: [number, number]; // 목적지 좌표 (미니 지도 중심)
  radiusM: number;
  total: number;
  byKind: Record<string, number>;
  shops: GoodpriceShop[];
};

/** 카드 목록·미니 지도에 찍을 최대 개수. 총계는 전체로 세고 표시만 자른다. */
const SHOP_CAP = 30;

const rad = (d: number) => (d * Math.PI) / 180;

/** 두 좌표 사이 미터. 제주 크기에선 평면 근사로 충분하다 (빌드 스크립트와 같은 식). */
const meters = (
  [la1, lo1]: [number, number],
  [la2, lo2]: [number, number],
): number => Math.hypot(la2 - la1, (lo2 - lo1) * Math.cos(rad(la1))) * rad(1) * 6371000;

/**
 * 목적지 반경 안 착한가격업소, 가까운 순.
 *
 * 반경이 주차장(1km)보다 넓은 이유: 주차장은 걸어야 하지만 밥집은 목적지에 차를 대고
 * 이동하는 곳이다. 1km로 자르면 성산 1곳·협재 0곳이라 동·서 구간이 통째로 빈다.
 */
export function nearbyGoodprice(
  label: string,
  at: [number, number],
  shops: Shop[],
  radiusM: number,
): Goodprice | null {
  const near: GoodpriceShop[] = [];
  for (const s of shops) {
    const d = Math.round(meters(at, s.at));
    if (d <= radiusM) near.push({ ...s, distM: d });
  }
  if (!near.length) return null;

  near.sort((a, b) => a.distM - b.distM);
  return {
    label,
    at,
    radiusM,
    total: near.length,
    byKind: near.reduce<Record<string, number>>((o, s) => ({ ...o, [s.kind]: (o[s.kind] ?? 0) + 1 }), {}),
    shops: near.slice(0, SHOP_CAP),
  };
}
