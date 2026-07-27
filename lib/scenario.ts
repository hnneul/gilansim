// 시나리오: 제주공항 → 서귀포시청
//
// ⚠️ 전부 임시 데이터다.
//   · 좌표는 눈대중 (PLAN.md §6 소요시간 검증 전까지 확정하지 않는다)
//   · 위험요인의 위치·수치·출처가 모두 미확보 상태다
//   · source 문자열이 화면에 그대로 노출되므로, 실데이터로 교체 전까지 미검증임이 드러난다
// 팀원이 TAAS·도로교통공단 자료를 가져오면 이 파일만 교체하면 된다.

import type { LatLng } from "@/app/RouteMap";
import type { RiskFactor } from "./score";

const 미확보 = "⚠️ 출처 미확보 — 실데이터 아님";

export type Scenario = {
  id: "fast" | "safe";
  name: string;
  color: string;
  path: LatLng[];
  risks: RiskFactor[];
};

const 공항: LatLng = [33.507, 126.493];
const 서귀포시청: LatLng = [33.2541, 126.5601];

export const FAST: Scenario = {
  id: "fast",
  name: "5.16도로 경유",
  color: "#fb923c",
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

export const SAFE: Scenario = {
  id: "safe",
  name: "평화로 경유",
  color: "#38bdf8",
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

export const MARKERS = [
  { coord: 공항, label: "제주국제공항" },
  { coord: 서귀포시청, label: "서귀포시청" },
];

export const MAP_CENTER: LatLng = [33.38, 126.53];
