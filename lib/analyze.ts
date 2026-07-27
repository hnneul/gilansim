// 경로 위험요인 분석 — 빌드 스크립트와 런타임이 **같은 함수**를 쓴다.
//
// 원래 이 코드는 scripts/build-route-data.mjs 안에만 있었다. 임의 구간을 받으려면
// 요청 때마다 분석해야 하는데, 스크립트와 서버가 각자 계산하면 같은 경로에 다른 숫자가
// 나올 수 있다. 근거 카드가 "동일 입력에서 같은 근거"를 보장해야 하므로 한 곳에 둔다.
//
// 계산하는 것 (전부 표준노드링크 + 경로 좌표에서 나온다):
//   · 급커브   : 경로 좌표의 곡률을 직접 계산. 급커브를 공개하는 데이터셋이 없다.
//                임계값은 도로의 구조·시설 기준에 관한 규칙 제19조 최소 평면곡선반지름.
//   · 좁은 교행: 차로수 1 & 제한속도 50km/h↑ (램프를 빼려고 속도 조건을 함께 건다)
//   · 고속주행 : 제한속도 80km/h↑
//
// 성능 (맥북에어 실측): 링크 5.9MB 파싱 0.03초 + 격자 인덱스 0.01초 + 경로 매칭 114ms.
// 두 경로를 합쳐 0.25초라 요청 때마다 돌려도 된다. 인덱스는 한 번 만들어 재사용한다.

import { distance, sharpCurves, densestCluster, simplify, WINDING_GAP, type LatLng } from "./curvature.ts";

/** 슬림 링크 한 줄. scripts/build-link-data.mjs 가 만든다 (원본 속성명을 줄인 것). */
export type Link = {
  l: number | null; // LANES 차로수
  s: number | null; // MAX_SPD 제한속도
  n: string | null; // ROAD_NAME 도로명
  c: [number, number][]; // 좌표열 [경도, 위도] — GeoJSON 순서 그대로다
};

/** 격자 셀 크기(도). 제주 크기에서 이 값이면 셀당 링크가 수십 개다. */
const CELL = 0.01;

/** 좌표에 링크를 붙이는 최대 거리. 이 밖이면 미매칭으로 남긴다 — 억지로 붙이지 않는다. */
const MATCH_M = 40;

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * 도로명 정리. 표준노드링크는 이름 없는 링크에 빈 문자열뿐 아니라 "-" 도 쓴다.
 * 그대로 두면 근거 카드에 "- 0.5km" 같은 위치가 찍힌다.
 */
const roadName = (n: string | null | undefined) => (n && n.trim() && n.trim() !== "-" ? n.trim() : "(무명)");

export type LinkIndex = {
  links: Link[];
  grid: Map<string, number[]>;
};

const cellKey = (la: number, lo: number) => `${Math.floor(la / CELL)},${Math.floor(lo / CELL)}`;

/**
 * 링크 배열 → 격자 인덱스. 링크가 37,063개라 전수 검색하면 좌표 하나당 수백만 번 비교다.
 * 만드는 데 0.01초라 서버 인스턴스가 뜰 때 한 번 만들어 두면 된다.
 */
export function buildIndex(links: Link[]): LinkIndex {
  const grid = new Map<string, number[]>();
  for (const [idx, f] of links.entries()) {
    if (!f.c?.length) continue;
    for (const k of new Set(f.c.map(([lo, la]) => cellKey(la, lo)))) {
      const cell = grid.get(k);
      if (cell) cell.push(idx);
      else grid.set(k, [idx]);
    }
  }
  return { links, grid };
}

/** 점에서 선분까지의 거리(m). 위도 보정만 넣은 평면 근사 — 제주 크기에선 충분하다. */
function distToSeg(p: LatLng, a: LatLng, b: LatLng): number {
  const k = Math.cos(rad(p[0]));
  const APx = (p[1] - a[1]) * k, APy = p[0] - a[0];
  const ABx = (b[1] - a[1]) * k, ABy = b[0] - a[0];
  const ab2 = ABx * ABx + ABy * ABy;
  const t = ab2 === 0 ? 0 : Math.max(0, Math.min(1, (APx * ABx + APy * ABy) / ab2));
  return Math.hypot(APx - ABx * t, APy - ABy * t) * rad(1) * 6371000;
}

/** 좌표에 가장 가까운 링크. MATCH_M 안에 없으면 null. */
export function matchLink({ links, grid }: LinkIndex, p: LatLng): Link | null {
  const cand = new Set<number>();
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++)
      for (const x of grid.get(cellKey(p[0] + i * CELL, p[1] + j * CELL)) ?? []) cand.add(x);

  let best: number | null = null;
  let bestD = MATCH_M;
  for (const idx of cand) {
    const cs = links[idx].c;
    for (let i = 0; i + 1 < cs.length; i++) {
      const d = distToSeg(p, [cs[i][1], cs[i][0]], [cs[i + 1][1], cs[i + 1][0]]);
      if (d < bestD) { bestD = d; best = idx; }
    }
  }
  return best == null ? null : links[best];
}

/** 카카오 길찾기 응답의 vertexes → [위도, 경도] 좌표열. 도로 경계의 중복 좌표를 걸러낸다. */
export function pathOf(route: {
  sections: { roads: { vertexes: number[] }[] }[];
}): LatLng[] {
  const raw: LatLng[] = [];
  for (const sec of route.sections)
    for (const rd of sec.roads)
      for (let i = 0; i < rd.vertexes.length; i += 2) raw.push([rd.vertexes[i + 1], rd.vertexes[i]]);

  const path: LatLng[] = raw.length ? [raw[0]] : [];
  for (const p of raw.slice(1)) if (distance(path[path.length - 1], p) > 0.5) path.push(p);
  return path;
}

type Spot = { seg: number; road: string; p: LatLng };

const sum = (xs: Spot[]) => xs.reduce((s, x) => s + x.seg, 0);

function byRoad(xs: Spot[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const x of xs) o[x.road] = (o[x.road] || 0) + x.seg;
  return Object.fromEntries(
    Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +v.toFixed(1)]),
  );
}

/** 구간의 대표 좌표 — 가장 긴 도로의 중간 지점. 지도 마커를 찍을 자리다. */
function midOf(xs: Spot[]): LatLng | null {
  if (!xs.length) return null;
  const top = Object.keys(byRoad(xs))[0];
  const on = xs.filter((x) => x.road === top);
  return on[Math.floor(on.length / 2)].p;
}

export type Analysis = {
  distanceKm: number;
  durationMin: number;
  path: LatLng[]; // 지도 표시용으로 축약한 좌표
  vertexCount: number;
  matchedKm: number;
  unmatchedKm: number;
  sharpCurve: {
    sections: number;
    km: number;
    windingKm: number;
    windingSections: number;
    exposure: number;
    perKm: number;
    minRadiusM: number | null;
    byRoad: Record<string, number>;
    densest: { at: LatLng; count: number } | null;
  };
  narrow: { km: number; exposure: number; byRoad: Record<string, number>; at: LatLng | null };
  highSpeed: { km: number; exposure: number; byRoad: Record<string, number>; at: LatLng | null };
  lanesKm: Record<string, number>;
  speedKm: Record<string, number>;
  /**
   * 도로명별 총 주행거리(km), 긴 순서. 경로 이름을 여기서 뽑는다 —
   * "5.16도로 경유" 같은 이름을 손으로 적으면 임의 구간에서 쓸 수 없고,
   * 데이터가 바뀔 때 조용히 틀린 말이 된다 (지명 하드코딩 금지).
   */
  roadKm: Record<string, number>;
};

/**
 * 카카오 길찾기 응답 하나 → 위험요인 분석.
 *
 * 최밀집 지점의 **지명은 여기서 붙이지 않는다**. 좌표→행정구역 변환이 또 하나의 API 호출이라
 * 순수 함수로 남겨두고, 호출하는 쪽이 필요할 때 붙인다 (지명 하드코딩 금지 원칙은 그대로).
 */
export function analyze(
  route: { summary: { distance: number; duration: number }; sections: { roads: { vertexes: number[] }[] }[] },
  index: LinkIndex,
): Analysis {
  const path = pathOf(route);
  const attr = path.map((p) => matchLink(index, p));
  const 총거리 = route.summary.distance;

  // ① 급커브 — 저속 도로의 교차로 회전을 세지 않도록 제한속도 50↑ 구간만.
  //   구간 수는 100m 기준(서로 다른 커브를 합치지 않는다),
  //   노출은 WINDING_GAP 기준(짧은 직선으로 끊긴 굽은 길을 하나로 본다). 다른 질문이다.
  const spd = (i: number) => attr[i]?.s ?? null;
  const curves = sharpCurves(path, spd);
  const winding = sharpCurves(path, spd, 50, WINDING_GAP);
  const windingM = winding.reduce((s, c) => s + c.lengthM, 0);
  const cluster = densestCluster(curves);

  const curveByRoad: Record<string, number> = {};
  for (const c of curves) {
    let near = 0;
    for (let i = 1; i < path.length; i++)
      if (distance(path[i], c.start) < distance(path[near], c.start)) near = i;
    const name = roadName(attr[near]?.n);
    curveByRoad[name] = (curveByRoad[name] || 0) + 1;
  }

  // ② 구간 길이를 링크 속성에 배분
  const byLanes: Record<string, number> = {};
  const bySpd: Record<string, number> = {};
  let matched = 0;
  let unmatched = 0;
  const narrow: Spot[] = [];
  const fast: Spot[] = [];
  const all: Spot[] = [];

  for (let i = 0; i + 1 < path.length; i++) {
    const seg = distance(path[i], path[i + 1]) / 1000;
    const a = attr[i];
    if (!a) { unmatched += seg; continue; }
    matched += seg;
    byLanes[String(a.l)] = (byLanes[String(a.l)] || 0) + seg;
    bySpd[String(a.s)] = (bySpd[String(a.s)] || 0) + seg;
    const road = roadName(a.n);
    all.push({ seg, road, p: path[i] });
    // 램프를 빼기 위해 제한속도 50↑ 조건을 함께 건다
    if (a.l === 1 && (a.s ?? 0) >= 50) narrow.push({ seg, road, p: path[i] });
    if ((a.s ?? 0) >= 80) fast.push({ seg, road, p: path[i] });
  }

  const round1 = (n: number) => +n.toFixed(1);
  const round3 = (n: number) => +n.toFixed(3);

  return {
    distanceKm: round1(총거리 / 1000),
    durationMin: Math.round(route.summary.duration / 60),
    path: simplify(path),
    vertexCount: path.length,
    matchedKm: round1(matched),
    unmatchedKm: round1(unmatched),
    sharpCurve: {
      sections: curves.length,
      km: round1(curves.reduce((s, c) => s + c.lengthM, 0) / 1000),
      windingKm: round1(windingM / 1000),
      windingSections: winding.length,
      // 노출 비율 — 요인마다 단위가 달라지면 점수에 크기를 반영할 수 없다.
      // 급커브 조각만 더하면 과소평가된다 (커브 사이 직선도 굽은 길의 일부다).
      exposure: round3(windingM / 총거리),
      perKm: +(curves.length / (총거리 / 1000)).toFixed(2),
      minRadiusM: curves.length ? Math.round(Math.min(...curves.map((c) => c.minRadius))) : null,
      byRoad: Object.fromEntries(Object.entries(curveByRoad).sort((a, b) => b[1] - a[1])),
      densest: cluster && {
        at: cluster.at.map((x) => +x.toFixed(4)) as LatLng,
        count: cluster.count,
      },
    },
    narrow: {
      km: round1(sum(narrow)),
      exposure: round3((sum(narrow) * 1000) / 총거리),
      byRoad: byRoad(narrow),
      at: midOf(narrow),
    },
    highSpeed: {
      km: round1(sum(fast)),
      exposure: round3((sum(fast) * 1000) / 총거리),
      byRoad: byRoad(fast),
      at: midOf(fast),
    },
    lanesKm: Object.fromEntries(Object.entries(byLanes).map(([k, v]) => [k, round1(v)])),
    speedKm: Object.fromEntries(Object.entries(bySpd).map(([k, v]) => [k, round1(v)])),
    roadKm: byRoad(all),
  };
}
