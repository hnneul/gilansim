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

/** 카드 목록·미니 지도에 찍을 최대 개수. 판정은 전체 개수로 하고 표시만 자른다. */
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

// 목적지별로 미리 잘라두지 않는다 — 임의 목적지를 받으므로 그 목록을 만들 수가 없다.
// 전체를 좌표째로 굳혀두고 거리 필터는 런타임이 한다 (lib/parking.ts nearbyParking).
// 1,657곳에서 좌표 결측을 뺀 전량이 약 150KB라 번들에 지고 갈 만하다.
const spots = [];
for (const r of lots) {
  const la = +r.위도, lo = +r.경도;
  if (!Number.isFinite(la) || !Number.isFinite(lo) || (la === 0 && lo === 0)) continue; // 위경도 결측 85곳
  spots.push({
    name: r.주차장명.trim(),
    type: r.주차장유형, // 노상 / 노외 — 평행·직각 프록시
    spaces: spacesOf(r),
    fee: r.요금정보?.trim() || null, // 무료 / 유료 / 혼합
    at: [+la.toFixed(6), +lo.toFixed(6)],
  });
}

const out = {
  walkM: WALK_M,
  source: `공공데이터포털 제주시·서귀포시 주차장정보 (2026-04-16, ${lots.length}곳)`,
  stats,
  spots,
};

writeFileSync(`${DATA}parking-data.json`, JSON.stringify(out));
console.log(`주차장 ${lots.length}곳 중 좌표 있는 ${spots.length}곳 → data/parking-data.json`);
console.log("  유형별 구획수:", stats);

// 굳혀둔 3구간이 몇 곳으로 잡히는지는 찍어 둔다 — 데이터가 갱신되면 여기서 먼저 보인다
for (const dest of DESTINATIONS) {
  const near = spots.filter((s) => meters(dest.at, s.at) <= WALK_M);
  const byType = near.reduce((o, s) => ({ ...o, [s.type]: (o[s.type] ?? 0) + 1 }), {});
  console.log(`  ${dest.id.padEnd(9)} ${dest.label} ${WALK_M}m 내 ${String(near.length).padStart(3)}곳`, byType);
}
