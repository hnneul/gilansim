// 임의 구간 런타임 경로 분석 — 계획서 Core 완료 기준 1·2·5
//
// 굳혀둔 3구간(lib/scenario.ts)과 달리 출발지·목적지를 받아 그 자리에서 분석한다.
// 분석 자체는 lib/analyze.ts 가 하고(빌드 스크립트와 같은 함수), 여기서는 세 가지를 한다:
//   ① 카카오 길찾기 2회 병렬 호출 (departure_time 없음 = 현재 교통)
//   ② 경로 이름 짓기 — 지명 하드코딩 없이 도로명 데이터에서 뽑는다
//   ③ 두 경로가 사실상 같은 길인지 판정 (Core 기준 5 "대안 경로가 없으면")
//
// 검증에 대해: 굳혀둔 3구간은 서귀포시 급커브 정답지로 대조한 구간이라 추천까지 하지만,
// 임의 구간은 그 대조를 할 수 없다. 그래서 이 모듈이 만든 경로는 verified: false 다 —
// 부담구간은 계산해 보여주되 "추천"이라고 말하지 않는다. 화면이 그 차이를 표시한다.

import { analyze, buildIndex, type Analysis, type Link, type LinkIndex } from "./analyze.ts";
import type { LatLng } from "./curvature.ts";
import type { RiskFactor } from "./score.ts";

const ENDPOINT = "https://apis-navi.kakaomobility.com/v1/directions";

/** 길찾기 응답을 기다리는 한계. 넘기면 경로를 못 만든다 (호출한 쪽이 안내한다). */
const TIMEOUT_MS = 6000;

/**
 * 두 경로를 "다른 길"로 볼 최소 조건: 한쪽에만 이만큼 있는 도로가 있어야 다른 길이다.
 *
 * 짧은 구간에서는 최단거리·최단시간이 같은 길로 수렴한다 — 실측으로 공항→제주시청(약 5km)이
 * 4.9km vs 5.3km 로 갈렸는데 둘 다 서광로였다. 그때 두 경로를 나란히 보여주면 없는 선택지를
 * 만드는 것이다. 계획서 Core 기준 5가 말하는 "대안 경로가 없으면"이 이 경우다.
 *
 * 처음엔 "거리 3% 이내 + 가르는 도로 없음"으로 봤는데, 위 실측이 8% 차이라 두 장의 카드가
 * 똑같이 "서광로 경유"로 떴다. 거리는 같은 길에서도 우회 한 번에 흔들린다 —
 * **도로 구성**이 다른 길인지를 정한다. 거리 조건은 버렸다.
 */
const 갈림_최소도로km = 2;

const 곡률출처 =
  "경로좌표 곡률 계산 (카카오모빌리티 길찾기 API) · 임계값: 도로의 구조·시설 기준에 관한 규칙 제19조 최소 평면곡선반지름 · 표준노드링크 2026-07-16 제한속도 50km/h↑ 구간";
const 노드링크출처 = "표준노드링크 2026-07-16 (국가교통정보센터)";

/** 격자 인덱스는 만드는 데 14ms 지만 링크 파싱이 28ms 다. 인스턴스마다 한 번만 한다. */
let 인덱스: LinkIndex | null = null;

export function linkIndex(links: Link[]): LinkIndex {
  return (인덱스 ??= buildIndex(links));
}

const coord = ([la, lo]: LatLng) => `${lo},${la}`;

type KakaoRoute = {
  result_code: number;
  result_msg?: string;
  summary: { distance: number; duration: number };
  sections: { roads: { name?: string; distance: number; traffic_state?: number; vertexes: number[] }[] }[];
};

async function directions(
  origin: LatLng,
  destination: LatLng,
  priority: "DISTANCE" | "TIME",
  key: string,
): Promise<KakaoRoute> {
  const q = new URLSearchParams({
    origin: coord(origin),
    destination: coord(destination),
    priority,
    road_details: "true", // 좌표열과 traffic_state 가 이 옵션에 딸려 온다
    alternatives: "false",
    // departure_time 을 주지 않는다 = 현재 시각 교통 (lib/traffic.ts 와 같은 이유)
  });
  const res = await fetch(`${ENDPOINT}?${q}`, {
    headers: { Authorization: `KakaoAK ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error("길찾기 서버에서 응답을 받지 못했습니다");
  const route: KakaoRoute | undefined = (await res.json()).routes?.[0];
  if (!route) throw new Error("길찾기 결과가 비어 있습니다");
  // result_msg 는 카카오가 준 한국어 문구다 ("도착 지점 주변의 도로를 탐색할 수 없음")
  if (route.result_code !== 0) throw new Error(route.result_msg || `길찾기 실패 (${route.result_code})`);
  return route;
}

/**
 * 경로 이름. 상대 경로엔 거의 없고 내 쪽에 길게 있는 도로 = 두 경로를 가르는 도로다.
 * 사람이 "5.16도로 경유 / 평화로 경유"라고 부르는 방식 그대로고, 이름은 표준노드링크에서 온다.
 *
 * 이름을 못 찾으면(단일 경로 등) 그냥 가장 긴 도로를 쓴다.
 */
export function nameOf(mine: Analysis, other?: Analysis): string {
  const mineRoads = Object.entries(mine.roadKm).filter(([r]) => r !== "(무명)");
  if (!mineRoads.length) return "경로";
  const 가른도로 = other
    ? mineRoads.find(([road, km]) => km >= 갈림_최소도로km && (other.roadKm[road] ?? 0) < km * 0.3)
    : undefined;
  return `${(가른도로 ?? mineRoads[0])[0]} 경유`;
}

/** 한쪽에만 길게 있는 도로가 있나 — 두 경로를 가르는 도로다 (경로 이름도 여기서 나온다) */
const 가르는도로있나 = (x: Analysis, y: Analysis) =>
  Object.entries(x.roadKm).some(
    ([road, km]) => road !== "(무명)" && km >= 갈림_최소도로km && (y.roadKm[road] ?? 0) < km * 0.3,
  );

/**
 * 두 분석이 사실상 같은 길인가. 어느 쪽에도 상대를 가르는 도로가 없으면 같은 길이다.
 * 순수 함수라 lib/route.check.ts 가 네트워크 없이 검증한다.
 */
export function sameRoute(a: Analysis, b: Analysis): boolean {
  return !가르는도로있나(a, b) && !가르는도로있나(b, a);
}

/** 도로별 거리 집계 → 근거 카드의 "위치" 문구. 상위 두 개까지만 쓴다 (길어지면 안 읽힌다). */
function 위치(byRoad: Record<string, number>): string {
  const top = Object.entries(byRoad).filter(([, km]) => km > 0).slice(0, 2);
  if (!top.length) return "-";
  return top.map(([road, km]) => `${road} ${km}km`).join(" · ");
}

/**
 * 분석 → 근거 카드용 위험요인 목록. 값이 0인 요인은 넣지 않는다 —
 * "0km 구간이 있습니다"는 근거가 아니고, 계획서 원칙(확인된 것만)에도 어긋난다.
 */
export function risksOf(a: Analysis): RiskFactor[] {
  const out: RiskFactor[] = [];

  if (a.sharpCurve.sections > 0 && a.sharpCurve.densest) {
    const 커브도로 = Object.keys(a.sharpCurve.byRoad).find((r) => r !== "(무명)");
    out.push({
      type: "sharpCurve",
      label: "연속 급커브",
      location: `${커브도로 ?? "경로 상"} 일대 (5km 내 ${a.sharpCurve.densest.count}곳)`,
      coord: a.sharpCurve.densest.at,
      value: `급커브 ${a.sharpCurve.sections}곳 (최소 반경 ${a.sharpCurve.minRadiusM}m) · 굽은 구간 ${a.sharpCurve.windingKm}km`,
      exposure: a.sharpCurve.exposure,
      source: 곡률출처,
    });
  }

  if (a.narrow.km > 0 && a.narrow.at) {
    out.push({
      type: "narrowRoad",
      label: "좁은 교행 구간",
      location: 위치(a.narrow.byRoad),
      coord: a.narrow.at,
      value: `차로수 1 구간 ${a.narrow.km}km`,
      exposure: a.narrow.exposure,
      source: 노드링크출처,
    });
  }

  if (a.highSpeed.km > 0 && a.highSpeed.at) {
    out.push({
      type: "highSpeed",
      label: "고속주행 구간",
      location: 위치(a.highSpeed.byRoad),
      coord: a.highSpeed.at,
      value: `제한속도 80km/h 구간 ${a.highSpeed.km}km`,
      exposure: a.highSpeed.exposure,
      source: 노드링크출처,
    });
  }

  return out;
}

export type LiveRoute = {
  id: "fast" | "safe";
  name: string;
  badge: string;
  color: string;
  durationMin: number;
  distanceKm: number;
  durationSource: string;
  path: LatLng[];
  risks: RiskFactor[];
};

export type LiveRoutes =
  | {
      /** 두 개면 비교, 하나면 대안 경로가 없는 구간이다 (Core 기준 5) */
      routes: [LiveRoute, LiveRoute] | [LiveRoute];
      at: string; // 조회 시각 (Asia/Seoul)
    }
  | {
      /**
       * 화면에 그대로 보여줄 실패 사유.
       *
       * null 하나로 뭉치지 않는 이유: "API가 죽었다"와 "이 지점 주변에 도로가 없다"는
       * 사용자가 할 일이 다르다. 후자는 다른 지점을 고르면 되는데, 실측으로 성산일출봉
       * 정상 좌표가 그랬다 (result_code 103 "도착 지점 주변의 도로를 탐색할 수 없음").
       * 카카오가 한국어 사유를 주므로 우리가 코드별 문구를 따로 만들지 않는다.
       */
      error: string;
    };

const 색 = { fast: "#fb923c", safe: "#38bdf8" };

function toRoute(id: "fast" | "safe", a: Analysis, name: string, badge: string, at: string): LiveRoute {
  return {
    id,
    name,
    badge,
    color: 색[id],
    durationMin: a.durationMin,
    distanceKm: a.distanceKm,
    durationSource: `카카오모빌리티 길찾기 API 실시간 교통 (${at} 조회)`,
    path: a.path,
    risks: risksOf(a),
  };
}

/**
 * 출발지·목적지 → 분석된 경로. 실패하면 사유를 준다 —
 * 굳혀둔 구간과 달리 폴백할 데이터가 없으므로(임의 구간이니 당연하다) 화면이 사유를 말해야 한다.
 */
export async function routesFor(
  origin: LatLng,
  destination: LatLng,
  links: Link[],
): Promise<LiveRoutes> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return { error: "길찾기 키가 설정되지 않았습니다" };

  try {
    const [fastRaw, safeRaw] = await Promise.all([
      directions(origin, destination, "DISTANCE", key),
      directions(origin, destination, "TIME", key),
    ]);

    const index = linkIndex(links);
    const fast = analyze(fastRaw, index);
    const safe = analyze(safeRaw, index);
    const at = new Date().toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Seoul",
    });

    // 같은 길이면 하나만 준다 — 없는 선택지를 두 장의 카드로 만들지 않는다.
    // 최단시간 쪽을 남긴다: 같은 길이면 내비가 실제로 안내할 쪽이다.
    if (sameRoute(fast, safe))
      return { routes: [toRoute("safe", safe, nameOf(safe), "단일 경로", at)], at };

    return {
      routes: [
        toRoute("fast", fast, nameOf(fast, safe), "내비 최단거리", at),
        toRoute("safe", safe, nameOf(safe, fast), "맞춤 저부담", at),
      ],
      at,
    };
  } catch (e) {
    // 두 호출을 Promise.all 로 묶었으니 먼저 실패한 쪽의 사유가 온다.
    // 타임아웃(AbortError)은 사유가 영어라 우리 문구로 갈아준다.
    const msg = e instanceof Error ? e.message : "";
    return { error: /abort|timeout/i.test(msg) || !msg ? "길찾기 응답이 늦어 경로를 만들지 못했습니다" : msg };
  }
}
