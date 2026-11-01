import { describe, expect, it } from 'vitest';
import { chipColors, chipStyle } from './chip-color';

const hex = (h: string): [number, number, number] => {
  const n = Number.parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const luminance = (h: string): number => {
  const [r, g, b] = hex(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const NAMED = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'gray'];
const ARBITRARY = ['#ff0000', '#ffff00', '#0000ff', '#123456', '#e3e2e0', '#d3e5ef', '#dbeddb', '#f5a524', '#a855f7'];

describe('DB 옵션 칩 색', () => {
  it.each([...NAMED, ...ARBITRARY])('%s 는 라이트·다크 모두 4.5:1 이상', (color) => {
    const { light, dark } = chipColors(color);
    expect(contrast(light.bg, light.fg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.bg, dark.fg)).toBeGreaterThanOrEqual(4.5);
  });

  it('모르는 색은 gray 로 떨어지고, 빈 색은 인라인 스타일을 만들지 않는다', () => {
    const fallback = chipColors('not-a-color');
    expect(fallback).toEqual(chipColors('gray'));
    expect(chipStyle(undefined)).toBeUndefined();
    expect(chipStyle('  ')).toBeUndefined();
  });
});
