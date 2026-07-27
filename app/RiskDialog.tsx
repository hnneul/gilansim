// 근거를 카드 안에서 펼치지 않고 팝업으로 띄운다.
// 경로 카드가 2열이라 그 안에서 펼치면 글이 좁은 칸에 세로로 길게 갇힌다 — 팝업은 화면 폭을 쓴다.
//
// <dialog>.showModal() 이 Esc 닫기·바깥 어둡게(::backdrop)·포커스 갇힘·최상단 쌓기를 다 해준다.
// 없는 건 바깥 클릭 닫기 하나뿐이라 그것만 얹는다. 라이브러리도 상태값도 없고, 이 파일만 클라이언트다.
"use client";

import { useRef } from "react";

export default function RiskDialog({
  className,
  face,
  title,
  children,
}: {
  /** 카드 앞면에 입힐 클래스 (추천 여부에 따라 색이 달라진다 — 결정은 부르는 쪽이 한다) */
  className: string;
  /** 앞면 자체가 버튼이다. 모바일에서 과녁이 클수록 낫고, 줄 하나만 누르게 하면 잘 안 눌린다. */
  face: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className={`${className} text-left`}>
        {face}
      </button>
      {/* 패딩을 dialog 가 아니라 안쪽 div 가 쥔다 — dialog 에 패딩을 주면 그 여백을 눌러도
          e.target 이 dialog 라서 "바깥을 눌렀다"로 읽히고 창이 닫힌다 */}
      <dialog
        ref={ref}
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] max-h-[85vh] overflow-y-auto rounded-2xl bg-white text-slate-800 shadow-xl backdrop:bg-slate-900/40"
      >
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <p className="text-base leading-snug font-bold">{title}</p>
            {/* Esc·바깥 클릭으로도 닫히지만, 그걸 아는 건 데스크톱 사용자뿐이다 */}
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label="닫기"
              className="-mt-1 -mr-1 shrink-0 rounded-full px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              ✕
            </button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  );
}
