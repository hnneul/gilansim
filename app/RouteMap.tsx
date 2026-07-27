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
export type MapRoute = { path: LatLng[]; color: string; weight?: number; opacity?: number };
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

  // 리마운트 시에는 Script가 이미 로드돼 있어 onLoad가 다시 불리지 않는다
  useEffect(() => {
    if (sdk === "loading" && window.kakao?.maps) window.kakao.maps.load(() => setSdk("ready"));
  }, [sdk]);

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
            strokeWeight: r.weight ?? 6,
            strokeColor: r.color,
            strokeOpacity: r.opacity ?? 0.9,
          }),
      ),
      ...markers.map((m) => new kakao.maps.Marker({ position: pt(m.coord), title: m.label })),
    ];
    drawn.current.forEach((o) => o.setMap(map.current));

    // 경로 전체가 담기도록 맞춘다 — level을 시나리오마다 손으로 고르면
    // 컨테이너 폭이 달라질 때 한쪽 경로가 화면 밖으로 나간다.
    const all = routes.flatMap((r) => r.path);
    if (!all.length) return;
    const lat = all.map((p) => p[0]);
    const lng = all.map((p) => p[1]);
    const bounds = new kakao.maps.LatLngBounds(
      new kakao.maps.LatLng(Math.min(...lat), Math.min(...lng)),
      new kakao.maps.LatLng(Math.max(...lat), Math.max(...lng)),
    );

    // 컨테이너 크기가 0인 동안 맞추면 축척이 터진다 (제주 대신 한반도가 보인다).
    // 첫 렌더에 폭이 0일 수 있고, 창 크기가 바뀌어도 다시 맞춰야 하므로 관찰한다.
    const fit = () => {
      if (!box.current?.clientWidth || !box.current.clientHeight) return;
      map.current.relayout();
      map.current.setBounds(bounds, 24, 24, 24, 24);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box.current);
    return () => ro.disconnect();
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
