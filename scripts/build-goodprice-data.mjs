// 목적지 주변 착한가격업소 데이터 생성 — node scripts/build-goodprice-data.mjs
//
// 출처: 제주특별자치도 물가정보 「착한가격업소」 https://www.jeju.go.kr/sobi/kind/kind.htm
//       이 페이지가 지도를 그릴 때 호출하는 JSON을 그대로 쓴다 (인증키 없음, 위경도 포함).
//
// ponytail: 문서화된 OpenAPI가 아니라 그 페이지의 XHR 엔드포인트다. 끊기면 대안은
//   · 공공데이터포털 15109183 제주시_착한가격업소 (좌표 있음, 제주시만)
//   · 행안부 착한가격업소 현황 CSV (전국, 좌표 없음 → 카카오 로컬로 지오코딩)
//   런타임이 아니라 빌드 때만 부르므로, 끊겨도 굳혀 둔 JSON으로 화면은 계속 돈다.
//
// 왜 3km인가 — 주차장(1km)은 걸어야 하니 도보 거리지만, 밥집은 목적지에 차를 대고
// 이동하는 곳이다. 1km로 자르면 성산 1곳·협재 0곳이라 동·서 구간이 통째로 빈다.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const API = "https://www.jeju.go.kr/api/goodprice/?page=1&pageSize=9999";
const DATA = fileURLToPath(new URL("../data/", import.meta.url));

/** 목적지에서 차로 갈 만한 거리. 이 밖은 "목적지 주변"이라 부르기 어렵다. */
const RADIUS_M = 3000;

/** 목적지당 굳혀 둘 업소 수 (카드 목록 + 미니 지도 마커). 가까운 순으로 자른다. */
const SHOP_CAP = 30;

/** 업소당 저장할 메뉴 줄 수. 원본 item 은 메뉴가 열 줄 넘는 곳도 있다. */
const MENU_CAP = 4;

// 목적지 좌표는 build-parking-data.mjs / lib/scenario.ts 의 도착 마커와 같다.
const DESTINATIONS = [
  { id: "seogwipo", label: "서귀포 매일올레시장", at: [33.2502, 126.5632] },
  { id: "seongsan", label: "성산일출봉", at: [33.4581, 126.9425] },
  { id: "hyeopjae", label: "협재해수욕장", at: [33.3943, 126.2397] },
];

/** kind 코드 → 업종명. 원본 페이지 필터 체크박스의 값·라벨 그대로다. */
const KINDS = {
  "001": "음식점",
  "002": "이미용",
  "003": "세탁업",
  "004": "숙박업",
  "005": "목욕업",
  "006": "기타",
};

const rad = (d) => (d * Math.PI) / 180;
/** 두 좌표 사이 미터. 제주 크기에선 평면 근사로 충분하다 (build-parking-data.mjs 와 같은 방식) */
const meters = ([la1, lo1], [la2, lo2]) =>
  Math.hypot(la2 - la1, (lo2 - lo1) * Math.cos(rad(la1))) * rad(1) * 6371000;

const res = await fetch(API);
if (!res.ok) throw new Error(`착한가격업소 API ${res.status} — 엔드포인트가 바뀌었는지 확인할 것`);
const { shops } = await res.json();
if (!Array.isArray(shops) || shops.length < 100)
  throw new Error(`업소 ${shops?.length}곳 — 응답 형태가 바뀐 것으로 본다 (원래 400곳대)`);

// 좌표 결측은 조용히 넘기지 않는다. 원래 2곳이고, 갑자기 늘면 응답이 바뀐 것이다.
const located = shops.filter((s) => s.lat > 0 && s.lon > 0 && s.lon < 200);
const missing = shops.length - located.length;
if (missing > shops.length * 0.1) throw new Error(`좌표 결측 ${missing}/${shops.length}곳 — 너무 많다`);

// 목적지별로 미리 잘라두지 않는다 — 임의 목적지를 받으므로 그 목록을 만들 수가 없다.
// 전체를 좌표째로 굳혀두고 거리 필터는 런타임이 한다 (lib/goodprice.ts nearbyGoodprice).
const all = located.map((s) => ({
  name: s.name.trim(),
  kind: KINDS[s.kind] ?? "기타",
  addr: (s.addr1Short ?? s.addr1 ?? "").trim(),
  tel: s.tel?.trim() || null,
  time: s.time?.trim() || null,
  // "흑돼지정식 9,000원\r\n갈치조림 中 45,000원\r\n" 형태 — 줄 단위로 가른다
  menu: (s.item ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MENU_CAP),
  since: s.year ? `${s.year}년 ${+s.month}월 선정` : null,
  at: [+s.lat.toFixed(6), +s.lon.toFixed(6)],
}));

const out = {
  radiusM: RADIUS_M,
  source: `제주특별자치도 물가정보 착한가격업소 (${shops.length}곳)`,
  shops: all,
};

writeFileSync(`${DATA}goodprice-data.json`, JSON.stringify(out));
console.log(`착한가격업소 ${shops.length}곳(좌표 ${located.length}곳) → data/goodprice-data.json`);

// 굳혀둔 3구간이 몇 곳으로 잡히는지는 찍어 둔다 — 데이터가 갱신되면 여기서 먼저 보인다
for (const dest of DESTINATIONS) {
  const near = all.filter((s) => meters(dest.at, s.at) <= RADIUS_M);
  const byKind = near.reduce((o, s) => ({ ...o, [s.kind]: (o[s.kind] ?? 0) + 1 }), {});
  console.log(`  ${dest.id.padEnd(9)} ${dest.label} ${RADIUS_M}m 내 ${String(near.length).padStart(2)}곳`, byKind);
}
