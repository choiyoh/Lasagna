import type { CSSProperties } from 'react';

/**
 * DB 선택 옵션 색을 Sfoglia 표면에 맞는 파스텔로 바꾼다.
 * CSS `light-dark()` 로 앱의 color-scheme(라이트/다크/시스템)을 그대로 따른다.
 */
export interface ChipColors {
  bg: string;
  fg: string;
}

/** CSS 명명색·임의 hex 를 웜 틴트의 기준색으로 정규화한다. */
const BASE: Record<string, string> = {
  red: '#c0392b',
  orange: '#b35a1f',
  yellow: '#b8860b',
  green: '#3f7d4e',
  blue: '#3a6f9e',
  purple: '#7b5a8c',
  pink: '#b05a78',
  brown: '#7d5a3c',
  gray: '#7a6a5c',
  grey: '#7a6a5c',
};

const CREAM = '#fffdf8';
const ESPRESSO = '#171310';
const INK = '#2b241d';
const CREAM_TEXT = '#f2e9dd';

const rgb = (hex: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  const n = Number.parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const hexOf = (v: number[]): string => `#${v.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;

const mix = (from: string, to: string, t: number): string => {
  const a = rgb(from);
  const b = rgb(to);
  if (!a || !b) return to;
  return hexOf(a.map((x, i) => x + (b[i]! - x) * t));
};

/** 옵션 색 문자열을 기준색으로. 모르는 값은 gray 로 떨어뜨린다. */
export function chipBase(color: string | undefined | null): string {
  const raw = color?.trim();
  if (!raw) return BASE.gray!;
  const named = BASE[raw.toLowerCase()];
  if (named) return named;
  return rgb(raw) ? raw : BASE.gray!;
}

/** 라이트·다크 각각의 칩 배경/글자 쌍. 글자 대비는 두 테마 모두 4.5:1 이상이다. */
export function chipColors(color: string | undefined | null): { light: ChipColors; dark: ChipColors } {
  const base = chipBase(color);
  return {
    light: { bg: mix(base, CREAM, 0.86), fg: mix(base, INK, 0.72) },
    dark: { bg: mix(base, ESPRESSO, 0.76), fg: mix(base, CREAM_TEXT, 0.6) },
  };
}

export function chipStyle(color: string | undefined | null): CSSProperties | undefined {
  if (!color?.trim()) return undefined;
  const c = chipColors(color);
  return {
    background: `light-dark(${c.light.bg}, ${c.dark.bg})`,
    color: `light-dark(${c.light.fg}, ${c.dark.fg})`,
  };
}

/** 보드 컬럼 상단 테두리처럼 면적이 넓은 장식용 색. */
export function chipBorderColor(color: string | undefined | null): string {
  if (!color?.trim()) return 'transparent';
  const base = chipBase(color);
  return `light-dark(${mix(base, CREAM, 0.55)}, ${mix(base, ESPRESSO, 0.45)})`;
}
