// 목적지 주변 주차장 데이터 생성 — node --experimental-strip-types scripts/build-parking-data.mjs
//
// 출처: 공공데이터포털 「제주특별자치도 제주시/서귀포시 주차장정보」 2026-04-16
//       data/제주특별자치도_*_주차장정보_20260416.csv (원본 그대로 커밋)
//
// 왜 만드나 — 초보 운전자가 어려워하는 건 평행주차인데, 이 데이터셋에는 주차구획이
// 평행식인지 직각식인지 알려주는 컬럼이 없다. 대신 `주차장유형`을 프록시로 쓴다:
//   노상(도로 노면에 그린 구획)  → 연석 옆 평행주차일 확률이 높다
//   노외(도로 밖 전용 부지·주차빌딩) → 직각(수직)주차일 확률이 높다
// 프록시일 뿐 확정이 아니라서, 화면 문구도 "확률이 높다"로만 쓰고 출처에 프록시임을 밝힌다.
//
// 데이터로 확인한 프록시의 근거 (lib/parking.check.ts 가 재검증한다):
//   · 노상 643곳 중앙값 6면 / 72%가 10면 이하 — 도로변에 몇 칸 그린 형태
//   · 노외 1014곳 중앙값 16면 / 10면 이하는 29%
//   · 노상 이름 대부분이 "광양13길 21", "성지로 47" 같은 도로명+번지다
//
// 한계 — 서귀포시 데이터(113곳)는 전부 노외라 노상 표본이 아예 없다.
// 부설주차장도 이 데이터셋엔 없다(전부 공영). 즉 프록시는 사실상 제주시에서만 갈린다.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DATA = fileURLToPath(new URL("../data/", import.meta.url));

/** 도보로 갈 만한 거리. 이 밖은 "목적지 주차장"이라 부르기 어렵다. */
const WALK_M = 1000;

/** 목적지당 굳혀 둘 주차장 수 (카드 목록 + 미니 지도 마커). 가까운 순으로 자른다. */
const SPOT_CAP = 40;

// 목적지 좌표는 lib/scenario.ts 의 도착 마커와 같다.
// scenario.ts 를 직접 import 하지 않는 이유: 지도 컴포넌트를 함께 끌고 온다.
const DESTINATIONS = [
  { id: "seogwipo", label: "서귀포 매일올레시장", at: [33.2502, 126.5632] },
  { id: "seongsan", label: "성산일출봉", at: [33.4581, 126.9425] },
  { id: "hyeopjae", label: "협재해수욕장", at: [33.3943, 126.2397] },
];

const SOURCES = [
  "제주특별자치도_제주시_주차장정보_20260416.csv",
  "제주특별자치도_서귀포시_주차장정보_20260416.csv",
];

/** 따옴표 안의 쉼표를 살리는 최소 CSV 파서 — 특기사항 필드에 쉼표가 잔뜩 들어있다 */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const rad = (d) => (d * Math.PI) / 180;
/** 두 좌표 사이 미터. 제주 크기에선 평면 근사로 충분하다 (build-route-data.mjs 와 같은 방식) */
const meters = ([la1, lo1], [la2, lo2]) =>
  Math.hypot((la2 - la1), (lo2 - lo1) * Math.cos(rad(la1))) * rad(1) * 6371000;

const lots = SOURCES.flatMap((f) => parseCsv(readFileSync(`${DATA}${f}`, "utf8").replace(/^﻿/, "")));

// 통계 — 프록시의 근거를 숫자로 남긴다. 데이터가 갱신되면 이 숫자도 같이 갱신된다.
const spacesOf = (r) => (/^\d+$/.test(r.주차구획수?.trim() ?? "") ? +r.주차구획수 : null);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const stats = {};
for (const type of ["노상", "노외", "부설"]) {
  const n = lots.filter((r) => r.주차장유형 === type).map(spacesOf).filter((x) => x != null);
  if (n.length) stats[type] = { count: n.length, medianSpaces: median(n), under10Pct: Math.round((100 * n.filter((x) => x <= 10).length) / n.length) };
}

const out = { walkM: WALK_M, source: `공공데이터포털 제주시·서귀포시 주차장정보 (2026-04-16, ${lots.length}곳)`, stats, byDestination: {} };

for (const dest of DESTINATIONS) {
  const near = [];
  for (const r of lots) {
    const la = +r.위도, lo = +r.경도;
    if (!Number.isFinite(la) || !Number.isFinite(lo) || (la === 0 && lo === 0)) continue; // 위경도 결측 85곳
    const walkM = Math.round(meters(dest.at, [la, lo]));
    if (walkM > WALK_M) continue;
    near.push({
      name: r.주차장명.trim(),
      type: r.주차장유형, // 노상 / 노외 — 평행·직각 프록시
      spaces: spacesOf(r),
      fee: r.요금정보?.trim() || null, // 무료 / 유료 / 혼합
      walkM,
      at: [+la.toFixed(6), +lo.toFixed(6)],
    });
  }
  near.sort((a, b) => a.walkM - b.walkM);
  out.byDestination[dest.id] = {
    label: dest.label,
    at: dest.at,
    walkM: WALK_M,
    total: near.length,
    byType: near.reduce((o, s) => ({ ...o, [s.type]: (o[s.type] ?? 0) + 1 }), {}),
    // 판정(parallelOdds)은 near 전체 개수로 한다. spots 는 카드·미니 지도에 찍을 몫이라
    // 상한을 둔다 — 제주시 시내처럼 1km 안에 177곳인 목적지가 들어오면 번들이 커진다.
    spots: near.slice(0, SPOT_CAP),
  };
}

// 상한에 걸려 지도에서 빠진 곳이 있으면 조용히 넘기지 않는다
for (const [id, d] of Object.entries(out.byDestination))
  if (d.total > SPOT_CAP) console.warn(`  ! ${id}: ${d.total}곳 중 가까운 ${SPOT_CAP}곳만 저장 (지도에 ${d.total - SPOT_CAP}곳 안 찍힘)`);

writeFileSync(`${DATA}parking-data.json`, JSON.stringify(out, null, 1));
console.log(`주차장 ${lots.length}곳 → data/parking-data.json`);
for (const [id, d] of Object.entries(out.byDestination))
  console.log(`  ${id.padEnd(9)} ${d.label} ${WALK_M}m 내 ${String(d.total).padStart(3)}곳`, d.byType);
console.log("  유형별 구획수:", stats);
