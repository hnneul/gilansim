// 프로필 ↔ URL 쿼리 변환. 입력 페이지(/)와 결과 페이지(/result)가 공유한다.
//
// 프로필을 URL에 담는 이유: 결과 링크를 그대로 공유·재현할 수 있고, 새로고침에도
// 안 날아간다. 대신 URL은 사용자가 손으로 고칠 수 있는 입력이므로 값 검증이 필수다 —
// 여기가 유일한 신뢰 경계다.

import type { DriverProfile } from "./score";
import type { LatLng } from "@/app/RouteMap";

/**
 * 값이 없거나 URL이 망가졌을 때 되돌아갈 프로필.
 * 부담이 가장 큰 쪽(초보·저빈도·경차)으로 잡는다 — 모르는 값을 "익숙한 운전자"로 가정하면
 * 가중치가 빠져 위험이 과소 계상된다. 안전은 보수적인 쪽으로 틀리는 게 맞다.
 */
export const DEFAULT_PROFILE: DriverProfile = {
  experienceYears: 1,
  drivingFrequency: "low",
  jejuExperience: false,
  vehicleSize: "compact",
  timeOfDay: "day",
};

/** 폼 선택지 = 허용값. 화면에 없는 값이 URL로 들어오면 받지 않는다. */
export const OPTIONS = {
  experienceYears: [1, 3, 10],
  drivingFrequency: ["low", "medium", "high"],
  vehicleSize: ["compact", "sedan", "suv"],
  timeOfDay: ["day", "night"],
} as const;

/**
 * 값 → 화면에 쓰는 말. 결과의 프로필 메뉴(app/ProfileMenu.tsx)가 URL에서 읽은 값을 되읽어 준다.
 * ponytail: 입력 폼 칩(app/page.tsx)이 같은 문구를 따로 들고 있다 — 문구를 고칠 일이 생기면 칩도 여기로 옮긴다.
 */
export const LABELS = {
  drivingFrequency: { low: "거의 안 함", medium: "가끔", high: "자주" },
  vehicleSize: { compact: "경차", sedan: "중형", suv: "대형" },
  timeOfDay: { day: "주간", night: "야간" },
};

/** ?key=value&key=value 형태에서 같은 키가 여러 번 오면 첫 값을 쓴다. 결과 페이지도 같은 규칙을 쓴다. */
export const oneOf = (sp: Record<string, string | string[] | undefined>, k: string) =>
  Array.isArray(sp[k]) ? sp[k][0] : sp[k];

/** URL 쿼리 → 프로필. 값이 없거나 허용 목록 밖이면 기본값으로 되돌린다. */
export function parseProfile(sp: Record<string, string | string[] | undefined>): DriverProfile {
  const pick = <T extends readonly (string | number)[]>(k: string, allowed: T, fallback: unknown) => {
    const raw = oneOf(sp, k);
    const v = typeof allowed[0] === "number" ? Number(raw) : raw;
    return ((allowed as readonly unknown[]).includes(v) ? v : fallback) as T[number];
  };

  return {
    experienceYears: pick("exp", OPTIONS.experienceYears, DEFAULT_PROFILE.experienceYears),
    drivingFrequency: pick("freq", OPTIONS.drivingFrequency, DEFAULT_PROFILE.drivingFrequency),
    // 불리언은 "true"만 참으로 본다 — 오타가 "경험 있음"으로 새면 부담을 과소 계상한다
    jejuExperience: oneOf(sp, "jeju") === "true",
    vehicleSize: pick("car", OPTIONS.vehicleSize, DEFAULT_PROFILE.vehicleSize),
    timeOfDay: pick("time", OPTIONS.timeOfDay, DEFAULT_PROFILE.timeOfDay),
  };
}

const profileParams = (profile: DriverProfile) => ({
  exp: String(profile.experienceYears),
  freq: profile.drivingFrequency,
  jeju: String(profile.jejuExperience),
  car: profile.vehicleSize,
  time: profile.timeOfDay,
});

/** 프로필 + 구간 → "?exp=1&freq=low&..." */
export function toQuery(profile: DriverProfile, scenarioId: string): string {
  return `?${new URLSearchParams({ route: scenarioId, ...profileParams(profile) })}`;
}

/**
 * 프로필 + 출발지 + 목적지 텍스트 → "?originLat=..&originLng=..&dest=..&exp=1&...". 임의 구간용.
 * 출발지는 GPS 좌표(LatLng) 또는 직접 입력한 지명(string) 둘 다 받는다 — "제주공항"처럼
 * 특정 구간을 재현하려면 GPS 대신 텍스트로 고정할 수 있어야 한다.
 */
export function toCustomQuery(profile: DriverProfile, origin: LatLng | string, destination: string): string {
  const originParams: Record<string, string> =
    typeof origin === "string"
      ? { originText: origin }
      : { originLat: String(origin[0]), originLng: String(origin[1]) };
  return `?${new URLSearchParams({ ...originParams, dest: destination, ...profileParams(profile) })}`;
}
