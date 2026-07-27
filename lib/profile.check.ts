// 프로필 URL 변환 검증 — node --experimental-strip-types lib/profile.check.ts
// URL은 사용자가 고칠 수 있는 입력이다. 여기가 새면 점수가 조용히 틀린 프로필로 계산된다.

import assert from "node:assert";
import { parseProfile, toQuery, DEFAULT_PROFILE, OPTIONS } from "./profile.ts";

/** toQuery 결과를 다시 parseProfile 입력 형태로 되돌린다 */
const roundTrip = (q: string) => parseProfile(Object.fromEntries(new URLSearchParams(q)));

// --- 왕복 ---
// 모든 선택지 조합이 왕복을 견딘다 — 하나라도 새면 그 조합의 점수가 틀린다
for (const exp of OPTIONS.experienceYears)
  for (const freq of OPTIONS.drivingFrequency)
    for (const car of OPTIONS.vehicleSize)
      for (const time of OPTIONS.timeOfDay)
        for (const jeju of [true, false]) {
          const p = { experienceYears: exp, drivingFrequency: freq, jejuExperience: jeju, vehicleSize: car, timeOfDay: time };
          assert.deepEqual(roundTrip(toQuery(p, "x")), p);
        }

// 구간 id도 실려야 한다
assert.equal(new URLSearchParams(toQuery(DEFAULT_PROFILE, "hyeopjae")).get("route"), "hyeopjae");

// --- 검증 (신뢰 경계) ---
// 빈 쿼리는 기본 프로필
assert.deepEqual(parseProfile({}), DEFAULT_PROFILE);

// 허용 목록 밖의 값은 기본값으로 되돌린다 — 부담을 낮추는 쪽으로 새면 안 된다
assert.equal(parseProfile({ exp: "99" }).experienceYears, DEFAULT_PROFILE.experienceYears);
assert.equal(parseProfile({ exp: "0" }).experienceYears, DEFAULT_PROFILE.experienceYears);
assert.equal(parseProfile({ exp: "abc" }).experienceYears, DEFAULT_PROFILE.experienceYears);
assert.equal(parseProfile({ freq: "never" }).drivingFrequency, DEFAULT_PROFILE.drivingFrequency);
assert.equal(parseProfile({ car: "truck" }).vehicleSize, DEFAULT_PROFILE.vehicleSize);
assert.equal(parseProfile({ time: "dawn" }).timeOfDay, DEFAULT_PROFILE.timeOfDay);

// jeju는 "true"만 참 — 오타가 "경험 있음"으로 새면 가중치 ×1.2가 빠져 부담이 과소 계상된다
assert.equal(parseProfile({ jeju: "true" }).jejuExperience, true);
assert.equal(parseProfile({ jeju: "1" }).jejuExperience, false);
assert.equal(parseProfile({ jeju: "TRUE" }).jejuExperience, false);
assert.equal(parseProfile({}).jejuExperience, false);

// 같은 키가 여러 번 오면 첫 값을 쓴다 (?exp=1&exp=10)
assert.equal(parseProfile({ exp: ["10", "1"] }).experienceYears, 10);
assert.equal(parseProfile({ exp: ["bad", "10"] }).experienceYears, DEFAULT_PROFILE.experienceYears);

console.log("✅ 프로필 URL 왕복 + 입력 검증 정상");
