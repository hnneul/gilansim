// 곡률 계산 자체 검증 — node --experimental-strip-types lib/curvature.check.ts
// score.check.ts와 같은 방식. 급커브 개수가 근거 카드에 그대로 나가므로 계산이 틀리면 안 된다.

import assert from "node:assert";
import { curveRadius, distance, sharpCurves, simplify, densestCluster, type LatLng } from "./curvature.ts";
import DATA from "../data/route-data.json" with { type: "json" };

// --- 거리 ---
// 제주 위도에서 위도 0.001도 ≈ 111m
assert.ok(Math.abs(distance([33.4, 126.5], [33.401, 126.5]) - 111) < 2);

// --- 곡선반경 ---
// 일직선은 급커브가 아니다. 부동소수점 잔차로 Infinity가 아닐 수 있어 크기만 본다.
assert.ok(curveRadius([33.4, 126.5], [33.401, 126.5], [33.402, 126.5]) > 1e6);

// 반지름 200m 원 위의 세 점을 만들면 200m가 나와야 한다
const R = 200;
const 원 = (deg: number): LatLng => [
  33.4 + (R * Math.sin((deg * Math.PI) / 180)) / 111_000,
  126.5 + (R * Math.cos((deg * Math.PI) / 180)) / (111_000 * Math.cos((33.4 * Math.PI) / 180)),
];
const r = curveRadius(원(0), 원(20), 원(40));
assert.ok(Math.abs(r - R) < R * 0.02, `외접원 반지름 오차 과대: ${r.toFixed(1)}m (기대 ${R}m)`);

// 반지름이 작을수록 급하다
assert.ok(curveRadius(원(0), 원(20), 원(40)) > 50);

// --- 급커브 탐지 ---
// 반지름 50m 원을 따라가는 경로는 전부 급커브지만, 연속이므로 한 구간으로 병합된다
const 급한원 = (deg: number): LatLng => [
  33.4 + (50 * Math.sin((deg * Math.PI) / 180)) / 111_000,
  126.5 + (50 * Math.cos((deg * Math.PI) / 180)) / (111_000 * Math.cos((33.4 * Math.PI) / 180)),
];
const 원호 = Array.from({ length: 12 }, (_, i) => 급한원(i * 15));
const 병합 = sharpCurves(원호);
assert.equal(병합.length, 1, `연속 급커브가 병합되지 않음: ${병합.length}개`);
assert.ok(병합[0].count > 5);
assert.ok(병합[0].minRadius < 100);

// 직선은 급커브가 없다
const 직선 = Array.from({ length: 20 }, (_, i): LatLng => [33.4 + i * 0.001, 126.5]);
assert.equal(sharpCurves(직선).length, 0);

// 제한속도 조건이 시내 교차로 회전을 걸러낸다
assert.equal(sharpCurves(원호, () => 30).length, 0, "저속 구간이 걸러지지 않음");
assert.equal(sharpCurves(원호, () => 60).length, 1);

// --- 축약 ---
const 축약 = simplify(직선);
assert.equal(축약.length, 2, "직선은 양 끝점만 남아야 한다");
assert.deepEqual(축약[0], 직선[0]);
assert.deepEqual(축약.at(-1), 직선.at(-1));
assert.ok(simplify(원호).length > 2, "곡선은 형태가 남아야 한다");

// --- 밀집도 ---
assert.equal(densestCluster([]), null);

// --- 실데이터 회귀 (data/route-data.json) ---
const { fast, safe } = DATA;

// 이 서비스의 핵심 주장: 최단거리 경로가 더 급커브가 많고, 더 오래 걸린다
assert.ok(
  fast.sharpCurve.sections > safe.sharpCurve.sections * 3,
  `급커브 차이가 사라졌다: fast ${fast.sharpCurve.sections} vs safe ${safe.sharpCurve.sections}`,
);
assert.ok(fast.durationMin > safe.durationMin, "최단거리 경로가 더 빨라졌다면 시나리오를 다시 봐야 한다");
assert.ok(fast.distanceKm < safe.distanceKm, "최단거리 경로가 더 짧아야 한다");

// 평화로 본선에는 급커브가 없다 — 발표에서 쓰는 사실.
// (byRoad는 JSON에서 온 리터럴 타입이라 tsc가 키 부재를 컴파일 타임에도 잡아준다)
assert.ok(!("평화로" in safe.sharpCurve.byRoad), "평화로 본선에 급커브가 잡혔다");
assert.ok(fast.sharpCurve.byRoad["516로"] >= 40);

// 고속주행은 평화로에만, 좁은 교행은 5.16도로에 몰려 있다
assert.equal(fast.highSpeed.km, 0, "5.16도로에 80km/h 구간이 생겼다");
assert.ok(safe.highSpeed.km > 20);
assert.ok(fast.narrow.km > safe.narrow.km * 5);

// 링크 매칭이 대부분 성공해야 수치를 믿을 수 있다
for (const [id, o] of Object.entries({ fast, safe }))
  assert.ok(o.matchedKm / (o.matchedKm + o.unmatchedKm) > 0.95, `${id} 링크 매칭률 미달`);

console.log(
  [
    `5.16도로 ${fast.distanceKm}km/${fast.durationMin}분 — 급커브 ${fast.sharpCurve.sections}구간, 좁은길 ${fast.narrow.km}km, 80↑ ${fast.highSpeed.km}km`,
    `평화로   ${safe.distanceKm}km/${safe.durationMin}분 — 급커브 ${safe.sharpCurve.sections}구간, 좁은길 ${safe.narrow.km}km, 80↑ ${safe.highSpeed.km}km`,
    "",
    "✅ 곡률 계산 + 실데이터 회귀 정상",
  ].join("\n"),
);
