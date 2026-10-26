import { describe, expect, it } from 'vitest';
import { SETTLE_WINDOW_MS, isSettled, layoutExtent, maxDisplacement, statsText } from './settle';

const box = (n: number, size = 100) => {
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = (i % 2) * size;
    out[i * 2 + 1] = Math.floor(i / 2) * size;
  }
  return out;
};

describe('layoutExtent', () => {
  it('가로·세로 중 큰 폭을 쓴다', () => {
    expect(layoutExtent(Float32Array.from([0, 0, 100, 0, 0, 50]))).toBe(100);
    expect(layoutExtent(Float32Array.from([0, 0, 40, 0, 0, 200]))).toBe(200);
    expect(layoutExtent(new Float32Array())).toBe(0);
  });
});

describe('isSettled', () => {
  it('측정 창(200ms)을 채우기 전에는 판단하지 않는다', () => {
    expect(SETTLE_WINDOW_MS).toBe(200);
    expect(isSettled(box(4), box(4), 16)).toBe(false);
  });

  it('같은 자리면 가라앉은 것이다', () => {
    expect(isSettled(box(4), box(4), 200)).toBe(true);
  });

  it('전체 크기의 0.4% 미만으로 움직이면 가라앉은 것', () => {
    const before = box(4, 100);
    const after = before.slice();
    after[0] = 0.2; // 폭 100 의 0.2%
    expect(isSettled(before, after, 200)).toBe(true);
  });

  it('눈에 보일 만큼 움직이면 아직 배치 중', () => {
    const before = box(4, 100);
    const after = before.slice();
    after[0] = 5; // 5%
    expect(isSettled(before, after, 200)).toBe(false);
  });

  it('모든 점이 한 곳이면 가라앉은 것', () => {
    expect(isSettled(new Float32Array([0, 0, 0, 0]), new Float32Array([0, 0, 0, 0]), 200)).toBe(true);
  });
});

describe('maxDisplacement', () => {
  it('가장 크게 움직인 점의 거리', () => {
    expect(maxDisplacement(Float32Array.from([0, 0, 0, 0]), Float32Array.from([3, 4, 0, 0]))).toBe(5);
  });
});

describe('statsText', () => {
  it('가라앉기 전에만 배치 중을 붙인다', () => {
    expect(statsText(7, 4, false)).toBe('7개 노드 · 4개 링크 · 배치 중…');
    expect(statsText(7, 4, true)).toBe('7개 노드 · 4개 링크');
  });
});
