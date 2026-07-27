"use client";

// 온보딩. 첫 화면에서 바로 프로필 다섯 줄을 물으면, 이게 뭘 해주는 앱인지 모르는 채로 답하게 된다 —
// 경력·차량을 왜 묻는지 모르면 아무 값이나 고르고, 그러면 점수가 자기 값이 아닌 프로필로 나온다.
//
// 슬라이드 3장. 가로 스크롤(scroll-snap) 대신 translateX 트랙이다 — 스크롤 컨테이너로 만들면
// onScroll로 현재 장을 읽어야 하고, 그 상태 변경이 mandatory 스냅을 다시 계산시켜 방금 넘긴 장이
// 1장으로 되돌아가는 일이 생겼다(눌러도 안 넘어감). 지금은 상태가 위치의 유일한 출처라 되돌아갈 자리가 없다.
// 대신 손가락 스와이프는 안 된다 — 넘기는 건 [다음] 버튼과 점이다.
//
// 주황은 DESIGN.md §1의 브랜드색(#FF8A3D)이다. 결과 화면에서 주황은 5.16도로 경로색(lib/scenario.ts)이라
// 의미가 겹치지만, 이 화면에는 지도도 경로 카드도 없어서 겹칠 상대가 없다.
//
// 프로필 입력은 /profile 이고, 재방문·프로필 재설정은 온보딩을 건너 그 주소로 바로 들어온다(app/ProfileMenu.tsx).

import { useState } from "react";
import Link from "next/link";

/**
 * 카피는 DESIGN.md §6 — 판단은 제안형, "위험"·"경고" 대신 "부담"·"미리 알려드려요".
 * ponytail: 그림은 결과 화면의 프로필 캐릭터(public/character)를 그대로 쓴다. 온보딩용 일러스트가
 * 따로 오면 src만 갈아끼우면 된다 — 여기서 경력 등급이라는 뜻은 쓰지 않으니 문구는 안 건드려도 된다.
 */
const SLIDES = [
  {
    title: "제주에서\n더 안전하게 운전하세요",
    sub: "내 운전 수준에 맞는 편한 길을 알려드려요.",
    art: "/character/exp1.png",
  },
  {
    title: "어느 길이\n부담이 큰지 먼저 봐요",
    sub: "급커브·좁은 교행·사고다발구간이 어디에 몇 개인지, 어느 자료에서 나온 값인지 같이 보여드려요.",
    art: "/character/exp3.png",
  },
  {
    title: "같은 목적지,\n길마다 부담이 달라요",
    sub: "운전 경력·빈도·제주 경험·차량 크기·시간대가 경로 점수의 가중치가 돼요.",
    art: "/character/exp10.png",
  },
];

const BRAND = "bg-[#FF8A3D]";
const CTA = `rounded-2xl ${BRAND} px-4 py-3.5 text-center text-base font-semibold text-white transition hover:bg-[#E8701F] active:scale-[0.98]`;

export default function Onboarding() {
  const [i, setI] = useState(0);
  const last = i === SLIDES.length - 1;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-5 text-slate-800">
      <Link href="/profile" className="self-end text-sm text-slate-400 hover:text-slate-600">
        건너뛰기
      </Link>

      {/* 바깥도 flex다 — h-full(높이 100%)은 flex-1로 잡힌 부모 높이에 안 걸려서 트랙이 내용 높이로 쪼그라든다 */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className="flex w-full shrink-0 transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${i * 100}%)` }}
        >
          {SLIDES.map((s) => (
            <section key={s.title} className="flex w-full shrink-0 flex-col gap-2">
              <h1 className="text-[26px] leading-snug font-bold whitespace-pre-line">{s.title}</h1>
              <p className="text-[15px] leading-relaxed text-slate-500">{s.sub}</p>
              <div className="mt-2 flex min-h-40 flex-1 items-center justify-center rounded-3xl bg-[#FFF1E6] p-6">
                {/* 장식이라 alt는 비운다 — 옆의 제목·설명이 같은 내용을 이미 글로 말한다 */}
                <img src={s.art} alt="" className="max-h-72 w-auto object-contain" />
              </div>
            </section>
          ))}
        </div>
      </div>

      {last ? (
        <Link href="/profile" className={CTA}>
          시작하기
        </Link>
      ) : (
        <button onClick={() => setI(i + 1)} className={CTA}>
          다음
        </button>
      )}

      {/* 점은 8px이지만 누르는 자리는 44px이다 (DESIGN.md §7 탭 타깃) — 안쪽 span만 작게 보인다 */}
      <div className="flex justify-center">
        {SLIDES.map((s, n) => (
          <button
            key={s.title}
            onClick={() => setI(n)}
            aria-label={`${n + 1}번째 소개`}
            aria-current={n === i}
            className="flex h-11 w-8 items-center justify-center"
          >
            <span
              className={`h-2 rounded-full transition-all ${n === i ? `w-6 ${BRAND}` : "w-2 bg-slate-200"}`}
            />
          </button>
        ))}
      </div>
    </main>
  );
}
