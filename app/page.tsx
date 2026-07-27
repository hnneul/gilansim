"use client";

import { useState } from "react";
import RouteMap from "./RouteMap";
import { scoreRoutes, activeWeights, multiplierOf, type DriverProfile, type RiskFactor } from "@/lib/score";
import { briefing } from "@/lib/briefing";
import { SCENARIOS, type Route } from "@/lib/scenario";

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
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [profile, setProfile] = useState<DriverProfile>(초보);
  const set = <K extends keyof DriverProfile>(k: K, v: DriverProfile[K]) =>
    setProfile({ ...profile, [k]: v });

  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 p-5 text-slate-800">
      <header>
        <h1 className="text-2xl font-bold">길 안심 제주</h1>
        <p className="text-sm text-slate-500">초보 운전자를 위한 제주 안전경로 추천</p>
      </header>

      {/* ① 프로필 입력 */}
      <section className="rounded-2xl bg-slate-50 p-4">
        <Field label="구간">
          <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} {s.verified ? "" : "(미검증)"}
              </option>
            ))}
          </select>
        </Field>

        <div className="mt-3 grid grid-cols-2 gap-2">
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

      {scenario.routes ? (
        <Verified routes={scenario.routes} scenario={scenario} profile={profile} />
      ) : (
        <>
          <div className="h-[38vh] min-h-56">
            <RouteMap center={scenario.center} level={scenario.level} routes={[]} markers={scenario.markers} />
          </div>
          <section className="rounded-2xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
            이 구간은 아직 위험구간 검증이 되지 않아 추천을 제공하지 않습니다.
            <p className="mt-1 text-xs text-amber-700">
              확인되지 않은 위험요인은 생성하지 않는다는 원칙에 따라, 검증된 구간에서만 추천합니다.
            </p>
          </section>
        </>
      )}
    </main>
  );
}

function Verified({
  routes,
  scenario,
  profile,
}: {
  routes: [Route, Route];
  scenario: (typeof SCENARIOS)[number];
  profile: DriverProfile;
}) {
  const [fast, safe] = routes;
  // 요인 몇 개의 곱셈이라 매 렌더 재계산이 캐싱보다 싸다
  const result = scoreRoutes(profile, fast, safe);
  const { recommendedRoute: pick, fastScore, safeScore } = result;

  const line = (r: Route, recommended: boolean) => ({
    path: r.path,
    color: r.color,
    weight: recommended ? 9 : 4,
    opacity: recommended ? 0.95 : 0.35,
  });

  // ② 위험구간 마커 — 출발/도착 마커에 더해 각 위험요인 위치를 찍는다
  const riskMarkers = [...fast.risks, ...safe.risks].map((r) => ({
    coord: r.coord,
    label: `${r.label} (${r.location})`,
  }));

  return (
    <>
      {/* ② 경로 비교 */}
      <section className="flex flex-col gap-3">
        <div className="h-[44vh] min-h-64">
          <RouteMap
            center={scenario.center}
            level={scenario.level}
            routes={[line(fast, pick === "fast"), line(safe, pick === "safe")]}
            markers={[...scenario.markers, ...riskMarkers]}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <RouteCard r={fast} score={fastScore} recommended={pick === "fast"} result={result} />
          <RouteCard r={safe} score={safeScore} recommended={pick === "safe"} result={result} />
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

        {routes.map((r) => (
          <div key={r.id} className="rounded-2xl bg-slate-50 p-4">
            <div className="flex items-center gap-2 border-l-4 pl-2" style={{ borderColor: r.color }}>
              <span className="text-sm font-semibold">{r.name}</span>
              <span className="ml-auto text-sm font-bold tabular-nums">
                {r.id === "fast" ? fastScore : safeScore}
              </span>
            </div>
            <ul className="mt-3 flex flex-col gap-3">
              {rowsOf(result, r).map(({ risk, base, weighted }) => (
                <li key={risk.label} className="text-xs">
                  <div className="flex justify-between gap-2 text-slate-800">
                    <span className="font-medium">{risk.label}</span>
                    <span className="shrink-0 text-slate-500">{risk.location}</span>
                  </div>
                  <div className="mt-0.5 flex justify-between gap-2 text-slate-500">
                    <span className="tabular-nums">
                      {risk.value} · 기본 {base} × {multiplierOf(base, weighted)}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-700">{weighted}점</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-amber-600">{risk.source}</div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* ④ 출발 전 브리핑 */}
      <section className="rounded-2xl bg-emerald-50 p-4">
        <h2 className="text-sm font-semibold">출발 전 브리핑</h2>
        <div className="mt-2 flex flex-col gap-1.5 text-sm leading-relaxed text-slate-700">
          {briefing(profile, result, { fast, safe }).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </section>

      <p className="text-xs text-slate-400">소요시간·거리 출처: {fast.durationSource}</p>
      <p className="text-xs text-amber-600">
        ⚠️ 위험요인의 위치·수치·출처는 아직 미확보 상태입니다 (경로 좌표는 임시)
      </p>
    </>
  );
}

/** §4 breakdown은 factor(이름)만 담으므로 Route.risks에서 원본을 되짚는다 */
function rowsOf(result: ReturnType<typeof scoreRoutes>, route: Route) {
  return result.breakdown
    .filter((b) => b.route === route.id)
    .sort((a, b) => b.weighted - a.weighted)
    .map((b) => ({ ...b, risk: route.risks.find((r) => r.label === b.factor) as RiskFactor }))
    .filter((b) => b.risk);
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
    <label className="flex flex-col gap-1 text-xs text-slate-500 [&_select]:w-full [&_select]:rounded-lg [&_select]:bg-white [&_select]:px-2 [&_select]:py-1.5 [&_select]:text-sm [&_select]:text-slate-800">
      {label}
      {children}
    </label>
  );
}

function RouteCard({
  r,
  score,
  recommended,
  result,
}: {
  r: Route;
  score: number;
  recommended: boolean;
  result: ReturnType<typeof scoreRoutes>;
}) {
  return (
    <div className={`rounded-2xl p-4 ${recommended ? "bg-emerald-50 ring-2 ring-emerald-300" : "bg-slate-50"}`}>
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
        <span className="text-sm font-semibold">{r.name}</span>
      </div>
      <div className="mt-0.5 text-[11px] text-slate-400">{r.badge}</div>
      <div className="mt-1 text-xs tabular-nums text-slate-500">
        {r.durationMin != null && r.distanceKm != null
          ? `${r.durationMin}분 · ${r.distanceKm}km`
          : "소요시간·거리 확인 중"}
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
      <ul className="mt-2.5 space-y-0.5 text-xs text-slate-500">
        {rowsOf(result, r).map(({ risk, weighted }) => (
          <li key={risk.label} className="flex justify-between gap-2">
            <span className="truncate">{risk.label}</span>
            <span className="shrink-0 tabular-nums">{weighted}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
