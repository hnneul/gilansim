// 결과 페이지. 프로필과 구간은 URL 쿼리에서 읽는다 (lib/profile.ts).
//
// Next 16에서 searchParams는 Promise다 — await 없이 접근하면 못 쓴다.
// 점수 계산은 순수 함수라 서버에서 그대로 돌아간다. 클라이언트 몫은 지도와 프리셋 버튼뿐이다.

import { readFileSync } from "node:fs";
import path from "node:path";
import { Suspense } from "react";
import Link from "next/link";
import RouteMap, { type MarkerIcon, type LatLng } from "../RouteMap";
import ProfileMenu from "../ProfileMenu";
import RiskDialog from "../RiskDialog";
import { aiSentences, factsOf, type AiSentences } from "@/lib/ai";
import { scoreRoutes, activeWeights, isNovice, type RiskFactor, type DriverProfile } from "@/lib/score";
import { briefing, verdict, WHY } from "@/lib/briefing";
import {
  SCENARIOS,
  parkingAt,
  PARKING_SOURCE,
  goodpriceAt,
  GOODPRICE_SOURCE,
  type Route,
} from "@/lib/scenario";
import { parallelOdds, recommendedSpots, nearestSpots, type Parking, type ParallelOdds } from "@/lib/parking";
import { type Goodprice } from "@/lib/goodprice";
import { parseProfile, oneOf } from "@/lib/profile";
import { liveTraffic, congestionLabel, type Live } from "@/lib/traffic";
import { geocodePlace } from "@/lib/geocode";
import { routesFor, type LiveRoute, type LiveRoutes } from "@/lib/route";
import type { Link as RoadLink } from "@/lib/analyze";

/** 표준노드링크 5.9MB — 요청마다 다시 읽지 않게 모듈 전역에 캐시한다 (lib/analyze.ts 참고). */
let links: RoadLink[] | null = null;
function loadLinks(): RoadLink[] {
  return (links ??= JSON.parse(readFileSync(path.join(process.cwd(), "data/jeju-link.json"), "utf8")));
}

export default async function ResultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const profile = parseProfile(sp);

  // 목적지 텍스트가 있으면 임의 구간(GPS 출발지 + 지오코딩 목적지) 흐름이다 —
  // 굳혀둔 3구간과 완전히 다른 데이터 경로라 여기서 갈라 처리한다.
  const destQuery = oneOf(sp, "dest");
  if (destQuery) return <CustomPage sp={sp} destQuery={destQuery} profile={profile} />;

  // 없는 구간 id가 들어와도 첫 구간으로 떨어진다 — URL은 사용자가 고칠 수 있는 입력이다
  const scenario = SCENARIOS.find((s) => s.id === sp.route) ?? SCENARIOS[0];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 p-5 text-slate-800 lg:max-w-[64rem]">
      <header className="flex items-baseline gap-3">
        <div>
          <h1 className="text-2xl font-bold">길 안심 제주</h1>
          <p className="text-sm text-slate-500">{scenario.label}</p>
        </div>
        <ProfileMenu profile={profile} />
      </header>

      {scenario.routes ? (
        <Verified routes={scenario.routes} scenario={scenario} profile={profile} />
      ) : (
        <>
          <MapArea
            center={scenario.center}
            level={scenario.level}
            destination={scenario.markers[scenario.markers.length - 1]}
            profile={profile}
            routes={[]}
            markers={scenario.markers}
          />
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
 * 임의 구간(목적지 텍스트 + GPS 출발지) 결과 페이지.
 *
 * 굳혀둔 3구간과 달리 데이터가 요청 시점에 나온다 — 목적지 지오코딩 → 표준노드링크 인덱스 →
 * 카카오 길찾기 실시간 조회를 순서대로 거치고, 어느 단계든 실패하면 사유를 그대로 보여준다
 * (lib/route.ts의 원칙과 같다: 부담구간은 계산해 보여주되 확인 못 한 걸 말하지 않는다).
 */
async function CustomPage({
  sp,
  destQuery,
  profile,
}: {
  sp: Record<string, string | string[] | undefined>;
  destQuery: string;
  profile: DriverProfile;
}) {
  // 출발지는 GPS 좌표(originLat/Lng) 또는 직접 입력한 지명(originText) 중 하나로 온다 —
  // "제주공항 → 성산일출봉"처럼 특정 구간을 재현하려면 GPS로는 안 되니 텍스트 경로를 남겨둔다.
  const originText = oneOf(sp, "originText");
  let origin: { coord: LatLng; label: string };
  if (originText) {
    const found = await geocodePlace(originText);
    if ("error" in found) return <ErrorMain reason={found.error} />;
    origin = found;
  } else {
    const originLat = Number(oneOf(sp, "originLat"));
    const originLng = Number(oneOf(sp, "originLng"));
    if (!Number.isFinite(originLat) || !Number.isFinite(originLng)) {
      return <ErrorMain reason="현재 위치를 받지 못했습니다. 홈에서 다시 시도해주세요." />;
    }
    origin = { coord: [originLat, originLng], label: "현재 위치" };
  }

  const dest = await geocodePlace(destQuery);
  if ("error" in dest) return <ErrorMain reason={dest.error} />;

  const live = await routesFor(origin.coord, dest.coord, loadLinks());
  if ("error" in live) return <ErrorMain reason={live.error} />;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 p-5 text-slate-800 lg:max-w-[64rem]">
      <header className="flex items-baseline gap-3">
        <div>
          <h1 className="text-2xl font-bold">길 안심 제주</h1>
          <p className="text-sm text-slate-500">
            {origin.label} → {dest.label}
          </p>
        </div>
        <ProfileMenu profile={profile} />
      </header>
      <CustomRoutes origin={origin} dest={dest} routes={live.routes} profile={profile} />
    </main>
  );
}

/** 목적지를 못 찾거나 길찾기가 실패했을 때 — 원인을 그대로 보여준다. */
function ErrorMain({ reason }: { reason: string }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 p-5 text-slate-800">
      <header className="flex items-baseline gap-3">
        <h1 className="text-2xl font-bold">길 안심 제주</h1>
        <Link href="/" className="ml-auto shrink-0 text-sm text-slate-500 underline hover:text-slate-800">
          다시 입력
        </Link>
      </header>
      <section className="rounded-2xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">{reason}</section>
    </main>
  );
}

/**
 * 임의 구간 지도·카드·AI 문장. Verified와 같은 계산(scoreRoutes·briefing·aiSentences)을 쓰지만,
 * routesFor가 이미 실시간 조회라 liveTraffic으로 다시 덮어쓸 값이 없다.
 *
 * 대안 경로가 없는 구간(routes 1개)은 비교할 상대가 없어 부담점수·추천을 매기지 않는다 —
 * lib/route.ts의 sameRoute 판정과 같은 이유다.
 */
function CustomRoutes({
  origin,
  dest,
  routes,
  profile,
}: {
  origin: { coord: LatLng; label: string };
  dest: { coord: LatLng; label: string };
  routes: [LiveRoute, LiveRoute] | [LiveRoute];
  profile: DriverProfile;
}) {
  if (routes.length === 1) {
    const only = routes[0];
    const riskMarkers = only.risks.map((r) => ({ coord: r.coord, label: `${r.label} (${r.location})` }));
    return (
      <>
        <MapArea
          center={origin.coord}
          level={10}
          destination={dest}
          profile={profile}
          routes={[{ path: only.path, color: only.color, weight: 9, opacity: 0.95 }]}
          markers={[origin, dest, ...riskMarkers]}
        />
        <BelowMap>
          <section className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-semibold">{only.name}</p>
            <p className="mt-1 tabular-nums text-slate-500">
              {only.durationMin}분 · {only.distanceKm}km
            </p>
            <p className="mt-2 leading-relaxed text-slate-600">
              대안 경로가 없어 비교 없이 이 경로만 안내합니다 — 도로 구성이 같은 경로는 하나로 봅니다.
            </p>
            {/* 여기도 "무슨 일이 생기는가"를 먼저 준다 — 고를 경로가 없을 때는 더더욱 수치보다 이게 필요하다 */}
            {only.risks.length > 0 && (
              <ul className="mt-3 space-y-2 text-xs text-slate-500">
                {only.risks.map((r) => (
                  <li key={r.label}>
                    <span className="font-medium text-slate-700">{r.label}</span>
                    <p className="mt-0.5 leading-relaxed text-slate-700">{WHY[r.type]}</p>
                    <p className="mt-0.5 tabular-nums">
                      {r.value} · 경로의 {Math.round(r.exposure * 100)}%
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="text-xs text-slate-400">
            소요시간·경로·위험요인: {only.durationSource} — 실시간으로 분석한 참고용 결과입니다.
          </p>
        </BelowMap>
      </>
    );
  }

  const [fast, safe] = routes;
  const result = scoreRoutes(profile, fast, safe);
  const { recommendedRoute: pick, fastScore, safeScore } = result;

  const line = (r: LiveRoute, recommended: boolean) => ({
    path: r.path,
    color: r.color,
    weight: recommended ? 9 : 4,
    opacity: recommended ? 0.95 : 0.35,
  });

  const riskMarkers = [...fast.risks, ...safe.risks].map((r) => ({
    coord: r.coord,
    label: `${r.label} (${r.location})`,
  }));

  const ai = aiSentences(factsOf(`${origin.label} → ${dest.label}`, profile, result, [fast, safe]));
  const 규칙브리핑 = briefing(profile, result, { fast, safe });

  return (
    <>
      <MapArea
        center={origin.coord}
        level={10}
        destination={dest}
        profile={profile}
        routes={[line(fast, pick === "fast"), line(safe, pick === "safe")]}
        markers={[origin, dest, ...riskMarkers]}
      >
        <RailButton glyph="💡" label="팁" tone="bg-emerald-50 text-emerald-900">
          <p className="text-base font-bold">출발 전 팁</p>
          <Suspense fallback={<BriefingSkeleton n={규칙브리핑.length} />}>
            <AiBriefing p={ai} fallback={규칙브리핑} />
          </Suspense>
        </RailButton>
      </MapArea>

      <BelowMap>
        <section className="flex flex-col gap-3">
          <div className="grid grid-cols-2 items-start gap-3">
            <RouteCard r={fast} score={fastScore} recommended={pick === "fast"} result={result} ai={ai} other={safe} />
            <RouteCard r={safe} score={safeScore} recommended={pick === "safe"} result={result} ai={ai} other={fast} />
          </div>

          {pick === "single" && (
            <p className="rounded-xl bg-slate-100 p-3 text-center text-sm text-slate-600">
              두 경로의 부담 차이가 작습니다 — 익숙한 경로를 이용하세요
            </p>
          )}
        </section>

        <section>
          <Suspense fallback={null}>
            <AiSummary p={ai} />
          </Suspense>
          <p className="mt-1 text-xs text-slate-500">
            적용된 가중치:{" "}
            {activeWeights(profile).length ? activeWeights(profile).join(" · ") : "없음 (기본점수 그대로)"}
          </p>
        </section>

        <p className="text-xs text-slate-400">
          소요시간·거리·경로좌표: {fast.durationSource} — 사전 검증된 구간이 아니라 실시간으로 분석한 참고용
          결과입니다.
        </p>
      </BelowMap>
    </>
  );
}

/**
 * 지도 + 오른쪽 아이콘 레일. 부가 정보를 카드로 나란히 놓으면 그 폭만큼 지도가 좁아져서
 * 정작 봐야 할 경로가 작게 나온다 — 그래서 아이콘으로 접어 두고 패널만 지도 위로 띄운다.
 *
 * 지도가 뜨는 두 자리(검증·미검증)가 모두 여기를 지나가므로 주차 버튼은 한 번만 걸면 된다.
 * 구간별로만 있는 버튼(브리핑)은 children 으로 받아 레일 아래에 붙인다.
 * 높이는 이 줄이 쥔다 — 패널의 max-h 가 기준으로 삼는 값이다.
 */
function MapArea({
  center,
  level,
  destination,
  profile,
  routes,
  markers,
  children,
}: {
  center: LatLng;
  level: number;
  /** 목적지 좌표·이름 — 주차·착한가격업소 조회는 구간이 아니라 여기서 나온다 (임의 목적지도 같은 함수를 쓴다). */
  destination: { coord: LatLng; label: string };
  profile: DriverProfile;
  children?: React.ReactNode;
} & Pick<React.ComponentProps<typeof RouteMap>, "routes" | "markers">) {
  const parking = parkingAt(destination.label, destination.coord);
  // 평행주차 판정은 초보에게만 낸다 — 경력자에겐 노상·노외 구분이 의미가 없다.
  const odds = parking && isNovice(profile) ? parallelOdds(parking!) : null;
  const goodprice = goodpriceAt(destination.label, destination.coord);
  return (
    <div className="flex h-[52vh] min-h-72 w-full gap-2 lg:h-[68vh] lg:min-h-[32rem]">
      <div className="min-w-0 flex-1">
        <RouteMap center={center} level={level} routes={routes} markers={markers} />
      </div>
      <div className="flex w-12 shrink-0 flex-col items-center gap-3 pt-1">
        {parking && (
          <RailButton glyph="P" label="주차" tone={parkingTone(odds)}>
            <ParkingPanel parking={parking} odds={odds} />
          </RailButton>
        )}
        {children}
        {/* 착한가격업소는 주차·팁 아래에 둔다 — 운전 부담과 상관없는 부가 정보라 위계가 가장 낮다 */}
        {goodprice && (
          <RailButton glyph="₩" label="착한가격">
            <GoodpricePanel gp={goodprice} />
          </RailButton>
        )}
      </div>
    </div>
  );
}

/**
 * 레일 아이콘 하나. 접힌 상태는 동그란 버튼이고, 누르면 패널이 지도 위로 열린다
 * (right-full — 레일 폭 w-12 안에는 글이 들어가지 않는다).
 *
 * 패널 높이는 지도 높이(52vh / lg 68vh)에 맞춰 잡는다 — 더 키우면 지도를 넘어 아래
 * 경로 카드를 덮는다. 좁은 화면에서는 그 여유가 없어 지도 높이 그대로다.
 *
 * <details>는 네이티브라 여닫는 데 자바스크립트가 필요 없다 (서버 컴포넌트 그대로).
 * 아이콘 색(tone)이 접힌 상태의 유일한 신호다 — 경고 등급을 여기서 잃지 않게 톤을 넘겨받는다.
 */
function RailButton({
  glyph,
  label,
  tone = "bg-white text-slate-700",
  children,
}: {
  glyph: string;
  label: string;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    // name 이 같은 <details>는 하나만 열린다 (네이티브 아코디언) — 패널끼리 겹쳐 쌓이는 걸 JS 없이 막는다
    <details name="rail" className="group relative">
      <summary className="flex cursor-pointer list-none flex-col items-center gap-1 [&::-webkit-details-marker]:hidden">
        <span
          className={`grid h-11 w-11 place-items-center rounded-full text-sm font-bold shadow-md ring-1 ring-black/5 group-open:ring-2 group-open:ring-slate-400 ${tone}`}
        >
          {glyph}
        </span>
        <span className="text-[10px] leading-none text-slate-500">{label}</span>
      </summary>
      <div
        className={`absolute top-0 right-full z-20 mr-2 max-h-[52vh] w-[min(34rem,calc(100vw-5rem))] overflow-y-auto rounded-2xl p-4 text-sm shadow-xl ring-1 ring-black/5 lg:max-h-[80vh] ${tone}`}
      >
        {children}
      </div>
    </details>
  );
}

/**
 * 주차 아이콘·패널의 색. odds 가 없으면(경력자) 판정이 없으니 중립색이다 —
 * 색은 화면에서 가장 큰 소리라, 판정하지 않기로 해 놓고 경고색만 남기면 앞뒤가 안 맞는다.
 *
 * 레일에서는 이 색이 접힌 상태의 유일한 신호다. 판정 한 줄이 아이콘 안에는 안 들어가니,
 * 등급을 색으로라도 남긴다.
 */
function parkingTone(odds: ParallelOdds | null) {
  return !odds
    ? "bg-white text-slate-700"
    : odds.level === "high"
      ? "bg-rose-50 text-rose-900"
      : odds.level === "mixed"
        ? "bg-amber-50 text-amber-900"
        : "bg-sky-50 text-sky-900";
}

/**
 * 목적지 주변 주차 정보.
 *
 * odds 가 있으면(초보) 평행주차 판정 + 도로 밖 주차장 추천을 낸다. 초보가 가장 어려워하는
 * 게 평행주차인데 데이터에 평행/직각 컬럼이 없어, 주차장유형(노상/노외)을 프록시로 쓴다.
 *
 * odds 가 없으면(경력자) **판정 없이 주차장 목록만** 낸다. 평행이든 직각이든 상관없는
 * 사람에게 추정 경고를 얹으면 안 볼 정보를 하나 더 만드는 것이고, 프록시로 추정한 값을
 * 굳이 한 번 더 단언하는 셈이다. 가까운 순으로 사실만 준다.
 */
function ParkingPanel({ parking, odds }: { parking: Parking; odds: ParallelOdds | null }) {
  return (
    <div className="flex flex-col gap-2">
      {odds ? (
        <>
          <p className="text-base font-bold leading-snug">{odds.headline}</p>
          <p className="tabular-nums opacity-70">
            {parking.label} 도보 {parking.walkM}m 내 {parking.total}곳
          </p>
          <p className="leading-relaxed">{odds.detail}</p>
        </>
      ) : (
        <>
          <p className="text-base font-bold leading-snug">{parking.label} 주변 주차장</p>
          <p className="tabular-nums opacity-70">
            도보 {parking.walkM}m 내 {parking.total}곳 · 가까운 순
          </p>
        </>
      )}

      <ParkingMap parking={parking} split={!!odds} />

      {(odds ? recommendedSpots(parking) : nearestSpots(parking)).map((s) => (
        <div key={s.name + s.walkM} className="rounded-lg bg-black/[0.04] p-2">
          <div className="font-medium">{s.name}</div>
          <div className="mt-0.5 tabular-nums opacity-70">
            도보 {s.walkM}m{s.spaces != null && ` · ${s.spaces}면`}
            {s.fee && ` · ${s.fee}`}
          </div>
        </div>
      ))}

      <p className="text-xs leading-relaxed opacity-60">
        {odds && (
          <>
            개별 구획이 평행식인지 직각식인지는 공개 데이터에 없어, 주차장유형으로 추정한 확률입니다.
            <br />
          </>
        )}
        출처: {PARKING_SOURCE}
      </p>
    </div>
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

/** 판정을 안 낼 때(경력자) 쓰는 한 종류 아이콘. 구분하지 않기로 했으면 지도에서도 구분하지 않는다. */
const 주차장아이콘 = pin(
  `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
     <circle cx="11" cy="11" r="9" fill="#475569" stroke="#fff" stroke-width="2.5"/>
     <text x="11" y="15" font-family="system-ui,sans-serif" font-size="11" font-weight="700"
           fill="#fff" text-anchor="middle">P</text>
   </svg>`,
  [22, 22],
);

const 착한가격아이콘 = pin(
  `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
     <circle cx="11" cy="11" r="9" fill="#0d9488" stroke="#fff" stroke-width="2.5"/>
     <text x="11" y="15" font-family="system-ui,sans-serif" font-size="11" font-weight="700"
           fill="#fff" text-anchor="middle">₩</text>
   </svg>`,
  [22, 22],
);

/**
 * 목적지 주변 착한가격업소.
 *
 * 판정도 추천도 없다 — 지자체가 이미 선정해 둔 목록이고, 우리가 얹을 근거가 없다.
 * 그래서 가까운 순으로 사실만 준다 (주차 패널의 경력자 쪽과 같은 태도다).
 *
 * 선정 시점(since)을 같이 적는다. 2020년에 선정된 가격이 지금도 그 값이라는 보장이 없고,
 * 확인 못 한 걸 최신인 척 보여주면 이 앱이 지키려는 선을 넘는다.
 */
function GoodpricePanel({ gp }: { gp: Goodprice }) {
  const km = (gp.radiusM / 1000).toFixed(gp.radiusM % 1000 ? 1 : 0);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-base font-bold leading-snug">{gp.label} 주변 착한가격업소</p>
      <p className="tabular-nums opacity-70">
        {km}km 내 {gp.total}곳 · 가까운 순 ·{" "}
        {Object.entries(gp.byKind)
          .map(([k, n]) => `${k} ${n}`)
          .join(" · ")}
      </p>

      <div className="h-56 overflow-hidden rounded-lg lg:h-80">
        <RouteMap
          center={gp.at}
          routes={[]}
          markers={[
            { coord: gp.at, label: gp.label },
            ...gp.shops.map((s) => ({
              coord: s.at,
              label: `${s.name} (${s.kind} · ${s.distM}m)`,
              icon: 착한가격아이콘,
            })),
          ]}
        />
      </div>
      <p className="text-xs opacity-70">
        지도에 {gp.shops.length}곳 표시 ({km}km 내 {gp.total}곳)
      </p>

      {gp.shops.slice(0, 5).map((s) => (
        <div key={s.name + s.distM} className="rounded-lg bg-black/[0.04] p-2">
          <div className="font-medium">
            {s.name} <span className="text-xs font-normal opacity-60">{s.kind}</span>
          </div>
          <div className="mt-0.5 tabular-nums opacity-70">
            {s.distM}m · {s.addr}
            {s.tel && ` · ${s.tel}`}
          </div>
          {s.menu.length > 0 && (
            <div className="mt-1 tabular-nums opacity-80">{s.menu.slice(0, 2).join(" · ")}</div>
          )}
          {(s.time || s.since) && (
            <div className="mt-0.5 text-xs opacity-50">{[s.time, s.since].filter(Boolean).join(" · ")}</div>
          )}
        </div>
      ))}

      <p className="text-xs leading-relaxed opacity-60">
        가격은 선정 당시 기준이라 지금과 다를 수 있습니다. 가기 전에 전화로 확인하세요.
        <br />
        출처: {GOODPRICE_SOURCE}
      </p>
    </div>
  );
}

/**
 * 목적지 반경 안 주차장 미니 지도.
 *
 * 메인 지도(경로 전체 43~52km)에 찍으면 반경 1km가 화면의 2%라 전부 한 점으로 뭉친다.
 * 그래서 목적지만 담는 지도를 따로 둔다. 축척은 RouteMap 이 마커에 맞춰 잡는다.
 *
 * @param split 평행·직각 추정으로 아이콘을 가를지. 경력자에게는 끈다 — 판정을 안 내기로
 *        해 놓고 지도에서만 색으로 갈라 두면, 말로 안 한 추정을 그림으로 하는 셈이다.
 */
function ParkingMap({ parking, split }: { parking: Parking; split: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      {/* 패널이 지도 높이 안에 갇혀 있으니 작은 화면에서는 미니 지도를 낮춘다 — 안 그러면 추천 주차장이 다 스크롤 밖으로 밀린다 */}
      <div className="h-56 overflow-hidden rounded-lg lg:h-80">
        <RouteMap
          center={parking.at}
          routes={[]}
          markers={[
            { coord: parking.at, label: parking.label },
            ...parking.spots.map((s) => ({
              coord: s.at,
              label: `${s.name} (도보 ${s.walkM}m${s.spaces != null ? ` · ${s.spaces}면` : ""})`,
              icon: !split ? 주차장아이콘 : s.type === "노상" ? 노상아이콘 : 노외아이콘,
            })),
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs opacity-70">
        {/* 아이콘은 말보다 단정적으로 읽힌다 — 추정이라는 걸 범례에 박아 둔다 */}
        {split && (
          <>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-600 ring-1 ring-white" />
              직각주차 추정
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-white ring-1 ring-slate-400" />
              평행주차 추정
            </span>
          </>
        )}
        <span className="w-full">
          지도에 {parking.spots.length}곳 표시 (도보 {parking.walkM}m 내 {parking.total}곳)
        </span>
      </div>
    </div>
  );
}

async function Verified({
  routes,
  scenario,
  profile,
}: {
  routes: [Route, Route];
  scenario: (typeof SCENARIOS)[number];
  profile: DriverProfile;
}) {
  const [verifiedFast, verifiedSafe] = routes;

  // 실시간 교통. 소요시간만 갈아끼운다 — 경로 좌표와 위험요인은 검증된 값을 그대로 쓴다.
  // 실패하면 null 이고, 그때는 굳혀둔 소요시간으로 떨어진다 (lib/traffic.ts).
  const live = await liveTraffic(
    scenario.markers[0].coord,
    scenario.markers[scenario.markers.length - 1].coord,
    { fast: verifiedFast.distanceKm, safe: verifiedSafe.distanceKm },
  );
  const withLive = (r: Route, l: Live | undefined): Route =>
    l ? { ...r, durationMin: l.durationMin, distanceKm: l.distanceKm } : r;
  const fast = withLive(verifiedFast, live?.fast);
  const safe = withLive(verifiedSafe, live?.safe);

  // 요인 몇 개의 곱셈이라 매 렌더 재계산이 캐싱보다 싸다.
  // 실시간 소요시간이 들어오면 §5의 "최단거리가 시간까지 이득인가" 분기가 실제로 갈린다.
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

  // AI 문장. await 하지 않고 promise 를 그대로 두 Suspense 자리에 넘긴다 —
  // 지도·카드·근거는 AI를 기다리지 않고 먼저 뜨고, 문장만 나중에 채워진다.
  // 같은 promise 를 두 곳에서 await 해도 호출은 한 번이다.
  const ai = aiSentences(factsOf(scenario.label, profile, result, [fast, safe]));
  const 규칙브리핑 = briefing(profile, result, { fast, safe });

  return (
    <>
      {/* ② 경로 비교 — 지도는 화면 폭을 다 쓰고, 아래 내용은 원래 폭을 지킨다 */}
      <MapArea
        center={scenario.center}
        level={scenario.level}
        destination={scenario.markers[scenario.markers.length - 1]}
        profile={profile}
        routes={[line(fast, pick === "fast"), line(safe, pick === "safe")]}
        markers={[...scenario.markers, ...riskMarkers]}
      >
        {/* ④ 출발 전 팁 — AI가 쓰고, 실패하면 규칙 기반 문장으로 떨어진다 */}
        <RailButton glyph="💡" label="팁" tone="bg-emerald-50 text-emerald-900">
          <p className="text-base font-bold">출발 전 팁</p>
          <Suspense fallback={<BriefingSkeleton n={규칙브리핑.length} />}>
            <AiBriefing p={ai} fallback={규칙브리핑} />
          </Suspense>
        </RailButton>
      </MapArea>

      <BelowMap>
        <section className="flex flex-col gap-3">
          <div className="grid grid-cols-2 items-start gap-3">
            <RouteCard r={fast} score={fastScore} recommended={pick === "fast"} result={result} live={live?.fast} ai={ai} other={safe} />
            <RouteCard r={safe} score={safeScore} recommended={pick === "safe"} result={result} live={live?.safe} ai={ai} other={fast} />
          </div>

          {/* 실시간 안내가 검증된 경로를 벗어나면 지도의 위험요인과 어긋난다 — 조용히 넘기지 않는다 */}
          {live && (live.fast.drift || live.safe.drift) && (
            <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              지금{" "}
              {[live.fast.drift && fast.name, live.safe.drift && safe.name].filter(Boolean).join(" · ")}
              의 실시간 안내가 검증된 경로와 달라졌습니다 (사고·통제 가능성). 지도와 위험요인은 검증된
              경로 기준이고, 소요시간만 실시간 값입니다.
            </p>
          )}

          {pick === "single" && (
            <p className="rounded-xl bg-slate-100 p-3 text-center text-sm text-slate-600">
              두 경로의 부담 차이가 작습니다 — 익숙한 경로를 이용하세요
            </p>
          )}
        </section>

        {/* ③ 근거 — 항목별 계산은 각 경로 카드 안으로 접었다 (RouteCard). 여기 남는 건 두 카드에 공통인 것뿐이다 */}
        <section>
          <Suspense fallback={null}>
            <AiSummary p={ai} />
          </Suspense>
          <p className="mt-1 text-xs text-slate-500">
            적용된 가중치:{" "}
            {activeWeights(profile).length ? activeWeights(profile).join(" · ") : "없음 (기본점수 그대로)"}
          </p>
        </section>

        {/* 실시간과 굳힌 값이 섞여 있으니 어느 숫자가 어디서 왔는지 갈라 적는다 */}
        <p className="text-xs text-slate-400">
          {live
            ? `소요시간·혼잡도: 카카오모빌리티 길찾기 API 실시간 교통 (${live.at} 조회) · 경로좌표: ${fast.durationSource}`
            : `소요시간·거리·경로좌표 출처: ${fast.durationSource} — 실시간 교통 정보를 불러오지 못해 굳혀둔 값입니다`}
        </p>
        <p className="text-xs text-slate-400">
          사고다발·급경사는 경로를 구분할 수 있는 데이터를 확보하지 못해 요인에서 제외했습니다.
        </p>
      </BelowMap>
    </>
  );
}

/**
 * 지도 아래 본문. 지도는 화면 폭을 다 쓰지만 읽는 내용은 원래 폭(max-w-2xl) 그대로다
 * — 카드가 화면 끝까지 늘어나면 읽기 나빠진다.
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

/**
 * AI 문장 자리. 지도·카드·근거가 AI를 기다리지 않게 Suspense 안에서만 await 한다.
 * 같은 promise 를 두 컴포넌트가 await 하지만 모델 호출은 한 번이다.
 *
 * AI가 실패하면(null) 브리핑은 규칙 기반 문장으로 떨어지고, 근거 요약은 아예 사라진다 —
 * 요약은 없어도 근거 카드가 수치·출처를 다 보여주므로 빈 자리가 거짓말이 되지 않는다.
 */
async function AiSummary({ p }: { p: Promise<AiSentences | null> }) {
  const ai = await p;
  if (!ai) return null;
  return <p className="mt-1 text-xs leading-relaxed text-slate-600">{ai.summary}</p>;
}

async function AiBriefing({ p, fallback }: { p: Promise<AiSentences | null>; fallback: string[] }) {
  const ai = await p;
  const lines = ai?.briefing ?? fallback;
  return (
    <>
      <div className="mt-2 flex flex-col gap-1.5 text-sm leading-relaxed text-slate-700">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      {/* 어느 쪽이 쓴 문장인지 밝힌다 — AI가 썼는지 규칙이 썼는지는 신뢰의 문제다 */}
      <p className="mt-2 text-[11px] text-slate-400">
        {ai
          ? "생성형 AI가 계산된 수치와 확인된 위험요인만으로 작성했습니다."
          : "AI 문장을 받지 못해 계산 결과로 조립한 문장입니다."}
      </p>
    </>
  );
}

/**
 * 팝업 머리말 — 이 경로를 추천하는(또는 추천하지 않는) 이유.
 *
 * AI가 실패하거나 하루 한도에 걸리면 규칙 문장(lib/briefing.ts 의 verdict)으로 떨어진다.
 * 여기는 AiSummary 와 달리 빈 자리로 둘 수 없다 — 팝업을 여는 이유가 이 문장이다.
 */
async function AiVerdict({
  p,
  index,
  fallback,
  recommended,
}: {
  p: Promise<AiSentences | null>;
  /** 경로 순서 (fast 0, safe 1) — AiSentences.verdicts 가 같은 순서다 */
  index: 0 | 1;
  fallback: string;
  recommended: boolean;
}) {
  const ai = await p;
  return (
    <Verdict recommended={recommended} ai={!!ai}>
      {ai?.verdicts[index] ?? fallback}
    </Verdict>
  );
}

/** 규칙 문장과 AI 문장이 같은 자리를 쓰므로 모양은 한 곳에 둔다 (기다리는 동안도 이 모양이다). */
function Verdict({
  recommended,
  ai,
  children,
}: {
  recommended: boolean;
  /** 누가 쓴 문장인지 밝힌다 — AiBriefing 과 같은 이유다 */
  ai: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`mt-3 rounded-xl p-3 ${recommended ? "bg-emerald-50 text-emerald-900" : "bg-slate-100 text-slate-700"}`}
    >
      <p className="text-sm leading-relaxed">{children}</p>
      <p className="mt-1.5 text-[10px] opacity-60">
        {ai ? "생성형 AI가 계산된 수치와 확인된 위험요인만으로 작성했습니다." : "계산 결과로 조립한 문장입니다."}
      </p>
    </div>
  );
}

/** AI를 기다리는 동안. 문장 수만큼 회색 줄을 둬서 뜨는 순간 높이가 튀지 않는다. */
function BriefingSkeleton({ n }: { n: number }) {
  return (
    <div className="mt-2 flex animate-pulse flex-col gap-2" aria-label="팁 작성 중">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="h-4 rounded bg-emerald-200/60" style={{ width: `${100 - i * 12}%` }} />
      ))}
    </div>
  );
}

function RouteCard({
  r,
  score,
  recommended,
  result,
  live,
  ai,
  other,
}: {
  r: Route;
  score: number;
  recommended: boolean;
  result: ReturnType<typeof scoreRoutes>;
  /** 실시간 교통. 없으면(조회 실패) 혼잡 줄을 아예 그리지 않는다 — 모르는 걸 "원활"로 쓰지 않는다. */
  live?: Live;
  /** 두 카드가 같은 promise 를 받는다 — await 는 각자 하지만 모델 호출은 한 번이다 */
  ai: Promise<AiSentences | null>;
  /** 상대 경로 — AI 없이 판정 문장을 쓸 때 소요시간을 비교한다 (lib/briefing.ts verdict) */
  other: { durationMin: number | null };
}) {
  const 혼잡 = live && congestionLabel(live.congestion);
  const 규칙판정 = verdict(result, r, other);
  // 좁은 화면에서는 패딩을 줄인다 — 375px에서 카드 폭이 162px라 8px도 한 글자다.
  // 2열 자체는 어느 폭에서도 유지한다: 두 점수를 나란히 못 보면 이 화면이 할 말이 없다.
  // break-keep: 한글은 기본이 글자 단위 줄바꿈이라 "서 행"처럼 낱말이 쪼개진다.
  return (
    <RiskDialog
      className={`rounded-2xl p-3 break-keep sm:p-4 ${recommended ? "bg-emerald-50 ring-2 ring-emerald-300" : "bg-slate-50"}`}
      title={`${r.name} — 이 길에서 만나는 것`}
      face={
        <>
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
        {live && (
          <div
            className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${
              혼잡 ? "bg-rose-100 text-rose-700" : "bg-slate-200 text-slate-600"
            }`}
          >
            {혼잡 ? `지금 ${혼잡}` : "지금 원활"}
          </div>
        )}
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-3xl font-bold tabular-nums">{score}</span>
          <span className="text-xs text-slate-500">부담점수</span>
        </div>
        {recommended && (
          <div className="mt-1.5 inline-block rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-medium text-white">
            추천
          </div>
        )}
        {/* 좁은 칸에서 요인 이름을 잘라내지 않는다("5.16도로 연속 급…") — 두 줄로 접히게 둔다.
            어느 요인인지가 이 목록의 전부인데 그걸 자르면 목록이 있을 이유가 없다. */}
        <ul className="mt-2.5 space-y-0.5 text-xs text-slate-500">
          {rowsOf(result, r).map(({ risk, weighted }) => (
            <li key={risk.label} className="flex justify-between gap-2">
              <span>{risk.label}</span>
              <span className="shrink-0 tabular-nums">{weighted}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-400">
          눌러서 어떤 길인지 보기 <span className="text-[9px]">›</span>
        </p>
        </>
      }
    >
      {/* 왜 이 길인지(또는 왜 아닌지)가 먼저. 규칙 문장을 폴백으로 먼저 그려두고 AI 문장이
          오면 갈아끼운다 — 기다리는 동안에도 빈칸이 아니고, AI가 죽어도 자리가 남는다. */}
      <Suspense
        fallback={
          <Verdict recommended={recommended} ai={false}>
            {규칙판정}
          </Verdict>
        }
      >
        <AiVerdict p={ai} index={r.id === "fast" ? 0 : 1} fallback={규칙판정} recommended={recommended} />
      </Suspense>

      {/* 무슨 일이 생기는가 + 얼마나 되는가, 두 줄이 끝이다.
          걷어낸 것: 곱셈식(기본 × 노출 × 조건)은 우리 검산용이고, 위치(도로명)는 지도 마커가
          이미 찍고 있고, 요인별 출처는 같은 줄이 반복돼 아래 한 줄로 모았다. */}
      <ul className="mt-3 flex flex-col gap-4 border-t border-black/5 pt-3">
        {rowsOf(result, r).map(({ risk }) => (
          <li key={risk.label}>
            <p className="text-sm font-semibold text-slate-800">{risk.label}</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-700">{WHY[risk.type]}</p>
            {/* 크기는 남긴다 — 12km와 1.8km가 같은 문장을 달고 있으면 어느 길이 나쁜지 알 수 없다 */}
            <p className="mt-1 text-xs tabular-nums text-slate-500">
              {risk.value} · 경로의 {Math.round(risk.exposure * 100)}%
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-black/5 pt-2 text-[10px] leading-relaxed text-slate-400">
        출처: {[...new Set(rowsOf(result, r).map((b) => b.risk.source))].join(" · ")}
      </p>
    </RiskDialog>
  );
}
