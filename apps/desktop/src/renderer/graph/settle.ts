/**
 * "배치 중…" 은 반복 횟수가 아니라 실제 움직임에서 파생한다.
 *
 * ForceAtlas2 는 정해진 반복(700)을 채울 때까지 도는데, 뒤쪽 반복은 화면에서 보이지 않을 만큼
 * 작게 움직인다. 그동안 캔버스는 이미 자리를 잡아 상호작용할 수 있는데도 상태 문구가 남아
 * 사실과 달랐다(리뷰: 0.2s 에 ready, 4.0s 에야 문구 해제). 그래서 일정 시간(200ms) 동안의
 * 최대 이동이 그래프 크기의 0.4% 미만이면 "가라앉았다"로 본다.
 */
import { t, tPlural } from '@nopsidian/i18n';

export const SETTLE_WINDOW_MS = 200;
export const SETTLE_RATIO = 0.004;
/** 이만큼 늦게까지 안 가라앉으면 작은 스피너를 붙인다 */
export const SPINNER_DELAY_MS = 400;

/** [x0,y0,x1,y1,…] 의 가로·세로 폭 중 큰 값 */
export function layoutExtent(p: Float32Array): number {
  if (p.length < 2) return 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < p.length; i += 2) {
    const x = p[i]!;
    const y = p[i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Math.max(maxX - minX, maxY - minY);
}

export function maxDisplacement(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let most = 0;
  for (let i = 0; i + 1 < n; i += 2) {
    const d = Math.hypot(b[i]! - a[i]!, b[i + 1]! - a[i + 1]!);
    if (d > most) most = d;
  }
  return most;
}

export function isSettled(prev: Float32Array, next: Float32Array, windowMs: number): boolean {
  if (windowMs < SETTLE_WINDOW_MS) return false;
  const extent = layoutExtent(next);
  if (extent < 1e-6) return true;
  return maxDisplacement(prev, next) / extent < SETTLE_RATIO;
}

export function statsText(nodes: number, links: number, settled: boolean, matched = nodes): string {
  // 필터가 걸려 있으면 "일치 / 전체"로 보여 준다 — 0건일 때 멈춘 것처럼 보이지 않게
  const head = matched === nodes ? tPlural('graph.stats.nodes', nodes) : tPlural('graph.stats.nodesOf', nodes, { matched });
  return `${head} · ${tPlural('graph.stats.links', links)}${settled ? '' : t('graph.stats.layouting')}`;
}
