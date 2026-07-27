// 시나리오 데이터 — PLAN.md §6
//
// ⚠️ 아래 값은 전부 임시다.
//   · 좌표는 눈대중 (§6: 소요시간 검증 전까지 확정하지 않는다)
//   · 위험요인의 위치·수치·출처가 모두 미확보 상태다
//   · source 문자열이 화면에 그대로 노출되므로 미검증임이 드러난다
// 팀원이 TAAS·도로교통공단 자료를 가져오면 이 파일만 교체하면 된다.

import type { LatLng } from "@/app/RouteMap";
import type { RiskFactor } from "./score";

const 미확보 = "⚠️ 출처 미확보 — 실데이터 아님";

/**
 * 소요시간·거리 출처: 카카오모빌리티 길찾기 API (미래 운행 정보, 2026-07-28 10:00 출발 기준)
 *
 * 실측 결과 — §6이 우려하던 "평화로가 더 빠른" 경우가 실제로 확인됐다:
 *   5.16도로 43.1km / 72분   ← 최단거리. 하지만 하루 어느 시간대에도 더 느리다(08~21시 +6~10분)
 *   평화로   52.5km / 65분   ← 최단시간
 * 즉 5.16도로는 "빠른 경로"가 아니라 "내비가 최단거리로 안내하는 경로"다.
 */
const 경로출처 = "카카오모빌리티 길찾기 API (2026-07-28 10:00 출발)";

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
const 서귀포시청: LatLng = [33.2541, 126.5601];

const FAST: Route = {
  id: "fast",
  name: "5.16도로 경유",
  badge: "내비 최단거리",
  color: "#fb923c",
  durationMin: 72,
  distanceKm: 43.1,
  durationSource: 경로출처,
  path: [공항, [33.489, 126.5219], [33.44, 126.557], [33.385, 126.613], 서귀포시청],
  risks: [
    {
      type: "accidentZone",
      label: "5.16도로 사고다발구간",
      location: "성판악 부근",
      coord: [33.385, 126.613],
      value: "미확보",
      source: 미확보,
    },
    {
      type: "sharpCurve",
      label: "연속 급커브",
      location: "산천단~성판악",
      coord: [33.44, 126.557],
      value: "미확보",
      source: 미확보,
    },
    {
      type: "steepSlope",
      label: "급경사 내리막",
      location: "성판악~서귀포",
      coord: [33.33, 126.6],
      value: "미확보",
      source: 미확보,
    },
  ],
};

const SAFE: Route = {
  id: "safe",
  name: "평화로 경유",
  badge: "맞춤 저부담",
  color: "#38bdf8",
  durationMin: 65,
  distanceKm: 52.5,
  durationSource: 경로출처,
  path: [공항, [33.47, 126.46], [33.41, 126.39], [33.33, 126.35], [33.26, 126.42], 서귀포시청],
  risks: [
    {
      type: "complexJunction",
      label: "동광 교차로",
      location: "평화로 중간",
      coord: [33.33, 126.35],
      value: "미확보",
      source: 미확보,
    },
    {
      type: "highSpeed",
      label: "고속주행 구간",
      location: "평화로 전 구간",
      coord: [33.41, 126.39],
      value: "미확보",
      source: 미확보,
    },
  ],
};

export const SCENARIOS: Scenario[] = [
  {
    id: "seogwipo",
    label: "제주공항 → 서귀포시청",
    verified: true,
    center: [33.38, 126.53],
    level: 10,
    markers: [
      { coord: 공항, label: "제주국제공항" },
      { coord: 서귀포시청, label: "서귀포시청" },
    ],
    routes: [FAST, SAFE],
  },
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
    routes: null, // 위험구간 검증 전이라 추천을 제공하지 않는다
  },
];
