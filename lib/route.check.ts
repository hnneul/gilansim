// 임의 구간 판정 검증 — node --experimental-strip-types lib/route.check.ts
//
// 네트워크를 타지 않는다. 굳혀둔 응답(data/route-*.json)을 분석해 두 가지를 본다:
//   ① 경로 이름을 지명 하드코딩 없이 도로명 데이터에서 옳게 뽑는가
//   ② 두 경로가 사실상 같은 길인지 판정하는가 (계획서 Core 기준 5)
//
// ②가 새면 짧은 구간에서 없는 선택지를 두 장의 카드로 만든다 — 최단거리와 최단시간이
// 같은 길로 수렴하는 구간이 실제로 있다 (공항→제주시청 실측 4,918m vs 5,342m).
//
// 원본 응답은 gitignore 대상이라 없을 수 있다. 그때는 건너뛴다.

import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze, buildIndex, type Analysis, type Link } from "./analyze.ts";
import { nameOf, sameRoute, risksOf } from "./route.ts";

const DATA = fileURLToPath(new URL("../data/", import.meta.url));
const 있나 = (f: string) => existsSync(`${DATA}${f}`);

if (!있나("jeju-link.json") || !있나("route-DISTANCE.json") || !있나("route-TIME.json")) {
  console.log("⏭  링크 또는 원본 응답 없음 — 건너뜀 (node scripts/build-link-data.mjs)");
  process.exit(0);
}

const index = buildIndex(JSON.parse(readFileSync(`${DATA}jeju-link.json`, "utf8")) as Link[]);
const 분석 = (p: string) => analyze(JSON.parse(readFileSync(`${DATA}route-${p}.json`, "utf8")).routes[0], index);
const fast = 분석("DISTANCE");
const safe = 분석("TIME");

// --- ① 경로 이름 ---
// 공항→올레시장은 5.16도로와 평화로로 갈린다. 표준노드링크의 도로명이 "516로"·"평화로"다.
assert.equal(nameOf(fast, safe), "516로 경유", `fast 이름: ${nameOf(fast, safe)}`);
assert.equal(nameOf(safe, fast), "평화로 경유", `safe 이름: ${nameOf(safe, fast)}`);
// 상대가 없으면 가장 긴 도로를 쓴다
assert.equal(nameOf(fast), "516로 경유");
// "(무명)" 은 이름으로 쓰지 않는다 — 화면에 "(무명) 경유"가 찍히면 안 된다
const 무명뿐: Analysis = { ...fast, roadKm: { "(무명)": 12 } };
assert.equal(nameOf(무명뿐), "경로", "무명뿐일 때 대비가 없다");

// --- ② 같은 길 판정 ---
assert.equal(sameRoute(fast, safe), false, "5.16도로와 평화로를 같은 길로 봤다");
assert.equal(sameRoute(fast, fast), true, "자기 자신을 다른 길로 봤다");

// 거리가 같아도 도로 구성이 다르면 다른 길이다
const 거리같고도로다름: Analysis = { ...safe, distanceKm: fast.distanceKm };
assert.equal(sameRoute(fast, 거리같고도로다름), false, "거리가 같아도 도로가 다르면 다른 길이다");

// 도로 구성이 같으면 거리가 얼마나 달라도 같은 길이다.
// 실측 근거: 공항→제주시청이 4.9km vs 5.3km(8% 차이)인데 둘 다 서광로였다.
// 거리 조건을 두면 저기서 두 장의 카드가 똑같이 "서광로 경유"로 뜬다.
for (const 배수 of [1.02, 1.08, 1.2]) {
  const 같은길: Analysis = { ...fast, distanceKm: +(fast.distanceKm * 배수).toFixed(1) };
  assert.equal(sameRoute(fast, 같은길), true, `${배수}배 거리차를 다른 길로 봤다`);
}

// --- ③ 위험요인 조립 ---
const risks = risksOf(fast);
assert.ok(risks.length >= 2, `요인이 2개 이상이어야 한다 (완료 기준): ${risks.length}개`);
for (const r of risks) {
  assert.ok(r.location && r.location !== "-", `위치가 비었다: ${r.label}`);
  assert.ok(r.value.trim(), `수치가 비었다: ${r.label}`);
  assert.ok(r.source.trim(), `출처가 비었다: ${r.label}`);
  assert.ok(r.exposure > 0, `노출이 0이다: ${r.label}`);
  assert.ok(!r.location.includes("(무명)"), `무명 도로가 위치에 노출됐다: ${r.location}`);
}

// 값이 0인 요인은 아예 넣지 않는다 — "0km 구간이 있습니다"는 근거가 아니다
const 고속없음: Analysis = { ...fast, highSpeed: { km: 0, exposure: 0, byRoad: {}, at: null } };
assert.ok(!risksOf(고속없음).some((r) => r.type === "highSpeed"), "0km 요인을 넣었다");

console.log("✅ 경로 이름·같은 길 판정·위험요인 조립 정상");
console.log(`   ${nameOf(fast, safe)} ${fast.distanceKm}km / 요인 ${risksOf(fast).length}개`);
console.log(`   ${nameOf(safe, fast)} ${safe.distanceKm}km / 요인 ${risksOf(safe).length}개`);
