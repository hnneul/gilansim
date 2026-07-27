// 경로 좌표열에서 급커브를 찾는다 — PLAN.md §5 sharpCurve의 근거 계산.
//
// 외부 데이터셋이 없다. 급커브를 구간 단위로 공개하는 자료가 없어서,
// 길찾기 API가 준 경로 좌표의 기하에서 직접 계산한다.

export type LatLng = [number, number]; // [위도, 경도]

const R_EARTH = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

/** 두 좌표 사이 거리(m). 제주 규모에서는 평면 근사로 충분하다. */
export function distance([la1, lo1]: LatLng, [la2, lo2]: LatLng): number {
  const x = rad(lo2 - lo1) * Math.cos(rad((la1 + la2) / 2));
  const y = rad(la2 - la1);
  return Math.hypot(x, y) * R_EARTH;
}

/**
 * 세 점을 지나는 원의 반지름(m). 작을수록 급한 커브다.
 * 도로 설계에서 곡선반경이 그대로 커브의 급함을 나타내므로 각도보다 이 값이 낫다.
 *
 * 일직선에 가까우면 아주 큰 값이 나온다 — 헤론 공식의 부동소수점 잔차 때문에
 * 정확히 Infinity가 아닐 수 있다. 급커브 판정(<100m)에는 어느 쪽이든 영향이 없다.
 */
export function curveRadius(p0: LatLng, p1: LatLng, p2: LatLng): number {
  const a = distance(p1, p2);
  const b = distance(p0, p2);
  const c = distance(p0, p1);
  const s = (a + b + c) / 2;
  const area2 = s * (s - a) * (s - b) * (s - c); // 헤론
  if (area2 <= 0) return Infinity;
  return (a * b * c) / (4 * Math.sqrt(area2));
}

/**
 * 설계속도별 최소 평면곡선반지름(m).
 * 「도로의 구조·시설 기준에 관한 규칙」 제19조, 최대편경사 6%(지방지역) 기준.
 *
 * 급커브 임계값을 여기서 유도한다 — 전역 상수를 쓰면 그 값의 출처를 댈 수 없다.
 * 규칙 미달 곡선반경이면 그 도로의 설계속도로 안전하게 통과할 수 없다는 뜻이므로,
 * "급커브"의 정의로 이보다 나은 기준이 없다.
 */
export const MIN_CURVE_RADIUS: Record<number, number> = {
  20: 15, 30: 30, 40: 60, 50: 90, 60: 140,
  70: 200, 80: 280, 90: 380, 100: 460, 110: 600, 120: 710,
};

/**
 * 제한속도에 대응하는 급커브 임계 곡선반경(m).
 *
 * 표는 설계속도 기준인데 우리가 가진 건 표준노드링크의 제한속도다.
 * 통상 설계속도 ≥ 제한속도이므로 실제 기준보다 작은 임계값을 쓰게 된다 —
 * 놓치는 쪽으로 틀리지, 없는 급커브를 만들어내지는 않는다.
 *
 * 표에 없는 값은 10km/h 단위로 맞춘다. 표준노드링크 MAX_SPD는 전부 10의 배수지만,
 * 조용히 건너뛰면 그 구간의 급커브가 통째로 사라지므로 반올림으로 막는다.
 */
export const sharpRadiusFor = (speedKmh: number): number =>
  MIN_CURVE_RADIUS[Math.min(120, Math.max(20, Math.round(speedKmh / 10) * 10))];

/**
 * "굽은 구간"의 병합 간격. 급커브 사이 직선이 이보다 짧으면 하나의 연속 구간으로 본다.
 * 80km/h로 22초, 50km/h로 36초 — 운전자가 긴장을 풀 여유가 없는 간격이다.
 *
 * 노출을 잴 때만 쓴다. "급커브 몇 곳"을 셀 때는 기본값(100m)을 써야
 * 서로 다른 커브가 한 덩어리로 합쳐지지 않는다.
 */
export const WINDING_GAP = 500;

/**
 * 급커브가 연속된 구간을 하나로 병합해 돌려준다.
 *
 * 좌표 개수를 그대로 세면 안 된다 — 길찾기 API는 곡선부에 좌표를 촘촘히 주므로
 * 개수가 커브의 수가 아니라 좌표 밀도를 반영해버린다.
 *
 * @param speedLimitAt 해당 좌표의 제한속도(km/h). 두 가지로 쓴다 —
 *        저속 도로의 교차로 회전을 급커브로 세지 않는 필터, 그리고 급커브 임계값의 유도
 *        (sharpRadiusFor 참고). 없으면 minSpeed 기준으로 판정한다.
 * @param mergeGapM 이 거리 안에 다음 급커브가 있으면 같은 구간으로 본다.
 *        작게 두면 "급커브 몇 곳"을, 크게 두면 "굽은 길이 몇 km"를 재게 된다.
 *        둘은 다른 질문이라 호출부에서 값을 달리 준다 (WINDING_GAP 참고).
 */
export function sharpCurves(
  path: LatLng[],
  speedLimitAt?: (i: number) => number | null,
  minSpeed = 50,
  mergeGapM = 100,
): { start: LatLng; count: number; minRadius: number; lengthM: number }[] {
  const runs: { start: LatLng; end: LatLng; from: number; to: number; count: number; minRadius: number }[] = [];

  for (let i = 1; i + 1 < path.length; i++) {
    // 5m 미만 간격은 좌표 잡음이 곡률을 크게 왜곡한다
    if (distance(path[i - 1], path[i]) < 5 || distance(path[i], path[i + 1]) < 5) continue;
    // 미매칭 좌표(null)는 제외한다 — 제한속도를 모르면 임계값을 유도할 수 없다.
    // speedLimitAt 자체가 없는 경우(단위 테스트)와 구분해야 한다.
    const spd = speedLimitAt ? speedLimitAt(i) : minSpeed;
    if (spd == null || spd < minSpeed) continue;

    const r = curveRadius(path[i - 1], path[i], path[i + 1]);
    if (r >= sharpRadiusFor(spd)) continue;

    const last = runs.at(-1);
    if (last && distance(last.end, path[i]) < mergeGapM) {
      last.end = path[i];
      last.to = i;
      last.count++;
      last.minRadius = Math.min(last.minRadius, r);
    } else {
      runs.push({ start: path[i], end: path[i], from: i, to: i, count: 1, minRadius: r });
    }
  }

  // 구간 연장은 곡률을 만든 좌표 삼중항 전체를 포함한다 (from-1 ~ to+1).
  // 개수만으로는 부담을 못 잰다 — 노출 길이가 있어야 다른 요인과 같은 단위가 된다.
  return runs.map(({ start, count, minRadius, from, to }) => {
    let lengthM = 0;
    for (let i = Math.max(0, from - 1); i < Math.min(path.length - 1, to + 1); i++)
      lengthM += distance(path[i], path[i + 1]);
    return { start, count, minRadius, lengthM };
  });
}

/** 급커브가 가장 밀집한 지점과 그 반경 안의 구간 수 — 근거 카드의 "위치"가 된다 */
export function densestCluster(
  curves: { start: LatLng }[],
  radiusM = 2500,
): { at: LatLng; count: number } | null {
  let best: { at: LatLng; count: number } | null = null;
  for (const c of curves) {
    const count = curves.filter((d) => distance(c.start, d.start) < radiusM).length;
    if (!best || count > best.count) best = { at: c.start, count };
  }
  return best;
}

/** 지도 표시용 좌표 축약 (Douglas-Peucker). 곡률 계산에는 원본을 쓴다. */
export function simplify(path: LatLng[], toleranceM = 30): LatLng[] {
  if (path.length < 3) return [...path];

  const perp = (p: LatLng, a: LatLng, b: LatLng) => {
    const k = Math.cos(rad(p[0]));
    const APx = (p[1] - a[1]) * k, APy = p[0] - a[0];
    const ABx = (b[1] - a[1]) * k, ABy = b[0] - a[0];
    const ab2 = ABx * ABx + ABy * ABy;
    if (ab2 === 0) return distance(p, a);
    const t = Math.max(0, Math.min(1, (APx * ABx + APy * ABy) / ab2));
    return Math.hypot(APx - ABx * t, APy - ABy * t) * rad(1) * R_EARTH;
  };

  const keep = new Uint8Array(path.length);
  keep[0] = keep[path.length - 1] = 1;
  const stack: [number, number][] = [[0, path.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    let far = -1, max = toleranceM;
    for (let i = lo + 1; i < hi; i++) {
      const d = perp(path[i], path[lo], path[hi]);
      if (d > max) { max = d; far = i; }
    }
    if (far < 0) continue;
    keep[far] = 1;
    stack.push([lo, far], [far, hi]);
  }
  return path.filter((_, i) => keep[i]);
}
