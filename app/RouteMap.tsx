"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

// ponytail: 카카오 SDK는 타입 정의가 없어 any로 둔다.
// 지도 교체(Leaflet) 가능성이 있어 타입 패키지를 붙일 만큼 표면적이 넓지 않음.
declare global {
  interface Window {
    kakao: any;
  }
}

export type LatLng = [number, number]; // [위도, 경도]
export type MapRoute = { path: LatLng[]; color: string };
export type MapMarker = { coord: LatLng; label: string };

type Props = {
  center: LatLng;
  level?: number; // 클수록 넓게 보임
  routes: MapRoute[];
  markers?: MapMarker[];
};

const KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

export default function RouteMap({ center, level = 10, routes, markers = [] }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const drawn = useRef<any[]>([]);
  const [sdk, setSdk] = useState<"loading" | "ready" | "error">("loading");

  // 배열 prop이 매 렌더 새 참조라 의존성으로 직접 못 쓴다
  const shape = JSON.stringify({ center, level, routes, markers });

  useEffect(() => {
    if (sdk !== "ready" || !box.current) return;
    const { kakao } = window;
    const pt = ([lat, lng]: LatLng) => new kakao.maps.LatLng(lat, lng);

    map.current ??= new kakao.maps.Map(box.current, { center: pt(center), level });

    drawn.current.forEach((o) => o.setMap(null));
    drawn.current = [
      ...routes.map(
        (r) =>
          new kakao.maps.Polyline({
            path: r.path.map(pt),
            strokeWeight: 6,
            strokeColor: r.color,
            strokeOpacity: 0.9,
          }),
      ),
      ...markers.map((m) => new kakao.maps.Marker({ position: pt(m.coord), title: m.label })),
    ];
    drawn.current.forEach((o) => o.setMap(map.current));
  }, [sdk, shape]);

  const notice = !KEY
    ? "NEXT_PUBLIC_KAKAO_MAP_KEY 가 없습니다 (.env.local 확인)"
    : sdk === "loading"
      ? "지도를 불러오는 중…"
      : sdk === "error"
        ? "지도를 불러오지 못했습니다 (키·도메인 등록 확인)"
        : null;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-slate-100">
      {KEY && (
        <Script
          src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KEY}&autoload=false`}
          onLoad={() => window.kakao.maps.load(() => setSdk("ready"))}
          onError={() => setSdk("error")}
        />
      )}
      <div ref={box} className="h-full w-full" />
      {notice && <Notice>{notice}</Notice>}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center rounded-xl bg-slate-100 p-4 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}
