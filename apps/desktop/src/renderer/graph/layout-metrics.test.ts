import { describe, expect, it } from 'vitest';
import { stepMetrics } from './layout-metrics';

const arr = (...v: number[]) => Float32Array.from(v);

describe('stepMetrics', () => {
  it('가장 많이 움직인 노드와 bbox 폭을 잰다', () => {
    const m = stepMetrics(arr(0, 0, 0, 0), arr(3, 4, 0, 0));
    expect(m.maxStep).toBe(5);
    expect(m.extent).toBe(4);
    expect(m.ratio).toBeCloseTo(5 / 4, 6);
  });

  it('가로·세로 중 큰 폭을 bbox로 쓴다', () => {
    const m = stepMetrics(arr(0, 0, 10, 10), arr(0, 0, 10, 100));
    expect(m.extent).toBe(100);
    expect(m.ratio).toBeCloseTo(0.9, 6);
  });

  it('같은 자리면 0 이다', () => {
    const m = stepMetrics(arr(0, 0, 10, 10), arr(0, 0, 10, 10));
    expect(m.maxStep).toBe(0);
    expect(m.ratio).toBe(0);
  });

  it('한 점뿐이면 폭이 0이라 비율도 0 이다(0으로 나누지 않는다)', () => {
    const m = stepMetrics(arr(0, 0), arr(1, 1));
    expect(m.extent).toBe(0);
    expect(m.ratio).toBe(0);
    expect(Number.isFinite(m.ratio)).toBe(true);
  });

  it('길이가 다르면 짧은 쪽까지 센다', () => {
    const m = stepMetrics(arr(0, 0), arr(0, 0, 100, 100));
    expect(m.extent).toBe(0);
  });
});
