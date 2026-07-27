// 실시간 교통 집계 검증 — node --experimental-strip-types lib/traffic.check.ts
//
// 네트워크를 타지 않는다. 검증할 게 카카오 응답을 받아오는 일이 아니라,
// 받은 응답을 어떻게 읽느냐이기 때문이다:
//   ① 혼잡 상태 코드를 거리로 옳게 합치는가 (원활·정보없음을 혼잡으로 세면 없는 정체를 만든다)
//   ② 실시간 안내가 검증된 경로를 벗어났는지 판정하는가 (벗어난 걸 놓치면 다른 길의
//      급커브를 이 길의 근거로 보여주게 된다)
//
// 픽스처의 traffic_state 값은 실제 응답에서 확인한 것이다 (lib/traffic.ts 주석 참고).

import assert from "node:assert";
import { congestionOf, congestionLabel, driftedFrom } from "./traffic.ts";

const road = (name: string, km: number, traffic_state?: number) => ({
  name,
  distance: km * 1000,
  traffic_state,
});

// --- ① 혼잡 집계 ---

// 원활(4)·정보없음(0)·상태 누락은 혼잡이 아니다
assert.deepEqual(congestionOf([road("평화로", 50, 4), road("공항로", 1, 0), road("무명", 1)]), {
  jamKm: 0,
  slowKm: 0,
  topRoad: null,
});

// 정체(1)·지체(2)는 jam, 서행(3)은 slow — 같은 도로 조각들은 합산된다
assert.deepEqual(
  congestionOf([road("평화로", 1.5, 1), road("평화로", 0.5, 2), road("평화로", 2, 3), road("중산간서로", 1, 4)]),
  { jamKm: 2, slowKm: 2, topRoad: "평화로" },
);

// topRoad 는 막히는 거리가 가장 긴 도로다 — 조각 수가 아니라 거리로 뽑는다
assert.equal(
  congestionOf([road("516로", 0.2, 3), road("516로", 0.2, 3), road("한북로", 3, 3)]).topRoad,
  "한북로",
);

// 이름 없는 조각만 막혀도 거리는 세고, 도로명만 비운다
assert.deepEqual(congestionOf([road("", 2, 1)]), { jamKm: 2, slowKm: 0, topRoad: null });

// --- ② 카드 문구 ---

// 1km 미만은 말하지 않는다 (신호 대기로도 잡히는 길이)
assert.equal(congestionLabel({ jamKm: 0.4, slowKm: 0.9, topRoad: "평화로" }), null);
// 정체가 서행보다 크면 정체를 말한다
assert.equal(congestionLabel({ jamKm: 2.1, slowKm: 1.2, topRoad: "평화로" }), "평화로 2.1km 정체");
// 서행이 더 크면 서행 쪽 거리를 말한다 — jamKm 을 섞어 부풀리지 않는다
assert.equal(congestionLabel({ jamKm: 0.5, slowKm: 4.2, topRoad: "516로" }), "516로 4.2km 서행");
// 도로명을 못 얻어도 거리는 알려준다
assert.equal(congestionLabel({ jamKm: 3, slowKm: 0, topRoad: null }), "3km 정체");

// --- ③ 경로 이탈 판정 ---

assert.equal(driftedFrom(43.0, 43.0), false); // 같은 길
assert.equal(driftedFrom(44.8, 43.0), false); // +4.2% — 실시간 경로가 조금 다른 건 늘 있다
assert.equal(driftedFrom(45.5, 43.0), true); // +5.8% — 다른 길로 안내됐다
assert.equal(driftedFrom(38.0, 43.0), true); // 짧아진 것도 이탈이다 (방향은 상관없다)
assert.equal(driftedFrom(43.0, null), false); // 비교 대상이 없으면 판정하지 않는다

console.log("✅ 실시간 교통 집계·이탈 판정 정상");
console.log("   혼잡 코드: 1·2 → 정체, 3 → 서행, 4·0·누락 → 세지 않음");
console.log(`   이탈 임계: 검증 거리와 5% 초과 차이`);
