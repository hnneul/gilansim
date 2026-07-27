// 프로필 ↔ URL 쿼리 변환. 입력 페이지(/)와 결과 페이지(/result)가 공유한다.
//
// 프로필을 URL에 담는 이유: 결과 링크를 그대로 공유·재현할 수 있고, 새로고침에도
// 안 날아간다. 대신 URL은 사용자가 손으로 고칠 수 있는 입력이므로 값 검증이 필수다 —
// 여기가 유일한 신뢰 경계다.

import type { DriverProfile } from "./score";

export const PRESETS = {
  초보: {
    label: "초보 운전자",
    sub: "경력 1년 · 저빈도 · 경차",
    profile: {
      experienceYears: 1,
      drivingFrequency: "low",
      jejuExperience: false,
      vehicleSize: "compact",
      timeOfDay: "day",
    } satisfies DriverProfile,
  },
  베테랑: {
    label: "베테랑",
    sub: "경력 10년 · 자주 운전 · 중형",
    profile: {
      experienceYears: 10,
      drivingFrequency: "high",
      jejuExperience: true,
      vehicleSize: "sedan",
      timeOfDay: "day",
    } satisfies DriverProfile,
  },
} as const;

export const DEFAULT_PROFILE = PRESETS.초보.profile;

/** 폼 선택지 = 허용값. 화면에 없는 값이 URL로 들어오면 받지 않는다. */
export const OPTIONS = {
  experienceYears: [1, 3, 10],
  drivingFrequency: ["low", "medium", "high"],
  vehicleSize: ["compact", "sedan", "suv"],
  timeOfDay: ["day", "night"],
} as const;

/** URL 쿼리 → 프로필. 값이 없거나 허용 목록 밖이면 기본값으로 되돌린다. */
export function parseProfile(sp: Record<string, string | string[] | undefined>): DriverProfile {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]);
  const pick = <T extends readonly (string | number)[]>(k: string, allowed: T, fallback: unknown) => {
    const raw = one(k);
    const v = typeof allowed[0] === "number" ? Number(raw) : raw;
    return ((allowed as readonly unknown[]).includes(v) ? v : fallback) as T[number];
  };

  return {
    experienceYears: pick("exp", OPTIONS.experienceYears, DEFAULT_PROFILE.experienceYears),
    drivingFrequency: pick("freq", OPTIONS.drivingFrequency, DEFAULT_PROFILE.drivingFrequency),
    // 불리언은 "true"만 참으로 본다 — 오타가 "경험 있음"으로 새면 부담을 과소 계상한다
    jejuExperience: one("jeju") === "true",
    vehicleSize: pick("car", OPTIONS.vehicleSize, DEFAULT_PROFILE.vehicleSize),
    timeOfDay: pick("time", OPTIONS.timeOfDay, DEFAULT_PROFILE.timeOfDay),
  };
}

/** 프로필 + 구간 → "?exp=1&freq=low&..." */
export function toQuery(profile: DriverProfile, scenarioId: string): string {
  return `?${new URLSearchParams({
    route: scenarioId,
    exp: String(profile.experienceYears),
    freq: profile.drivingFrequency,
    jeju: String(profile.jejuExperience),
    car: profile.vehicleSize,
    time: profile.timeOfDay,
  })}`;
}
