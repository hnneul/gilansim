// 시나리오 데이터 — PLAN.md §6
//
// 경로 좌표·소요시간·위험요인 수치가 모두 실데이터다.
// 생성 과정은 scripts/build-route-data.mjs 에 있고, 산출물은 data/route-data.json 이다.
//   · 경로 좌표: 카카오모빌리티 길찾기 API 응답 vertexes (지도 표시용으로 30m 축약)
//   · 급커브: 위 좌표의 곡률을 직접 계산 (급커브 구간을 공개하는 데이터셋이 없다).
//             판정 임계값은 규칙 제19조 최소 평면곡선반지름을 구간 제한속도로 유도한다.
//   · 차로수·제한속도: 표준노드링크 2026-07-16 (국가교통정보센터)
//   · 최밀집 지점 지명: 카카오 로컬 API 좌표→행정구역 변환 (지명 하드코딩 금지)
//
// 남은 미확보 요인 — 원칙에 따라 아예 넣지 않는다:
//   · accidentZone : 공개 사고다발지역 데이터가 보행자·어린이·노인 유형뿐이라
//                    두 경로가 같은 지점(서귀포 시내)만 잡혀 경로를 구분하지 못한다
//   · steepSlope   : 고도(DEM) 미확보
//   · complexJunction : 경로상 4갈래+ 교차로가 168개 / 174개로 차이가 없어 폐기

import type { LatLng } from "@/app/RouteMap";
import type { RiskFactor } from "./score";
import { nearbyParking, type Parking, type Lot } from "./parking";
import { nearbyGoodprice, type Goodprice, type Shop } from "./goodprice";
import DATA from "@/data/route-data.json";
import PARKING from "@/data/parking-data.json";
import GOODPRICE from "@/data/goodprice-data.json";

/**
 * 소요시간·거리 출처: 카카오모빌리티 길찾기 API (미래 운행 정보, 2026-07-28 10:00 출발 기준)
 *
 * 실측 결과 — §6이 우려하던 "평화로가 더 빠른" 경우가 실제로 확인됐다:
 *   5.16도로 43.0km / 64분   ← 최단거리(priority=DISTANCE). 하지만 5분 더 걸린다
 *   평화로   53.1km / 59분   ← 최단시간(priority=TIME)
 * 즉 5.16도로는 "빠른 경로"가 아니라 "내비가 최단거리로 안내하는 경로"다.
 *
 * 단, 여기 굳힌 durationMin 은 폴백이다 — 화면에는 lib/traffic.ts 가 조회한 실시간
 * 소요시간이 오고, 조회에 실패할 때만 이 값이 쓰인다. 거리·경로좌표·위험요인은 항상 이 값이다.
 */
const 경로출처 = "카카오모빌리티 길찾기 API (2026-07-28 10:00 출발)";

const 곡률출처 =
  "경로좌표 곡률 계산 (카카오모빌리티 길찾기 API) · 임계값: 도로의 구조·시설 기준에 관한 규칙 제19조 최소 평면곡선반지름 · 표준노드링크 2026-07-16 제한속도 50km/h↑ 구간";
const 노드링크출처 = "표준노드링크 2026-07-16 (국가교통정보센터)";

/** PLAN.md §4 Route */
export type Route = {
  id: "fast" | "safe";
  name: string;
  badge: string; // 화면에 붙는 성격 표시 ("내비 최단거리" / "맞춤 저부담")
  color: string;
  durationMin: number | null;
  distanceKm: number | null;
  durationSource: string;
  path: LatLng[];
  risks: RiskFactor[];
};

/** §11 "검증되지 않은 구간은 추천하지 않는다" — 미검증 구간은 routes가 없다. */
export type Scenario = {
  id: string;
  label: string;
  verified: boolean;
  center: LatLng;
  level: number;
  markers: { coord: LatLng; label: string }[];
  routes: [Route, Route] | null;
};

const 공항: LatLng = [33.507, 126.493];
// 카카오 로컬 API 키워드 검색 (서귀포시 중앙로62번길 18)
const 올레시장: LatLng = [33.2502, 126.5632];

const FAST: Route = {
  id: "fast",
  name: "5.16도로 경유",
  badge: "내비 최단거리",
  color: "#fb923c",
  durationMin: DATA.fast.durationMin,
  distanceKm: DATA.fast.distanceKm,
  durationSource: 경로출처,
  path: DATA.fast.path as LatLng[],
  risks: [
    {
      type: "sharpCurve",
      label: "5.16도로 연속 급커브",
      location: `${DATA.fast.sharpCurve.densest!.region} 일대 (5km 내 ${DATA.fast.sharpCurve.densest!.count}곳)`,
      coord: DATA.fast.sharpCurve.densest!.at as LatLng,
      value: `급커브 ${DATA.fast.sharpCurve.byRoad["516로"]}곳 (최소 반경 ${DATA.fast.sharpCurve.minRadiusM}m) · 굽은 구간 ${DATA.fast.sharpCurve.windingKm}km`,
      exposure: DATA.fast.sharpCurve.exposure,
      source: 곡률출처,
    },
    {
      type: "narrowRoad",
      label: "좁은 교행 구간",
      location: `5.16도로 (${DATA.fast.narrow.byRoad["516로"]}km)`,
      coord: DATA.fast.narrow.at as LatLng,
      value: `차로수 1 구간 ${DATA.fast.narrow.km}km`,
      exposure: DATA.fast.narrow.exposure,
      source: 노드링크출처,
    },
  ],
};

const SAFE: Route = {
  id: "safe",
  name: "평화로 경유",
  badge: "맞춤 저부담",
  color: "#38bdf8",
  durationMin: DATA.safe.durationMin,
  distanceKm: DATA.safe.distanceKm,
  durationSource: 경로출처,
  path: DATA.safe.path as LatLng[],
  risks: [
    {
      type: "highSpeed",
      label: "고속주행 구간",
      location: `평화로 ${DATA.safe.highSpeed.byRoad["평화로"]}km · 중산간서로 ${DATA.safe.highSpeed.byRoad["중산간서로"]}km`,
      coord: DATA.safe.highSpeed.at as LatLng,
      value: `제한속도 80km/h 구간 ${DATA.safe.highSpeed.km}km`,
      exposure: DATA.safe.highSpeed.exposure,
      source: 노드링크출처,
    },
    {
      type: "narrowRoad",
      label: "좁은 교행 구간",
      location: `평화로 (${DATA.safe.narrow.byRoad["평화로"]}km)`,
      coord: DATA.safe.narrow.at as LatLng,
      value: `차로수 1 구간 ${DATA.safe.narrow.km}km`,
      exposure: DATA.safe.narrow.exposure,
      source: 노드링크출처,
    },
  ],
};

/**
 * 목적지 주차장. 경로 위험요인과 달리 경로 검증과 무관하므로 미검증 구간에서도 보여준다.
 * 판정 로직은 lib/parking.ts, 데이터 생성은 scripts/build-parking-data.mjs.
 */
export const PARKING_SOURCE = `${PARKING.source} · 주차장유형(노상/노외)을 평행·직각 주차 프록시로 사용`;

/**
 * 목적지 좌표 → 주변 주차장. 굳혀둔 3구간과 임의 구간이 **같은 함수**를 쓴다 —
 * 목적지별로 미리 잘라둔 목록을 두면 임의 구간에서 쓸 수 없고, 두 경로가 갈리면
 * 같은 목적지에 다른 숫자가 나온다.
 *
 * JSON 임포트는 좌표를 number[] 로 넓혀 읽어서 [number, number] 튜플과 겹치지 않는다.
 * 생성 쪽(build-parking-data.mjs)이 항상 두 개를 넣으므로 여기서 좁혀준다.
 */
export function parkingAt(label: string, at: LatLng): Parking | null {
  return nearbyParking(label, at, PARKING.spots as unknown as Lot[], PARKING.walkM);
}

/**
 * 목적지 주변 착한가격업소. 타입과 거리 필터는 lib/goodprice.ts 에 있다 —
 * 임의 목적지를 받게 되면서 런타임 로직이 생겼고, 그건 데이터 임포트 없이 검증할 수
 * 있는 자리에 있어야 한다 (lib/parking.ts 와 같은 이유).
 */
export const GOODPRICE_SOURCE = `${GOODPRICE.source} · jeju.go.kr 물가정보`;

export function goodpriceAt(label: string, at: LatLng): Goodprice | null {
  return nearbyGoodprice(label, at, GOODPRICE.shops as unknown as Shop[], GOODPRICE.radiusM);
}

export const SCENARIOS: Scenario[] = [
  {
    id: "seogwipo",
    label: "제주공항 → 서귀포 매일올레시장",
    verified: true,
    center: [33.38, 126.53],
    level: 10,
    markers: [
      { coord: 공항, label: "제주국제공항" },
      { coord: 올레시장, label: "서귀포 매일올레시장" },
    ],
    routes: [FAST, SAFE],
  },
  // 동·서 구간은 이름만 올려둔 상태다. 공항에서 남(서귀포)·동(성산)·서(협재)로
  // 갈라지는 세 방향을 덮으려는 것이고, 위험요인 검증 전이라 routes가 없다.
  // §11 "검증되지 않은 구간은 추천하지 않는다" — 목록에는 보이되 추천은 안 한다.
  {
    id: "seongsan",
    label: "제주공항 → 성산일출봉",
    verified: false,
    center: [33.43, 126.68],
    level: 10,
    markers: [
      { coord: 공항, label: "제주국제공항" },
      { coord: [33.4581, 126.9425], label: "성산일출봉" },
    ],
    routes: null,
  },
  {
    id: "hyeopjae",
    label: "제주공항 → 협재해수욕장",
    verified: false,
    center: [33.45, 126.37],
    level: 10,
    markers: [
      { coord: 공항, label: "제주국제공항" },
      // 카카오 로컬 API 키워드 검색 (제주시 한림읍 협재리)
      { coord: [33.3943, 126.2397], label: "협재해수욕장" },
    ],
    routes: null,
  },
];
