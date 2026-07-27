// 경로 데이터 생성 — node scripts/build-route-data.mjs
//
// PLAN §2는 런타임 길찾기 API를 의도적으로 제외했다. 그래서 API는 여기서 한 번만 호출하고,
// 결과를 data/route-data.json 으로 굳혀 시나리오가 그걸 읽는다.
// 이 파일이 scenario.ts 숫자들의 출처다 — 숫자만 있고 만든 과정이 없으면 근거가 아니다.
//
// 선행 준비 (표준노드링크, 1회):
//   Z="/vsizip/<경로>/[2026-07-16]NODELINKDATA.zip/[2026-07-16]NODELINKDATA"
//   SHAPE_ENCODING=CP949 ogr2ogr -f GeoJSON -t_srs EPSG:4326 \
//     -spat 126.14 33.10 126.98 33.60 -spat_srs EPSG:4326 data/jeju_link.geojson "$Z/MOCT_LINK.shp"

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { distance, sharpCurves, densestCluster, simplify, WINDING_GAP } from "../lib/curvature.ts";

// 프로젝트 경로에 한글이 있어 URL.pathname은 못 쓴다 (퍼센트 인코딩이 남는다)
const DATA = fileURLToPath(new URL("../data/", import.meta.url));
const ENV = fileURLToPath(new URL("../.env.local", import.meta.url));

const 공항 = "126.493,33.507";
const 서귀포시청 = "126.5601,33.2541";
const DEPARTURE = "202607281000"; // 고정해야 소요시간이 재현된다

const KEY = readFileSync(ENV, "utf8")
  .split("\n")
  .find((l) => l.startsWith("KAKAO_REST_API_KEY="))
  ?.split("=")[1]
  ?.trim();

/** priority=DISTANCE → 5.16도로, TIME → 평화로. 카카오가 두 경로를 이렇게 갈라준다. */
async function directions(priority) {
  const cache = `${DATA}route-${priority}.json`;
  try {
    return JSON.parse(readFileSync(cache, "utf8")); // 이미 받아뒀으면 재호출하지 않는다
  } catch {
    /* 아래에서 호출 */
  }
  if (!KEY) throw new Error("KAKAO_REST_API_KEY 없음 (.env.local)");
  const q = new URLSearchParams({
    origin: 공항,
    destination: 서귀포시청,
    priority,
    departure_time: DEPARTURE,
    road_details: "true",
    alternatives: "false",
  });
  const res = await fetch(`https://apis-navi.kakaomobility.com/v1/directions?${q}`, {
    headers: { Authorization: `KakaoAK ${KEY}` },
  });
  if (!res.ok) throw new Error(`${priority}: HTTP ${res.status} ${await res.text()}`);
  const json = await res.json();
  writeFileSync(cache, JSON.stringify(json));
  return json;
}

// ---------- 표준노드링크 격자 인덱스 ----------
const links = JSON.parse(readFileSync(`${DATA}jeju_link.geojson`, "utf8")).features;
const CELL = 0.01;
const grid = new Map();
const cellKey = (la, lo) => `${Math.floor(la / CELL)},${Math.floor(lo / CELL)}`;
for (const [idx, f] of links.entries()) {
  const cs = f.geometry?.coordinates;
  if (!cs) continue;
  for (const k of new Set(cs.map(([lo, la]) => cellKey(la, lo)))) {
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(idx);
  }
}

const rad = (d) => (d * Math.PI) / 180;
function distToSeg(p, a, b) {
  const k = Math.cos(rad(p[0]));
  const APx = (p[1] - a[1]) * k, APy = p[0] - a[0];
  const ABx = (b[1] - a[1]) * k, ABy = b[0] - a[0];
  const ab2 = ABx * ABx + ABy * ABy;
  const t = ab2 === 0 ? 0 : Math.max(0, Math.min(1, (APx * ABx + APy * ABy) / ab2));
  return Math.hypot(APx - ABx * t, APy - ABy * t) * rad(1) * 6371000;
}
/** 좌표에 가장 가까운 링크. 40m 안에 없으면 null — 억지로 붙이지 않고 미매칭으로 남긴다. */
function matchLink(p) {
  const cand = new Set();
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++)
      for (const x of grid.get(cellKey(p[0] + i * CELL, p[1] + j * CELL)) ?? []) cand.add(x);
  let best = null, bestD = 40;
  for (const idx of cand) {
    const cs = links[idx].geometry.coordinates;
    for (let i = 0; i + 1 < cs.length; i++) {
      const d = distToSeg(p, [cs[i][1], cs[i][0]], [cs[i + 1][1], cs[i + 1][0]]);
      if (d < bestD) { bestD = d; best = idx; }
    }
  }
  return best == null ? null : links[best].properties;
}

// ---------- 경로별 분석 ----------
const out = {};

for (const [id, priority] of [["fast", "DISTANCE"], ["safe", "TIME"]]) {
  const route = (await directions(priority)).routes[0];
  if (route.result_code !== 0) throw new Error(`${priority}: ${route.result_msg}`);

  // 좌표열 펼치기 (vertexes는 [경도,위도] 평면 배열)
  const raw = [];
  for (const sec of route.sections)
    for (const rd of sec.roads)
      for (let i = 0; i < rd.vertexes.length; i += 2)
        raw.push([rd.vertexes[i + 1], rd.vertexes[i]]);
  // 도로 경계에서 같은 좌표가 두 번 나온다
  const path = [raw[0]];
  for (const p of raw.slice(1)) if (distance(path.at(-1), p) > 0.5) path.push(p);

  const attr = path.map(matchLink);

  // ① 급커브 — 저속 도로의 교차로 회전을 세지 않도록 제한속도 50↑ 구간만.
  //   구간 수는 100m 기준(서로 다른 커브를 합치지 않는다),
  //   노출은 WINDING_GAP 기준(짧은 직선으로 끊긴 굽은 길을 하나로 본다). 다른 질문이다.
  const spd = (i) => attr[i]?.MAX_SPD ?? null;
  const curves = sharpCurves(path, spd);
  const winding = sharpCurves(path, spd, 50, WINDING_GAP);
  const windingM = winding.reduce((s, c) => s + c.lengthM, 0);
  const cluster = densestCluster(curves);
  const curveByRoad = {};
  for (const c of curves) {
    const near = path.reduce((b, p, i) => (distance(p, c.start) < distance(path[b], c.start) ? i : b), 0);
    const name = attr[near]?.ROAD_NAME || "(무명)";
    curveByRoad[name] = (curveByRoad[name] || 0) + 1;
  }

  // ② 구간 길이를 링크 속성에 배분
  const byLanes = {}, bySpd = {};
  let matched = 0, unmatched = 0;
  const spots = { narrow: [], fast: [] };
  for (let i = 0; i + 1 < path.length; i++) {
    const seg = distance(path[i], path[i + 1]) / 1000;
    const a = attr[i];
    if (!a) { unmatched += seg; continue; }
    matched += seg;
    byLanes[a.LANES] = (byLanes[a.LANES] || 0) + seg;
    bySpd[a.MAX_SPD] = (bySpd[a.MAX_SPD] || 0) + seg;
    // 램프를 빼기 위해 제한속도 50↑ 조건을 함께 건다
    if (a.LANES === 1 && a.MAX_SPD >= 50) spots.narrow.push({ seg, road: a.ROAD_NAME, p: path[i] });
    if (a.MAX_SPD >= 80) spots.fast.push({ seg, road: a.ROAD_NAME, p: path[i] });
  }
  const sum = (xs) => xs.reduce((s, x) => s + x.seg, 0);
  const byRoad = (xs) => {
    const o = {};
    for (const x of xs) o[x.road || "(무명)"] = (o[x.road || "(무명)"] || 0) + x.seg;
    return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +v.toFixed(1)]));
  };
  /** 구간의 대표 좌표 — 가장 긴 도로의 중간 지점 */
  const midOf = (xs) => {
    if (!xs.length) return null;
    const top = Object.keys(byRoad(xs))[0];
    const on = xs.filter((x) => (x.road || "(무명)") === top);
    return on[Math.floor(on.length / 2)].p;
  };

  out[id] = {
    priority,
    distanceKm: +(route.summary.distance / 1000).toFixed(1),
    durationMin: Math.round(route.summary.duration / 60),
    path: simplify(path),
    vertexCount: path.length,
    matchedKm: +matched.toFixed(1),
    unmatchedKm: +unmatched.toFixed(1),
    sharpCurve: {
      sections: curves.length,
      km: +(curves.reduce((s, c) => s + c.lengthM, 0) / 1000).toFixed(1),
      windingKm: +(windingM / 1000).toFixed(1),
      windingSections: winding.length,
      // 노출 비율 — 요인마다 단위가 달라지면 점수에 크기를 반영할 수 없다.
      // 급커브 조각만 더하면 과소평가된다 (커브 사이 직선도 굽은 길의 일부다).
      exposure: +(windingM / route.summary.distance).toFixed(3),
      perKm: +(curves.length / (route.summary.distance / 1000)).toFixed(2),
      minRadiusM: curves.length ? Math.round(Math.min(...curves.map((c) => c.minRadius))) : null,
      byRoad: Object.fromEntries(Object.entries(curveByRoad).sort((a, b) => b[1] - a[1])),
      densest: cluster && { at: cluster.at.map((x) => +x.toFixed(4)), count: cluster.count },
    },
    narrow: {
      km: +sum(spots.narrow).toFixed(1),
      exposure: +((sum(spots.narrow) * 1000) / route.summary.distance).toFixed(3),
      byRoad: byRoad(spots.narrow),
      at: midOf(spots.narrow),
    },
    highSpeed: {
      km: +sum(spots.fast).toFixed(1),
      exposure: +((sum(spots.fast) * 1000) / route.summary.distance).toFixed(3),
      byRoad: byRoad(spots.fast),
      at: midOf(spots.fast),
    },
    lanesKm: Object.fromEntries(Object.entries(byLanes).map(([k, v]) => [k, +v.toFixed(1)])),
    speedKm: Object.fromEntries(Object.entries(bySpd).map(([k, v]) => [k, +v.toFixed(1)])),
  };

  const o = out[id];
  console.log(`\n=== ${id} (${priority}) ${o.distanceKm}km / ${o.durationMin}분 ===`);
  console.log(`좌표 ${o.vertexCount}개 → 표시용 ${o.path.length}개 | 매칭 ${o.matchedKm}km, 미매칭 ${o.unmatchedKm}km`);
  const pct = (x) => `${Math.round(x * 100)}%`;
  console.log(`급커브 ${o.sharpCurve.sections}구간 / ${o.sharpCurve.km}km · 굽은구간 ${o.sharpCurve.windingKm}km (노출 ${pct(o.sharpCurve.exposure)}, 최소 R=${o.sharpCurve.minRadiusM}m)`, o.sharpCurve.byRoad);
  console.log(`  최밀집: 5km 내 ${o.sharpCurve.densest?.count}개 @${o.sharpCurve.densest?.at}`);
  console.log(`차로수1&50↑: ${o.narrow.km}km (노출 ${pct(o.narrow.exposure)})`, o.narrow.byRoad);
  console.log(`제한속도80↑: ${o.highSpeed.km}km (노출 ${pct(o.highSpeed.exposure)})`, o.highSpeed.byRoad);
}

writeFileSync(`${DATA}route-data.json`, JSON.stringify(out, null, 1));
console.log(`\n→ data/route-data.json 저장`);
