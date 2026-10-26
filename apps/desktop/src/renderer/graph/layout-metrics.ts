/**
 * 배치 한 덩어리(4 반복)가 얼마나 움직였는지 잰다.
 *
 * "가라앉았다"를 반복 횟수가 아니라 **그래프 크기 대비 이동량**으로 판정하기 위한 값이다.
 * 노드 수가 다른 그래프를 같은 기준(bbox의 0.1%)으로 비교할 수 있다.
 */
export interface StepMetrics {
  /** 가장 많이 움직인 노드의 거리 */
  maxStep: number;
  /** 움직인 뒤의 가로·세로 폭 중 큰 값 */
  extent: number;
  /** maxStep / extent (extent 0 이면 0) */
  ratio: number;
}

export function stepMetrics(prev: Float32Array, next: Float32Array): StepMetrics {
  const n = Math.min(prev.length, next.length);
  let maxStep = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < n; i += 2) {
    const x = next[i]!;
    const y = next[i + 1]!;
    const d = Math.hypot(x - prev[i]!, y - prev[i + 1]!);
    if (d > maxStep) maxStep = d;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const extent = maxX < minX ? 0 : Math.max(maxX - minX, maxY - minY);
  return { maxStep, extent, ratio: extent > 1e-9 ? maxStep / extent : 0 };
}
