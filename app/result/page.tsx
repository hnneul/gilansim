// 결과 페이지. 프로필과 구간은 URL 쿼리에서 읽는다 (lib/profile.ts).
//
// Next 16에서 searchParams는 Promise다 — await 없이 접근하면 못 쓴다.
// 점수 계산은 순수 함수라 서버에서 그대로 돌아간다. 클라이언트 몫은 지도와 프리셋 버튼뿐이다.

import Link from "next/link";
import RouteMap, { type MarkerIcon } from "../RouteMap";
import { scoreRoutes, activeWeights, isNovice, type RiskFactor, type DriverProfile } from "@/lib/score";
import { briefing } from "@/lib/briefing";
import { SCENARIOS, parkingFor, PARKING_SOURCE, type Route } from "@/lib/scenario";
import { parallelOdds, recommendedSpots, type Parking } from "@/lib/parking";
import { parseProfile } from "@/lib/profile";

export default async function ResultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const profile = parseProfile(sp);
  // 없는 구간 id가 들어와도 첫 구간으로 떨어진다 — URL은 사용자가 고칠 수 있는 입력이다
  const scenario = SCENARIOS.find((s) => s.id === sp.route) ?? SCENARIOS[0];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 p-5 text-slate-800 lg:max-w-[64rem]">
      <header className="flex items-baseline gap-3">
        <div>
          <h1 className="text-2xl font-bold">길 안심 제주</h1>
          <p className="text-sm text-slate-500">{scenario.label}</p>
        </div>
        <Link href="/" className="ml-auto shrink-0 text-sm text-slate-500 underline hover:text-slate-800">
          프로필 다시 입력
        </Link>
      </header>

      {scenario.routes ? (
        <Verified routes={scenario.routes} scenario={scenario} profile={profile} />
      ) : (
        <>
          <MapArea scenario={scenario} profile={profile} routes={[]} markers={scenario.markers} />
          <BelowMap>
            <section className="rounded-2xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
              이 구간은 아직 위험구간 검증이 되지 않아 추천을 제공하지 않습니다.
              <p className="mt-1 text-xs text-amber-700">
                확인되지 않은 위험요인은 생성하지 않는다는 원칙에 따라, 검증된 구간에서만 추천합니다.
              </p>
            </section>
          </BelowMap>
        </>
      )}
    </main>
  );
}

/**
 * 지도 + 목적지 주차 카드를 한 줄로 묶는다. 지도가 뜨는 두 자리(검증·미검증)가 모두
 * 여기를 지나가므로 카드를 한 번만 걸면 된다.
 *
 * 높이는 **행**이 쥔다 (lg:h-[62vh]). 카드에 stretch만 걸면 카드 내용이 길 때 카드가
 * 행을 늘려버려서 — 지도는 제 높이에 멈추고 그 아래로 흰 공백이 생긴다. 행에 확정 높이가
 * 있어야 카드의 max-h-full 이 기준을 갖고, 넘치는 만큼 카드 안에서 스크롤한다.
 *
 * 높이를 검증/미검증 구간별로 다르게 두던 걸(44vh/38vh) 하나로 합쳤다. 리터럴이어야
 * Tailwind가 클래스를 만들어 주는데, 그 차이는 눈에 띄지도 않는 값이었다.
 */
function MapArea({
  scenario,
  profile,
  routes,
  markers,
}: {
  scenario: (typeof SCENARIOS)[number];
  profile: DriverProfile;
} & Pick<React.ComponentProps<typeof RouteMap>, "routes" | "markers">) {
  const parking = parkingFor(scenario.id);
  return (
    <div className="flex flex-col gap-3 lg:h-[62vh] lg:min-h-[30rem] lg:flex-row">
      <div className="h-[44vh] min-h-64 min-w-0 flex-1 lg:h-full lg:min-h-0">
        <RouteMap center={scenario.center} level={scenario.level} routes={routes} markers={markers} />
      </div>
      {parking && (
        <div className="shrink-0 lg:h-full lg:w-96">
          <ParkingCard parking={parking} novice={isNovice(profile)} />
        </div>
      )}
    </div>
  );
}

/**
 * 목적지 주변 주차 정보 카드. 초보 운전자가 가장 어려워하는 건 평행주차인데, 데이터에
 * 평행/직각 컬럼이 없어 주차장유형(노상/노외)을 프록시로 쓴다 — 단정하지 않고 확률로만
 * 말한다 (lib/parking.ts).
 *
 * 접힌 상태에도 판정 한 줄은 남긴다 — 눌러야 보이는 경고는 경고 노릇을 못 한다.
 * 펼치면 지도와 같은 높이까지만 늘고 안쪽에서 스크롤한다 (open:h-full).
 * <details>는 네이티브라 여닫는 데 자바스크립트가 필요 없다 (서버 컴포넌트 그대로).
 */
function ParkingCard({ parking, novice }: { parking: Parking; novice: boolean }) {
  const odds = parallelOdds(parking, novice);
  // 색은 화면에서 가장 큰 소리다. 경력자에게 붉은 경고를 띄우면 "이 앱은 다 위험하다고 한다"가 된다.
  // 숫자는 같으니 톤만 중립으로 내린다.
  const tone = !novice
    ? "bg-slate-100 text-slate-700"
    : odds.level === "high"
      ? "bg-rose-50 text-rose-900"
      : odds.level === "mixed"
        ? "bg-amber-50 text-amber-900"
        : "bg-sky-50 text-sky-900";

  return (
    <details
      className={`group flex max-h-full flex-col overflow-hidden rounded-2xl ring-1 ring-black/5 lg:open:h-full ${tone}`}
    >
      <summary className="shrink-0 cursor-pointer list-none p-3.5 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] font-bold">P</span>
          <span className="text-sm font-semibold">목적지 주변 주차 정보</span>
          <span className="ml-auto text-[10px] opacity-60 transition-transform group-open:rotate-180">▼</span>
        </div>
        <p className="mt-2 text-xs font-semibold leading-snug">{odds.headline}</p>
        <p className="mt-0.5 text-[11px] tabular-nums opacity-70">
          {parking.label} 도보 {parking.walkM}m · 노상 {odds.onStreet} · 노외 {odds.offStreet}
        </p>
        <p className="mt-2 text-[11px] opacity-60 group-open:hidden">눌러서 추천 주차장 보기</p>
      </summary>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3.5 pb-3.5 text-xs">
        <p className="leading-relaxed">{odds.detail}</p>

        <ParkingMap parking={parking} />

        {recommendedSpots(parking).map((s) => (
          <div key={s.name + s.walkM} className="rounded-lg bg-white/70 p-2">
            <div className="flex items-baseline gap-1.5">
              <span className="font-medium">{s.name}</span>
              <span className="rounded bg-black/5 px-1 py-0.5 text-[10px]">{s.type}</span>
            </div>
            <div className="mt-0.5 tabular-nums opacity-70">
              도보 {s.walkM}m{s.spaces != null && ` · ${s.spaces}면`}
              {s.fee && ` · ${s.fee}`}
            </div>
          </div>
        ))}

        <p className="text-[10px] leading-relaxed opacity-60">
          개별 구획이 평행식인지 직각식인지는 공개 데이터에 없어, 주차장유형으로 추정한 확률입니다.
          <br />
          출처: {PARKING_SOURCE}
        </p>
      </div>
    </details>
  );
}

/**
 * 주차장 마커 아이콘. 인라인 SVG를 data: URI 로 넣어 파일도 외부 요청도 늘리지 않는다.
 *
 * 시각적 위계를 일부러 기울인다 — 보통 지도는 주차장을 다 똑같이 그리지만, 여기서는
 * 초보가 가야 할 곳(노외=직각 추정)이 눈에 띄고 피할 곳(노상=평행 추정)이 가라앉아야
 * 기능을 한다. 그래서 노외는 크고 채운 파랑, 노상은 작고 빈 회색이다.
 */
const pin = (svg: string, size: [number, number]): MarkerIcon => ({
  src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  size,
});

const 노외아이콘 = pin(
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
     <circle cx="12" cy="12" r="10" fill="#0284c7" stroke="#fff" stroke-width="2.5"/>
     <text x="12" y="16.5" font-family="system-ui,sans-serif" font-size="12" font-weight="700"
           fill="#fff" text-anchor="middle">P</text>
   </svg>`,
  [24, 24],
);

const 노상아이콘 = pin(
  `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
     <circle cx="9" cy="9" r="7" fill="#fff" stroke="#94a3b8" stroke-width="2"/>
     <text x="9" y="12.5" font-family="system-ui,sans-serif" font-size="9" font-weight="700"
           fill="#64748b" text-anchor="middle">P</text>
   </svg>`,
  [18, 18],
);

/**
 * 목적지 반경 안 주차장 미니 지도.
 *
 * 메인 지도(경로 전체 43~52km)에 찍으면 반경 1km가 화면의 2%라 전부 한 점으로 뭉친다.
 * 그래서 목적지만 담는 지도를 따로 둔다. 축척은 RouteMap 이 마커에 맞춰 잡는다.
 */
function ParkingMap({ parking }: { parking: Parking }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="h-64 overflow-hidden rounded-lg">
        <RouteMap
          center={parking.at}
          routes={[]}
          markers={[
            { coord: parking.at, label: parking.label },
            ...parking.spots.map((s) => ({
              coord: s.at,
              label: `${s.name} (${s.type} · 도보 ${s.walkM}m)`,
              icon: s.type === "노상" ? 노상아이콘 : 노외아이콘,
            })),
          ]}
        />
      </div>
      {/* 아이콘은 말보다 단정적으로 읽힌다 — 추정이라는 걸 범례에 박아 둔다 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] opacity-70">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-sky-600 ring-1 ring-white" />
          노외 — 직각주차 추정
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-white ring-1 ring-slate-400" />
          노상 — 평행주차 추정
        </span>
        <span className="w-full">지도에 {parking.spots.length}곳 표시 (도보 {parking.walkM}m 내 {parking.total}곳)</span>
      </div>
    </div>
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
      {/* ② 경로 비교 — 지도 줄만 주차 카드 자리만큼 넓게 쓰고, 아래 내용은 원래 폭을 지킨다 */}
      <MapArea
        scenario={scenario}
        profile={profile}
        routes={[line(fast, pick === "fast"), line(safe, pick === "safe")]}
        markers={[...scenario.markers, ...riskMarkers]}
      />

      <BelowMap>
        <section className="flex flex-col gap-3">
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
                {rowsOf(result, r).map(({ risk, base, exposure, multiplier, weighted }) => (
                  <li key={risk.label} className="text-xs">
                    <div className="flex justify-between gap-2 text-slate-800">
                      <span className="font-medium">{risk.label}</span>
                      <span className="shrink-0 text-slate-500">{risk.location}</span>
                    </div>
                    <div className="mt-0.5 flex justify-between gap-2 text-slate-500">
                      <span className="tabular-nums">
                        {risk.value} · 경로의 {Math.round(risk.exposure * 100)}%
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-slate-700">{weighted}점</span>
                    </div>
                    <div className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                      기본 {base} × 노출 {exposure} × 조건 {multiplier}
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

        <p className="text-xs text-slate-400">소요시간·거리·경로좌표 출처: {fast.durationSource}</p>
        <p className="text-xs text-slate-400">
          사고다발·급경사는 경로를 구분할 수 있는 데이터를 확보하지 못해 요인에서 제외했습니다.
        </p>
      </BelowMap>
    </>
  );
}

/**
 * 지도 아래 본문. 지도 줄만 주차 카드 자리(lg:w-72)만큼 넓어졌을 뿐, 읽는 내용은
 * 원래 폭(max-w-2xl) 그대로다 — 카드가 화면 끝까지 늘어나면 읽기 나빠진다.
 * 가운데 정렬하지 않는다: 지도 왼쪽 끝과 선을 맞춰야 따로 노는 느낌이 안 든다.
 */
function BelowMap({ children }: { children: React.ReactNode }) {
  return <div className="flex w-full flex-col gap-5 lg:max-w-2xl">{children}</div>;
}

/** §4 breakdown은 factor(이름)만 담으므로 Route.risks에서 원본을 되짚는다 */
function rowsOf(result: ReturnType<typeof scoreRoutes>, route: Route) {
  return result.breakdown
    .filter((b) => b.route === route.id)
    .sort((a, b) => b.weighted - a.weighted)
    .map((b) => ({
      ...b,
      risk: route.risks.find((r) => r.label === b.factor) as RiskFactor,
    }))
    .filter((b) => b.risk);
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
    <div
      className={`rounded-2xl p-4 ${recommended ? "bg-emerald-50 ring-2 ring-emerald-300" : "bg-slate-50"}`}
    >
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
