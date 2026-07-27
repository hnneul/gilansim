"use client";

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

/**
 * 마커 아이콘. src 는 data: URI 를 넣는다 — 인라인 SVG면 파일도 외부 요청도 안 늘어난다.
 * anchor 를 안 주면 이미지 가운데를 좌표에 맞춘다 (핀 모양이면 뾰족한 끝을 직접 지정할 것).
 */
export type MarkerIcon = { src: string; size: [number, number]; anchor?: [number, number] };
export type MapMarker = { coord: LatLng; label: string; icon?: MarkerIcon };

type Props = {
  center: LatLng;
  level?: number; // 클수록 넓게 보임
  routes: MapRoute[];
  markers?: MapMarker[];
};

const KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

/**
 * SDK 로딩. 한 화면에 지도가 여러 개(메인·주차·착한가격)라도 스크립트는 하나면 되므로
 * 모듈 전역 프로미스 하나로 묶는다. 인스턴스마다 resolve 를 나눠 받는다.
 *
 * next/script 를 쓰지 않는 이유 — 같은 src 를 LoadCache 로 묶는 규칙이 인스턴스 수에 따라
 * 갈린다 (node_modules/next/dist/client/script.js): 세 번째부터는 onLoad 가 안 오고,
 * onReady 는 스크립트가 아직 로딩 중인데도 불려서 window.kakao 가 undefined 다.
 * 지도가 셋이 되는 순간 둘 다 밟았다. 스크립트 태그 하나 붙이는 일에 맞출 규칙이 아니다.
 */
let sdkPromise: Promise<void> | undefined;

function loadSdk() {
  return (sdkPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    // autoload=false — 로드 직후 maps.load() 로 직접 초기화한다
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KEY}&autoload=false`;
    s.onload = () => window.kakao.maps.load(resolve);
    s.onerror = reject;
    document.head.append(s);
  }));
}

export default function RouteMap({ center, level = 10, routes, markers = [] }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const drawn = useRef<any[]>([]);
  const [sdk, setSdk] = useState<"loading" | "ready" | "error">("loading");

  // 배열 prop이 매 렌더 새 참조라 의존성으로 직접 못 쓴다
  const shape = JSON.stringify({ center, level, routes, markers });

  useEffect(() => {
    if (!KEY) return;
    // 이미 로드됐으면 프로미스가 그대로 resolve 돼서, 리마운트에도 다시 뜬다
    loadSdk().then(
      () => setSdk("ready"),
      () => setSdk("error"),
    );
  }, []);

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
      ...markers.map((m) => {
        const [w, h] = m.icon?.size ?? [0, 0];
        return new kakao.maps.Marker({
          position: pt(m.coord),
          title: m.label,
          image:
            m.icon &&
            new kakao.maps.MarkerImage(m.icon.src, new kakao.maps.Size(w, h), {
              offset: new kakao.maps.Point(...(m.icon.anchor ?? [w / 2, h / 2])),
            }),
        });
      }),
    ];
    drawn.current.forEach((o) => o.setMap(map.current));

    // 경로 전체가 담기도록 맞춘다 — level을 시나리오마다 손으로 고르면
    // 컨테이너 폭이 달라질 때 한쪽 경로가 화면 밖으로 나간다.
    // 경로가 없으면(주차 미니 지도 등) 마커에 맞춘다 — 축척을 손으로 고를 필요가 없다.
    const all = routes.length ? routes.flatMap((r) => r.path) : markers.map((m) => m.coord);
    if (all.length < 2) return; // 한 점뿐이면 맞출 게 없다 — center/level 을 그대로 쓴다
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
