import RouteMap, { type LatLng } from "./RouteMap";

// ⚠️ 임시 좌표 — 지도 렌더 확인용일 뿐 시나리오 데이터가 아니다.
// PLAN.md §6: 소요시간 검증 전까지 좌표를 확정하지 않는다.
const 공항: LatLng = [33.507, 126.493];
const 서귀포시청: LatLng = [33.2541, 126.5601];

const TEMP_ROUTES = [
  {
    color: "#f97316",
    path: [공항, [33.489, 126.5219], [33.44, 126.557], [33.385, 126.613], 서귀포시청] as LatLng[],
  },
  {
    color: "#38bdf8",
    path: [공항, [33.47, 126.46], [33.41, 126.39], [33.33, 126.35], [33.26, 126.42], 서귀포시청] as LatLng[],
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-6">
      <header>
        <h1 className="text-2xl font-bold">길 안심 제주</h1>
        <p className="text-sm opacity-60">초보 운전자를 위한 제주 안전경로 추천</p>
      </header>
      <div className="h-[60vh]">
        <RouteMap
          center={[33.38, 126.53]}
          level={10}
          routes={TEMP_ROUTES}
          markers={[
            { coord: 공항, label: "제주국제공항" },
            { coord: 서귀포시청, label: "서귀포시청" },
          ]}
        />
      </div>
      <p className="text-xs text-slate-400">임시 좌표 — 시나리오 검증 전</p>
    </main>
  );
}
