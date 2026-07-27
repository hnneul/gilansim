// 표준노드링크 슬림본 생성 — node scripts/build-link-data.mjs
//
// 왜 필요한가: 임의 구간을 받으려면 요청 때마다 경로를 분석해야 하고, 그러려면 링크
// 데이터가 배포에 올라가야 한다. 원본 jeju_link.geojson 은 24MB이고 gitignore 대상이다
// (전국 257MB zip 에서 잘라낸 중간 산출물). 필요한 속성만 남기면 5.9MB 로 줄어 커밋할 만하다.
//
// 남기는 속성 (lib/analyze.ts 가 쓰는 것 전부):
//   LANES → l   차로수      (좁은 교행 판정)
//   MAX_SPD → s 제한속도    (급커브 임계값·고속주행 판정·램프 제외)
//   ROAD_NAME → n 도로명    (근거 카드의 "위치")
//   coordinates → c         (좌표열, GeoJSON 순서 [경도, 위도] 그대로)
//
// 버리는 것: LINK_ID·F_NODE·T_NODE·ROAD_RANK 등 17개 속성. 화면에 안 쓴다.
// 좌표는 소수점 5자리(약 1m)로 자른다 — 40m 매칭에 그보다 정밀할 이유가 없다.
//
// 선행 준비 (원본 GeoJSON, 1회):
//   Z="/vsizip/<경로>/[2026-07-16]NODELINKDATA.zip/[2026-07-16]NODELINKDATA"
//   SHAPE_ENCODING=CP949 ogr2ogr -f GeoJSON -t_srs EPSG:4326 \
//     -spat 126.14 33.10 126.98 33.60 -spat_srs EPSG:4326 data/jeju_link.geojson "$Z/MOCT_LINK.shp"

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DATA = fileURLToPath(new URL("../data/", import.meta.url));
const SRC = `${DATA}jeju_link.geojson`;
const OUT = `${DATA}jeju-link.json`;

/**
 * 좌표 정밀도. 원본은 소수 14자리이고 그대로 두면 9.8MB다.
 *
 * 손으로 고른 값이 아니라 재현 실험으로 정했다 — lib/analyze.check.ts 가 굳혀둔
 * route-data.json 을 그대로 재현하는지 자리수를 바꿔가며 확인했다:
 *   12자리 8.9MB ✅ · 8자리 7.2MB ✅ · **7자리 6.8MB ✅** · 6자리 6.4MB ❌
 * 6자리에서 safe 의 "차로수 1 구간"이 1.8km → 1.9km 로 어긋난다. 링크 매칭이 40m
 * 임계값을 쓰므로 경계에 있는 좌표 하나가 다른 링크에 붙으면 집계가 바뀐다.
 * 0.1km 차이지만 근거 카드에 그대로 찍히는 숫자라 정밀도를 아끼지 않는다.
 */
const DIGITS = 7;

const features = JSON.parse(readFileSync(SRC, "utf8")).features;

const links = [];
let 점 = 0;
for (const f of features) {
  const cs = f.geometry?.coordinates;
  if (!cs?.length) continue;
  const p = f.properties;
  점 += cs.length;
  links.push({
    l: Number.isFinite(p.LANES) ? p.LANES : null,
    s: Number.isFinite(p.MAX_SPD) ? p.MAX_SPD : null,
    n: p.ROAD_NAME?.trim() || null,
    c: cs.map(([lo, la]) => [+lo.toFixed(DIGITS), +la.toFixed(DIGITS)]),
  });
}

writeFileSync(OUT, JSON.stringify(links));

const mb = (p) => (statSync(p).size / 1e6).toFixed(1);
console.log(`링크 ${links.length}개 / 좌표 ${점}개`);
console.log(`  ${SRC.split("/").pop()} ${mb(SRC)}MB → ${OUT.split("/").pop()} ${mb(OUT)}MB`);

// 커버리지를 찍어 둔다 — 임의 구간을 받으려면 섬 전체가 들어와 있어야 한다.
// 좌표가 21만 개라 Math.min(...배열) 은 스택을 넘긴다. 한 번 훑는다.
const bbox = { loMin: Infinity, loMax: -Infinity, laMin: Infinity, laMax: -Infinity };
for (const x of links)
  for (const [lo, la] of x.c) {
    if (lo < bbox.loMin) bbox.loMin = lo;
    if (lo > bbox.loMax) bbox.loMax = lo;
    if (la < bbox.laMin) bbox.laMin = la;
    if (la > bbox.laMax) bbox.laMax = la;
  }
const r = (n) => n.toFixed(3);
console.log(`  범위: 경도 ${r(bbox.loMin)}~${r(bbox.loMax)} · 위도 ${r(bbox.laMin)}~${r(bbox.laMax)}`);

// 속성 결측은 분석 품질에 직접 영향을 준다 (미매칭이 아니라 "매칭됐지만 값이 없음")
const 결측 = (k) => links.filter((x) => x[k] == null).length;
console.log(`  결측: 차로수 ${결측("l")}개 · 제한속도 ${결측("s")}개 · 도로명 ${결측("n")}개`);
