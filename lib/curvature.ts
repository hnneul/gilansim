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

/** 곡선반경 100m 미만 = 급커브. 설계속도 60km/h의 최소곡선반경(약 120m)보다 급하다. */
export const SHARP_RADIUS = 100;

/**
 * 급커브가 연속된 구간을 하나로 병합해 돌려준다.
 *
 * 좌표 개수를 그대로 세면 안 된다 — 길찾기 API는 곡선부에 좌표를 촘촘히 주므로
 * 개수가 커브의 수가 아니라 좌표 밀도를 반영해버린다.
 *
 * @param speedLimitAt 해당 좌표의 제한속도(km/h). 저속 도로의 교차로 회전을
 *        급커브로 세지 않기 위해 쓴다. 없으면 전부 대상.
 */
export function sharpCurves(
  path: LatLng[],
  speedLimitAt?: (i: number) => number | null,
  minSpeed = 50,
): { start: LatLng; count: number; minRadius: number }[] {
  const runs: { start: LatLng; end: LatLng; count: number; minRadius: number }[] = [];

  for (let i = 1; i + 1 < path.length; i++) {
    // 5m 미만 간격은 좌표 잡음이 곡률을 크게 왜곡한다
    if (distance(path[i - 1], path[i]) < 5 || distance(path[i], path[i + 1]) < 5) continue;
    if (speedLimitAt && (speedLimitAt(i) ?? 0) < minSpeed) continue;

    const r = curveRadius(path[i - 1], path[i], path[i + 1]);
    if (r >= SHARP_RADIUS) continue;

    const last = runs.at(-1);
    if (last && distance(last.end, path[i]) < 100) {
      last.end = path[i];
      last.count++;
      last.minRadius = Math.min(last.minRadius, r);
    } else {
      runs.push({ start: path[i], end: path[i], count: 1, minRadius: r });
    }
  }

  return runs.map(({ start, count, minRadius }) => ({ start, count, minRadius }));
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
