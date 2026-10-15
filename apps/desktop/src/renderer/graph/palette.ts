/** 그래프 색: 앱 테마(라이트/다크/시스템)를 따라 CSS 변수에서 읽는다. */
export interface GraphPalette {
  dark: boolean;
  accent: string;
  fg: string;
  bg: string;
  note: string;
  tag: string;
  unresolved: string;
  edge: string;
  edgeFaded: string;
  edgeHot: string;
  dim: string;
}

export function isDark(): boolean {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

const rgb = (hex: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** `from`(배경)과 `to` 를 t 비율로 섞은 불투명 색. sigma 의 선 프로그램은 알파를 쓰지 않으므로 배경과 미리 섞어 투명한 것처럼 보이게 한다. */
export const mix = (from: string, to: string, t: number): string => {
  const a = rgb(from);
  const b = rgb(to);
  if (!a || !b) return to;
  const c = a.map((x, i) => Math.round(x + (b[i]! - x) * t));
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
};


export function readPalette(): GraphPalette {
  const dark = isDark();
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const accent = v('--accent', '#5b5bd6');
  const fg = v('--fg', dark ? '#ebebeb' : '#37352f');
  const bg = v('--bg', dark ? '#191919' : '#ffffff');
  const note = dark ? '#a3a9d9' : '#6f76c2';
  return {
    dark,
    accent,
    fg,
    bg,
    note,
    tag: dark ? '#e0b45a' : '#c58a1b',
    unresolved: dark ? '#6c6c7a' : '#a4a4b2',
    edge: mix(bg, note, dark ? 0.4 : 0.27),
    edgeFaded: mix(bg, note, 0.1),
    edgeHot: accent,
    dim: mix(bg, note, 0.28),
  };
}
