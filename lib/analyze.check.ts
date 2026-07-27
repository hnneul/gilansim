// 분석부 검증 — node --experimental-strip-types lib/analyze.check.ts
//
// 이 파일이 하는 일은 하나다: **lib/analyze.ts 가 이미 커밋된 data/route-data.json 을
// 그대로 재현하는지** 본다.
//
// 왜 이게 중요한가: 저 JSON은 원래 scripts/build-route-data.mjs 안의 코드가 만든 값이고,
// 화면의 근거 카드가 지금 그 숫자를 쓰고 있다. 임의 구간을 받으려고 분석부를 런타임으로
// 옮기면서 숫자가 한 자리라도 달라지면, 화면이 어제와 다른 근거를 말하게 된다.
// 추출이 리팩터링인지 사고인지 여기서 갈린다.
//
// 원본 응답(data/route-*.json)은 gitignore 대상이라 없을 수 있다. 그때는 건너뛴다 —
// 없는 파일로 실패시키면 "돌리면 늘 빨간불"이 되어 검증을 아무도 안 보게 된다.

import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze, buildIndex, type Link } from "./analyze.ts";

const DATA = fileURLToPath(new URL("../data/", import.meta.url));
const 원본 = (p: string) => `${DATA}route-${p}.json`;

if (!existsSync(`${DATA}jeju-link.json`)) {
  console.log("⏭  data/jeju-link.json 없음 — node scripts/build-link-data.mjs 먼저");
  process.exit(0);
}
if (!existsSync(원본("DISTANCE")) || !existsSync(원본("TIME"))) {
  console.log("⏭  data/route-{DISTANCE,TIME}.json 없음 (gitignore 대상) — 재현 검증 건너뜀");
  process.exit(0);
}

const t0 = Date.now();
const links: Link[] = JSON.parse(readFileSync(`${DATA}jeju-link.json`, "utf8"));
const 파싱 = Date.now() - t0;

const t1 = Date.now();
const index = buildIndex(links);
const 인덱스 = Date.now() - t1;

const 기존 = JSON.parse(readFileSync(`${DATA}route-data.json`, "utf8"));

/** 재현돼야 하는 필드. 화면(lib/scenario.ts)이 실제로 읽는 것만 고른다. */
const 필드 = [
  "distanceKm", "durationMin", "matchedKm", "unmatchedKm",
  "sharpCurve.sections", "sharpCurve.km", "sharpCurve.windingKm", "sharpCurve.windingSections",
  "sharpCurve.exposure", "sharpCurve.perKm", "sharpCurve.minRadiusM",
  "narrow.km", "narrow.exposure", "highSpeed.km", "highSpeed.exposure",
] as const;

const 파고들기 = (o: unknown, path: string) =>
  path.split(".").reduce<unknown>((v, k) => (v as Record<string, unknown>)?.[k], o);

let 걸린시간 = 0;
for (const [id, priority] of [["fast", "DISTANCE"], ["safe", "TIME"]] as const) {
  const route = JSON.parse(readFileSync(원본(priority), "utf8")).routes[0];

  const t = Date.now();
  const 새것 = analyze(route, index);
  const ms = Date.now() - t;
  걸린시간 += ms;

  const 옛것 = 기존[id];
  for (const f of 필드)
    assert.deepEqual(
      파고들기(새것, f), 파고들기(옛것, f),
      `${id}.${f} 가 달라졌다: ${파고들기(옛것, f)} → ${파고들기(새것, f)}`,
    );

  // 도로별 집계와 대표 좌표도 같아야 한다 — 근거 카드의 "위치"가 여기서 나온다
  assert.deepEqual(새것.sharpCurve.byRoad, 옛것.sharpCurve.byRoad, `${id} 급커브 도로별 집계 불일치`);
  assert.deepEqual(새것.narrow.byRoad, 옛것.narrow.byRoad, `${id} 좁은 교행 도로별 집계 불일치`);
  assert.deepEqual(새것.highSpeed.byRoad, 옛것.highSpeed.byRoad, `${id} 고속주행 도로별 집계 불일치`);
  assert.deepEqual(새것.narrow.at, 옛것.narrow.at, `${id} 좁은 교행 대표 좌표 불일치`);
  assert.deepEqual(새것.highSpeed.at, 옛것.highSpeed.at, `${id} 고속주행 대표 좌표 불일치`);
  assert.deepEqual(새것.sharpCurve.densest?.at, 옛것.sharpCurve.densest?.at, `${id} 최밀집 좌표 불일치`);
  assert.equal(새것.sharpCurve.densest?.count, 옛것.sharpCurve.densest?.count, `${id} 최밀집 개수 불일치`);

  // 지도에 그리는 좌표열도 같아야 한다 (축약 알고리즘까지 포함해)
  assert.equal(새것.path.length, 옛것.path.length, `${id} 표시용 좌표 수 불일치`);

  console.log(
    `  ${id.padEnd(5)} ${새것.distanceKm}km / ${새것.durationMin}분 · 급커브 ${새것.sharpCurve.sections}구간 · ${ms}ms`,
  );
}

console.log("✅ 런타임 분석이 굳혀둔 route-data.json 을 그대로 재현한다");
console.log(`   링크 ${links.length}개 파싱 ${파싱}ms · 격자 인덱스 ${인덱스}ms · 경로 2개 분석 ${걸린시간}ms`);
