"use client";

import { useState } from "react";
import RouteMap from "./RouteMap";
import { scoreRoutes, activeWeights, type DriverProfile } from "@/lib/score";
import { FAST, SAFE, MARKERS, MAP_CENTER, type Scenario } from "@/lib/scenario";

const 초보: DriverProfile = {
  experienceYears: 1,
  drivingFrequency: "low",
  jejuExperience: false,
  vehicleSize: "suv",
  timeOfDay: "day",
};

const 베테랑: DriverProfile = {
  experienceYears: 10,
  drivingFrequency: "high",
  jejuExperience: true,
  vehicleSize: "sedan",
  timeOfDay: "day",
};

export default function Home() {
  const [profile, setProfile] = useState<DriverProfile>(초보);
  const set = <K extends keyof DriverProfile>(k: K, v: DriverProfile[K]) =>
    setProfile({ ...profile, [k]: v });

  // 요인 몇 개의 곱셈이라 매 렌더 재계산이 캐싱보다 싸다
  const result = scoreRoutes(profile, FAST.risks, SAFE.risks);
  const { recommendedRoute: pick, fastScore, safeScore } = result;

  const line = (s: Scenario, recommended: boolean) => ({
    path: s.path,
    color: s.color,
    weight: recommended ? 9 : 4,
    opacity: recommended ? 0.95 : 0.35,
  });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 p-5 text-slate-800">
      <header>
        <h1 className="text-2xl font-bold">길 안심 제주</h1>
        <p className="text-sm text-slate-500">초보 운전자를 위한 제주 안전경로 추천</p>
      </header>

      {/* ① 프로필 */}
      <section className="rounded-2xl bg-slate-50 p-4">
        <div className="grid grid-cols-2 gap-2">
          <Preset label="초보 운전자" sub="경력 1년 · 저빈도 · SUV" on={profile === 초보} onClick={() => setProfile(초보)} />
          <Preset label="베테랑" sub="경력 10년 · 자주 운전" on={profile === 베테랑} onClick={() => setProfile(베테랑)} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="운전경력">
            <select value={profile.experienceYears} onChange={(e) => set("experienceYears", +e.target.value)}>
              <option value={1}>1년 이하</option>
              <option value={3}>2~5년</option>
              <option value={10}>5년 이상</option>
            </select>
          </Field>
          <Field label="최근 운전빈도">
            <select value={profile.drivingFrequency} onChange={(e) => set("drivingFrequency", e.target.value as DriverProfile["drivingFrequency"])}>
              <option value="low">거의 안 함</option>
              <option value="medium">가끔</option>
              <option value="high">자주</option>
            </select>
          </Field>
          <Field label="제주 운전경험">
            <select value={String(profile.jejuExperience)} onChange={(e) => set("jejuExperience", e.target.value === "true")}>
              <option value="false">없음</option>
              <option value="true">있음</option>
            </select>
          </Field>
          <Field label="차량 크기">
            <select value={profile.vehicleSize} onChange={(e) => set("vehicleSize", e.target.value as DriverProfile["vehicleSize"])}>
              <option value="compact">경차</option>
              <option value="sedan">승용차</option>
              <option value="suv">SUV</option>
            </select>
          </Field>
          <Field label="주행 시간대">
            <select value={profile.timeOfDay} onChange={(e) => set("timeOfDay", e.target.value as DriverProfile["timeOfDay"])}>
              <option value="day">주간</option>
              <option value="night">야간</option>
            </select>
          </Field>
        </div>
      </section>

      {/* ② 경로 비교 */}
      <section className="flex flex-col gap-3">
        <div className="h-[46vh] min-h-64">
          <RouteMap
            center={MAP_CENTER}
            level={10}
            routes={[line(FAST, pick === "fast"), line(SAFE, pick === "safe")]}
            markers={MARKERS}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <RouteCard s={FAST} score={fastScore} recommended={pick === "fast"} />
          <RouteCard s={SAFE} score={safeScore} recommended={pick === "safe"} />
        </div>

        {pick === "single" && (
          <p className="rounded-xl bg-slate-100 p-3 text-center text-sm text-slate-600">
            두 경로의 부담 차이가 작습니다 — 익숙한 경로를 이용하세요
          </p>
        )}
      </section>

      {/* ③ 근거 카드 */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold">추천 근거</h2>
          <p className="mt-1 text-xs text-slate-500">
            적용된 가중치:{" "}
            {activeWeights(profile).length ? activeWeights(profile).join(" · ") : "없음 (기본점수 그대로)"}
          </p>
        </div>

        {[FAST, SAFE].map((s) => (
          <div key={s.id} className="rounded-2xl bg-slate-50 p-4">
            <div className="flex items-center gap-2 border-l-4 pl-2" style={{ borderColor: s.color }}>
              <span className="text-sm font-semibold">{s.name}</span>
              <span className="ml-auto text-sm font-bold tabular-nums">
                {s.id === "fast" ? fastScore : safeScore}
              </span>
            </div>
            <ul className="mt-3 flex flex-col gap-3">
              {result.breakdown
                .filter((r) => r.route === s.id)
                .sort((a, b) => b.weighted - a.weighted)
                .map(({ risk, base, multiplier, weighted }) => (
                  <li key={risk.label} className="text-xs">
                    <div className="flex justify-between gap-2 text-slate-800">
                      <span className="font-medium">{risk.label}</span>
                      <span className="shrink-0 text-slate-500">{risk.location}</span>
                    </div>
                    <div className="mt-0.5 flex justify-between gap-2 text-slate-500">
                      <span className="tabular-nums">
                        {risk.value} · 기본 {base} × {multiplier}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-slate-700">
                        {weighted}점
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-amber-600">{risk.source}</div>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </section>
    </main>
  );
}

function Preset({ label, sub, on, onClick }: { label: string; sub: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl px-3 py-2.5 text-left transition ${
        on ? "bg-slate-800 text-white" : "bg-white text-slate-700 hover:bg-slate-100"
      }`}
    >
      <div className="text-sm font-semibold">{label}</div>
      <div className={`text-xs ${on ? "text-slate-300" : "text-slate-400"}`}>{sub}</div>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500 [&_select]:rounded-lg [&_select]:bg-white [&_select]:px-2 [&_select]:py-1.5 [&_select]:text-sm [&_select]:text-slate-800">
      {label}
      {children}
    </label>
  );
}

function RouteCard({ s, score, recommended }: { s: Scenario; score: number; recommended: boolean }) {
  return (
    <div className={`rounded-2xl p-4 ${recommended ? "bg-emerald-50 ring-2 ring-emerald-300" : "bg-slate-50"}`}>
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
        <span className="text-sm font-semibold">{s.name}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-3xl font-bold tabular-nums">{score}</span>
        <span className="text-xs text-slate-500">부담점수</span>
      </div>
      {recommended && (
        <div className="mt-1.5 inline-block rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-medium text-white">
          추천
        </div>
      )}
    </div>
  );
}
