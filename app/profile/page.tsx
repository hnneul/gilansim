"use client";

// 프로필 입력 페이지. 앞은 온보딩(/), 결과는 /result 가 담당한다.
// 여기서 고른 값은 URL 쿼리로 넘어가므로(lib/profile.ts) 결과 링크를 그대로 공유할 수 있다.
//
// 선택지가 전부 2~3개라 드롭다운 대신 칩을 쓴다 — 한눈에 보이고 탭 한 번에 끝난다.
// 다섯 줄 전부 탭 한 번씩이라 프리셋("한 번에 채우기") 같은 단축은 두지 않는다.
// 기본값이 선택된 것처럼 보이면 사용자가 칩을 안 건드리고 넘어가, 자기 값이 아닌 프로필로 점수가 나온다.
// 선택 색은 slate-800이다. 주황은 5.16도로 경로 색이라 여기 쓰면 의미가 겹친다.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { type DriverProfile } from "@/lib/score";
import { DEFAULT_PROFILE, toCustomQuery } from "@/lib/profile";

export default function Home() {
  const router = useRouter();
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [profile, setProfile] = useState<DriverProfile>(DEFAULT_PROFILE);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof DriverProfile>(k: K, v: DriverProfile[K]) =>
    setProfile({ ...profile, [k]: v });

  // 출발지를 직접 적으면 그 지명을 그대로 쓴다 — "제주공항 → 성산일출봉"처럼 특정 구간을
  // 재현하고 싶을 때 GPS로는 그 자리에 가야만 하니, 비워두면 GPS로 대신한다.
  function submit() {
    if (!destination.trim()) return setError("목적지를 입력해주세요");

    if (origin.trim()) {
      router.push(`/result${toCustomQuery(profile, origin.trim(), destination.trim())}`);
      return;
    }
    if (!("geolocation" in navigator)) return setError("이 브라우저는 위치 확인을 지원하지 않습니다");

    setError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        router.push(`/result${toCustomQuery(profile, [coords.latitude, coords.longitude], destination.trim())}`);
      },
      (err) => {
        setLocating(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "위치 권한이 거부되었습니다. 브라우저 설정에서 위치 접근을 허용해주세요."
            : "현재 위치를 확인할 수 없습니다. 다시 시도해주세요.",
        );
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 p-5 text-slate-800">
      <header>
        <h1 className="text-2xl font-bold">길 안심 제주</h1>
        <p className="text-sm text-slate-500">초보 운전자를 위한 제주 안전경로 추천</p>
      </header>

      <section className="flex flex-col gap-5 rounded-2xl bg-slate-50 p-4">
        <div>
          <h2 className="text-base font-semibold">운전 정보를 알려주세요</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            입력한 값이 경로별 점수의 가중치가 됩니다.
            어떻게 반영됐는지는 결과의 근거 카드에 그대로 나옵니다.
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">목적지</span>
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="예: 서귀포 올레시장, 성산일출봉"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">출발지 (선택)</span>
          <input
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            placeholder="예: 제주국제공항"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800"
          />
          <span className="text-xs text-slate-400">비워두면 현재 위치(GPS)로 자동으로 잡습니다.</span>
        </label>

        <Chips
          label="운전 경력"
          value={profile.experienceYears}
          onChange={(v) => set("experienceYears", v)}
          options={[
            [1, "1년 이하"],
            [3, "2~5년"],
            [10, "5년 이상"],
          ]}
        />
        <Chips
          label="최근 운전 빈도"
          value={profile.drivingFrequency}
          onChange={(v) => set("drivingFrequency", v)}
          options={[
            ["low", "거의 안 함"],
            ["medium", "가끔"],
            ["high", "자주"],
          ]}
        />
        <Chips
          label="제주 운전 경험"
          value={profile.jejuExperience}
          onChange={(v) => set("jejuExperience", v)}
          options={[
            [false, "없음"],
            [true, "있음"],
          ]}
        />
        {/*
          차종이 아니라 차폭으로 묻는다. 가중치가 붙는 이유가 "차가 넓어서 1차로 교행이 힘들다"라서다.
          차종으로 물으면 역전이 생긴다 — 캐스퍼(경형 SUV, 1.595m)가 쏘나타(중형 세단, 1.86m)보다 좁다.
          사용자는 자기 차 너비를 모르므로 대표 차명을 부제로 붙인다.
          실제 전폭: 모닝·캐스퍼 1.60m / 아반떼 1.83m · 쏘나타 1.86m / 쏘렌토 1.90m · 팰리세이드 1.98m.
          경형 기준(1.6m 이하)은 자동차관리법 시행규칙 별표1이고, 중형↔대형 경계는 실측 전폭에서 온 대략값이다.
          라벨은 320px 폭에서도 한 줄에 들어가야 한다 — 운전 전에 휴대폰으로 보는 화면이다.
        */}
        <Chips
          label="차량 크기"
          hint="좁은 길 교행 부담에 반영됩니다"
          value={profile.vehicleSize}
          onChange={(v) => set("vehicleSize", v)}
          options={[
            ["compact", "경차", "모닝·캐스퍼"],
            ["sedan", "중형", "아반떼·쏘나타"],
            ["suv", "대형", "쏘렌토·팰리세이드"],
          ]}
        />
        <Chips
          label="주행 시간대"
          value={profile.timeOfDay}
          onChange={(v) => set("timeOfDay", v)}
          options={[
            ["day", "주간"],
            ["night", "야간"],
          ]}
        />

      </section>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <button
        onClick={submit}
        disabled={locating}
        className="rounded-2xl bg-slate-800 px-4 py-3.5 text-base font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
      >
        {locating ? "현재 위치 확인 중…" : "경로 비교 보기"}
      </button>

      <p className="text-xs text-slate-400">
        입력한 프로필은 결과 주소에 담깁니다 — 링크를 저장하거나 공유하면 같은 결과가 다시 열립니다.
      </p>
    </main>
  );
}

/**
 * 선택지가 적은 값을 고르는 칩 묶음. 선택지 개수만큼 칸을 나눠 항상 한 줄에 들어간다.
 * 값의 타입을 제네릭으로 받아 옵션 목록과 onChange가 같은 타입으로 묶인다 —
 * 오타난 값이 프로필에 들어가면 점수가 조용히 기본값으로 계산된다.
 */
function Chips<T extends string | number | boolean>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  /** 이 값을 왜 묻는지. 점수에 어떻게 쓰이는지 모르면 사용자는 아무 값이나 고른다. */
  hint?: string;
  value: T;
  /** [값, 라벨, 예시]. 예시는 라벨만으로 못 고를 때만 붙인다. */
  options: [T, string, string?][];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <span className="text-sm font-semibold">{label}</span>
      {hint && <span className="ml-1.5 text-xs text-slate-400">{hint}</span>}
      <div className="mt-1.5 grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
        {options.map(([v, text, example]) => (
          <button
            key={String(v)}
            onClick={() => onChange(v)}
            aria-pressed={v === value}
            className={`rounded-xl px-2 py-2 text-sm font-medium transition ${
              v === value
                ? "bg-slate-800 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            <span className="block">{text}</span>
            {example && (
              <span
                className={`block text-[11px] font-normal leading-tight ${
                  v === value ? "text-slate-300" : "text-slate-400"
                }`}
              >
                {example}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
