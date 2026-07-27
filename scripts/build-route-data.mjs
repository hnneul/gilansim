// 경로 데이터 생성 — node scripts/build-route-data.mjs
//
// 굳혀둔 3구간의 **폴백 데이터**를 만든다. 화면은 이제 요청 때마다 임의 구간을 분석하지만
// (lib/route.ts), 길찾기 API가 죽거나 한도에 걸리면 이 파일로 떨어진다.
// 분석 자체는 lib/analyze.ts 가 한다 — 스크립트와 런타임이 같은 함수를 써야
// 같은 경로에 같은 숫자가 나온다. lib/analyze.check.ts 가 그걸 검증한다.
//
// 이 파일이 하는 일은 세 가지뿐이다:
//   ① 카카오 길찾기 호출 (priority=DISTANCE/TIME, 출발시각 고정)
//   ② lib/analyze.ts 로 분석
//   ③ 최밀집 지점 좌표 → 행정구역명 변환 (analyze 는 API를 부르지 않는 순수 함수라 여기서 붙인다)
//
// 선행 준비: node scripts/build-link-data.mjs (data/jeju-link.json)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze, buildIndex } from "../lib/analyze.ts";

// 프로젝트 경로에 한글이 있어 URL.pathname은 못 쓴다 (퍼센트 인코딩이 남는다)
const DATA = fileURLToPath(new URL("../data/", import.meta.url));
const ENV = fileURLToPath(new URL("../.env.local", import.meta.url));

const 공항 = "126.493,33.507";
// 카카오 로컬 API 키워드 검색 ("서귀포 매일올레시장", 서귀포시 중앙로62번길 18)
const 올레시장 = "126.5632,33.2502";
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
    destination: 올레시장,
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

/**
 * 좌표 → 행정구역명. 근거 카드의 "위치"를 지명으로 쓰려면 필요하다.
 * 지명을 손으로 적으면 데이터가 바뀔 때 조용히 틀린 말이 된다 — 실제로 한 번 그랬다.
 *
 * 이 API는 한 좌표에 **두 개**를 돌려준다: region_type "B"(법정동), "H"(행정동).
 * documents[0] 을 쓰면 순서에 따라 지명이 바뀐다 — 같은 좌표에 "제주시 노형동"과
 * "제주시 연동"이 번갈아 나와서 재빌드마다 근거 카드의 지명이 흔들렸다.
 * 법정동(B)으로 고정한다: 주소에 쓰는 이름이고, 같은 카드의 도로명(노형로)과도 맞는다.
 */
async function regionOf([la, lo]) {
  if (!KEY) return null;
  const res = await fetch(
    `https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${lo}&y=${la}`,
    { headers: { Authorization: `KakaoAK ${KEY}` } },
  );
  if (!res.ok) return null;
  const docs = (await res.json()).documents ?? [];
  const doc = docs.find((d) => d.region_type === "B") ?? docs[0];
  // "제주특별자치도 서귀포시 남원읍 하례리" → "서귀포시 남원읍 하례리"
  return doc ? doc.address_name.replace(/^제주특별자치도\s*/, "") : null;
}

const index = buildIndex(JSON.parse(readFileSync(`${DATA}jeju-link.json`, "utf8")));

const out = {};
for (const [id, priority] of [["fast", "DISTANCE"], ["safe", "TIME"]]) {
  const route = (await directions(priority)).routes[0];
  if (route.result_code !== 0) throw new Error(`${priority}: ${route.result_msg}`);

  const a = analyze(route, index);
  out[id] = {
    priority,
    ...a,
    sharpCurve: {
      ...a.sharpCurve,
      densest: a.sharpCurve.densest && {
        ...a.sharpCurve.densest,
        region: await regionOf(a.sharpCurve.densest.at),
      },
    },
  };

  const o = out[id];
  const pct = (x) => `${Math.round(x * 100)}%`;
  console.log(`\n=== ${id} (${priority}) ${o.distanceKm}km / ${o.durationMin}분 ===`);
  console.log(`좌표 ${o.vertexCount}개 → 표시용 ${o.path.length}개 | 매칭 ${o.matchedKm}km, 미매칭 ${o.unmatchedKm}km`);
  console.log(`급커브 ${o.sharpCurve.sections}구간 / ${o.sharpCurve.km}km · 굽은구간 ${o.sharpCurve.windingKm}km (노출 ${pct(o.sharpCurve.exposure)}, 최소 R=${o.sharpCurve.minRadiusM}m)`, o.sharpCurve.byRoad);
  console.log(`  최밀집: 5km 내 ${o.sharpCurve.densest?.count}개 @${o.sharpCurve.densest?.at} (${o.sharpCurve.densest?.region})`);
  console.log(`차로수1&50↑: ${o.narrow.km}km (노출 ${pct(o.narrow.exposure)})`, o.narrow.byRoad);
  console.log(`제한속도80↑: ${o.highSpeed.km}km (노출 ${pct(o.highSpeed.exposure)})`, o.highSpeed.byRoad);
}

writeFileSync(`${DATA}route-data.json`, JSON.stringify(out, null, 1));
console.log(`\n→ data/route-data.json 저장`);
