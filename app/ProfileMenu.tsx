// 결과 화면 오른쪽 위 프로필 자리. 캐릭터가 아바타이고, 누르면 지금 어떤 프로필로 점수가
// 나왔는지와 재설정 링크가 열린다 — 경력이 씨앗(1년 이하) → 새싹(2~5년) → 감귤(5년 이상)로 자란다.
//
// 프로필은 URL 쿼리에 있어서 화면에서는 안 보인다 (lib/profile.ts). 점수가 이 값들로 나온 거라
// 무엇으로 계산됐는지 되읽을 자리가 있어야 하고, 그 자리가 곧 재설정 입구다.
//
// <details>는 네이티브라 여닫는 데 자바스크립트가 필요 없다 — 결과 페이지의 지도 레일(RailButton)과
// 같은 방식이고, 덕분에 서버 컴포넌트 그대로다. 바깥을 눌러 닫는 동작은 없다 (레일도 마찬가지다).

import Link from "next/link";
import { LABELS } from "@/lib/profile";
import type { DriverProfile } from "@/lib/score";

/** 파일명이 프로필의 experienceYears 값(lib/profile.ts의 OPTIONS)이라 매핑이 표 하나로 끝난다. */
const CHARACTERS: Record<number, { src: string; alt: string; tier: string }> = {
  1: { src: "/character/exp1.png", alt: "씨앗 캐릭터", tier: "1년 이하" },
  3: { src: "/character/exp3.png", alt: "새싹 캐릭터", tier: "2~5년" },
  10: { src: "/character/exp10.png", alt: "감귤 캐릭터", tier: "5년 이상" },
};

/**
 * 배경을 지운 PNG라(scripts/cutout.swift) 원 안에서 캐릭터만 뜬다 — 세 장의 배경 톤이
 * 달라 원 색이 서로 어긋나던 게 없어졌다. 비율도 서로 달라 정사각 칸에 object-contain 으로 담는다.
 */
const AVATAR = "rounded-full object-contain ring-1 ring-slate-200";

export default function ProfileMenu({ profile }: { profile: DriverProfile }) {
  // 허용값 밖이면 초보 쪽으로 떨어뜨린다 (DEFAULT_PROFILE 과 같은 방향)
  const me = CHARACTERS[profile.experienceYears] ?? CHARACTERS[1];
  return (
    // self-center: 이미지의 베이스라인은 아래 끝이라, 헤더의 items-baseline 을 그대로 두면 제목 줄이 밀린다
    <details className="relative ml-auto shrink-0 self-center">
      <summary className="flex cursor-pointer list-none flex-col items-center gap-1 [&::-webkit-details-marker]:hidden">
        <img src={me.src} alt={me.alt} className={`h-14 w-14 ${AVATAR}`} />
        {/* 그림만으로는 누를 수 있는 자리인지 안 보인다 — 레일 아이콘과 같이 이름을 아래에 붙인다 */}
        <span className="text-[10px] leading-none text-slate-500">내 프로필</span>
      </summary>

      <div className="absolute top-full right-0 z-20 mt-2 w-60 rounded-2xl bg-white p-4 text-sm shadow-xl ring-1 ring-black/5">
        <div className="flex items-center gap-3">
          <img src={me.src} alt="" className={`h-11 w-11 shrink-0 ${AVATAR}`} />
          <div className="min-w-0">
            <p className="font-semibold">운전 경력 {me.tier}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              운전 {LABELS.drivingFrequency[profile.drivingFrequency]} · 제주{" "}
              {profile.jejuExperience ? "경험 있음" : "경험 없음"}
              <br />
              {LABELS.vehicleSize[profile.vehicleSize]} · {LABELS.timeOfDay[profile.timeOfDay]} 주행
            </p>
          </div>
        </div>
        <Link
          href="/"
          className="mt-3 block border-t border-slate-100 pt-3 font-medium text-slate-700 hover:text-slate-900 hover:underline"
        >
          프로필 재설정
        </Link>
      </div>
    </details>
  );
}
