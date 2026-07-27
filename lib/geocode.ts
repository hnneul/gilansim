// 지명·주소 지오코딩 — 출발지·목적지 둘 다 여기를 쓴다.
//
// 출발지는 보통 GPS 좌표로 오지만, 특정 구간을 재현하려고(예: "제주공항") 직접 입력할
// 수도 있다 — 그때도 목적지와 같은 카카오 로컬 키워드 검색을 쓴다. 제주 밖 결과가 섞이지
// 않도록 제주 바운딩 박스(rect)로 제한한다.

import type { LatLng } from "@/app/RouteMap";

const ENDPOINT = "https://dapi.kakao.com/v2/local/search/keyword.json";
const JEJU_RECT = "126.05,33.05,126.99,33.62";

export async function geocodePlace(query: string): Promise<{ coord: LatLng; label: string } | null> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return null;

  const q = new URLSearchParams({ query, rect: JEJU_RECT, size: "1" });
  const res = await fetch(`${ENDPOINT}?${q}`, {
    headers: { Authorization: `KakaoAK ${key}` },
    cache: "no-store",
  });
  if (!res.ok) return null;

  const place = (await res.json()).documents?.[0];
  if (!place) return null;

  return { coord: [Number(place.y), Number(place.x)], label: place.place_name };
}
