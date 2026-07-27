// 지명·주소 지오코딩 — 출발지·목적지 둘 다 여기를 쓴다.
//
// 출발지는 보통 GPS 좌표로 오지만, 특정 구간을 재현하려고(예: "제주공항") 직접 입력할
// 수도 있다 — 그때도 목적지와 같은 카카오 로컬 키워드 검색을 쓴다. 제주 밖 결과가 섞이지
// 않도록 제주 바운딩 박스(rect)로 제한한다.
//
// 실패는 null 이 아니라 사유로 돌려준다 (lib/route.ts 의 LiveRoutes 와 같은 모양).
// null 하나로 뭉치면 화면이 사유를 지어내야 하고, 실제로 지어냈다 — 키가 없거나 카카오가
// 오류를 줘도 "제주국제공항의 위치를 찾을 수 없습니다, 정확히 다시 입력해주세요"가 떴다.
// 맞는 지명을 적은 사람에게 네 입력이 틀렸다고 하는 거짓말이고, 고칠 방법도 알려주지 못한다.

import type { LatLng } from "@/app/RouteMap";

const ENDPOINT = "https://dapi.kakao.com/v2/local/search/keyword.json";
const JEJU_RECT = "126.05,33.05,126.99,33.62";

/** 길찾기(lib/route.ts)와 같은 한계. 여기서 매달리면 결과 페이지가 끝없이 기다린다. */
const TIMEOUT_MS = 6000;

export type Geocoded = { coord: LatLng; label: string } | { error: string };

export async function geocodePlace(query: string): Promise<Geocoded> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return { error: "장소 검색 키(KAKAO_REST_API_KEY)가 설정되지 않았습니다" };

  const q = new URLSearchParams({ query, rect: JEJU_RECT, size: "1" });
  try {
    const res = await fetch(`${ENDPOINT}?${q}`, {
      headers: { Authorization: `KakaoAK ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { error: `장소 검색 서버가 응답하지 않았습니다 (HTTP ${res.status})` };

    const place = (await res.json()).documents?.[0];
    // 입력을 의심하는 건 여기 하나뿐이다 — 검색은 됐는데 제주 안에 그 이름이 없는 경우다
    if (!place)
      return { error: `"${query}"의 위치를 제주에서 찾지 못했습니다. 정확한 장소명이나 주소로 다시 입력해주세요.` };

    return { coord: [Number(place.y), Number(place.x)], label: place.place_name };
  } catch {
    // 타임아웃(AbortError)·네트워크 오류·깨진 JSON. 사유는 영어라 우리 문구로 갈아준다.
    return { error: "장소 검색 응답을 받지 못했습니다 (응답 지연 또는 네트워크 오류)" };
  }
}
