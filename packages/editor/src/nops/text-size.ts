/**
 * 글자 크기 — 파일에는 `<span style="font-size:120%">…</span>` 로 저장한다.
 * 임의 값은 받지 않는다: 아래 고정 단계(85/120/150%)만 허용한다.
 */
export const TEXT_SIZE_STEPS = [
  { name: 'small', percent: 85 },
  { name: 'large', percent: 120 },
  { name: 'xlarge', percent: 150 },
] as const;

export type TextSizeName = (typeof TEXT_SIZE_STEPS)[number]['name'];

const ALLOWED = new Set<number>(TEXT_SIZE_STEPS.map((step) => step.percent));

/** 허용하는 크기 값(퍼센트)인가. */
export function isAllowedSize(percent: number): boolean {
  return ALLOWED.has(percent);
}

/**
 * `style` 속성에서 font-size 하나만, 고정 단계 값일 때 그 퍼센트를 돌려준다.
 * 다른 선언·다른 단위·공백 변형·대문자 속성은 null — 그 span 은 원문 그대로 둔다(바이트 보존).
 */
export function sizeFromStyle(style: string): number | null {
  const declarations = style
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  if (declarations.length !== 1) return null;
  const match = /^font-size:(85|120|150)%$/.exec(declarations[0]!);
  return match ? Number(match[1]) : null;
}

/** 여는 span 태그(마크다운 저장 형식). */
export function sizeSpanMarkdown(percent: number): string {
  return `<span style="font-size:${percent}%">`;
}

/** 인라인 HTML 이 글자 크기 여는 태그면 퍼센트를, 아니면 null. */
export function sizeSpanOpen(htmlValue: string): number | null {
  const m = /^<span\s+style\s*=\s*"([^"]*)"\s*>$/i.exec(htmlValue.trim());
  return m ? sizeFromStyle(m[1] ?? '') : null;
}
