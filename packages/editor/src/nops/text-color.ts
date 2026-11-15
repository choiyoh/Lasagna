/**
 * 글씨색 — 파일에는 `<span style="color:#RRGGBB">…</span>` 로 저장한다.
 * 임의 색은 받지 않는다: `#RRGGBB` 와 아래 고정 이름만 허용한다.
 */
export const TEXT_COLOR_PALETTE = [
  { name: 'gray', value: '#6b6b6b' },
  { name: 'red', value: '#c0392b' },
  { name: 'orange', value: '#b35a1f' },
  { name: 'green', value: '#3f7d4e' },
  { name: 'blue', value: '#2f6f9f' },
  { name: 'purple', value: '#7b5a8c' },
] as const;

export type TextColorName = (typeof TEXT_COLOR_PALETTE)[number]['name'];

const NAMED = new Set(['black', 'gray', 'grey', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'brown', 'pink']);
const HEX = /^#[0-9a-fA-F]{6}$/;

/** 허용하는 색 값인가(`#RRGGBB` 또는 고정 CSS 이름). */
export function isAllowedColor(value: string): boolean {
  const v = value.trim();
  return HEX.test(v) || NAMED.has(v.toLowerCase());
}

/**
 * `style` 속성에서 color 하나만 있을 때 그 값을 돌려준다.
 * 다른 속성(`font-size` 등)이나 허용 밖 색은 null — 그 span 은 기존처럼 원문 그대로 둔다.
 */
export function colorFromStyle(style: string): string | null {
  const declarations = style
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  if (declarations.length !== 1) return null;
  const match = /^color\s*:\s*(.+)$/i.exec(declarations[0]!);
  const value = match?.[1]?.trim();
  return value && isAllowedColor(value) ? value : null;
}

/** 여는 span 태그(마크다운 저장 형식). */
export function colorSpanMarkdown(color: string): string {
  return `<span style="color:${color}">`;
}

/** 인라인 HTML 이 글씨색 여는 태그면 색 값을, 아니면 null. */
export function colorSpanOpen(htmlValue: string): string | null {
  const m = /^<span\s+style\s*=\s*"([^"]*)"\s*>$/i.exec(htmlValue.trim());
  return m ? colorFromStyle(m[1] ?? '') : null;
}

/** 글씨색 닫는 태그인가. */
export function isColorSpanClose(htmlValue: string): boolean {
  return /^<\/span\s*>$/i.test(htmlValue.trim());
}
