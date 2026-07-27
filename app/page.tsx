"use client";

// 프로필 입력 페이지. 결과는 /result 가 담당한다.
// 여기서 고른 값은 URL 쿼리로 넘어가므로(lib/profile.ts) 결과 링크를 그대로 공유할 수 있다.
//
// 선택지가 전부 2~3개라 드롭다운 대신 칩을 쓴다 — 한눈에 보이고 탭 한 번에 끝난다.
// 선택 색은 프리셋 버튼과 같은 slate-800이다. 주황은 5.16도로 경로 색이라 여기 쓰면 의미가 겹친다.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { type DriverProfile } from "@/lib/score";
import { SCENARIOS } from "@/lib/scenario";
import { PRESETS, DEFAULT_PROFILE, toQuery } from "@/lib/profile";

export default function Home() {
  const router = useRouter();
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [profile, setProfile] = useState<DriverProfile>(DEFAULT_PROFILE);
  const set = <K extends keyof DriverProfile>(k: K, v: DriverProfile[K]) =>
    setProfile({ ...profile, [k]: v });

  const same = (p: DriverProfile) => JSON.stringify(p) === JSON.stringify(profile);

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
          <span className="text-sm font-semibold">구간</span>
          <select
            value={scenarioId}
            onChange={(e) => setScenarioId(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800"
          >
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        {/* 프리셋은 아래 칩들을 한 번에 채우는 단축키다. 칩보다 먼저 보여야 단축이 된다. */}
        <div>
          <span className="text-sm font-semibold">한 번에 채우기</span>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {Object.entries(PRESETS).map(([key, { label, sub, profile: p }]) => (
              <Preset key={key} label={label} sub={sub} on={same(p)} onClick={() => setProfile(p)} />
            ))}
          </div>
        </div>

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

      <button
        onClick={() => router.push(`/result${toQuery(profile, scenarioId)}`)}
        className="rounded-2xl bg-slate-800 px-4 py-3.5 text-base font-semibold text-white transition hover:bg-slate-700"
      >
        경로 비교 보기
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

function Preset({ label, sub, on, onClick }: { label: string; sub: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-xl px-3 py-2.5 text-left transition ${
        on ? "bg-slate-800 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
      }`}
    >
      <div className="text-sm font-semibold">{label}</div>
      <div className={`text-xs ${on ? "text-slate-300" : "text-slate-400"}`}>{sub}</div>
    </button>
  );
}
