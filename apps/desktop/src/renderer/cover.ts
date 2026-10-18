/**
 * 노트 커버(프런트매터 `cover`) 값 해석. React·DOM 없이 도는 순수 함수만 둔다.
 * 값은 볼트 안 이미지 경로(`attachments/산.jpg`)이거나 내장 그라디언트(`gradient:ocean`)이다.
 */

export interface GradientPreset {
  id: string;
  label: string;
  /** CSS background 값 */
  css: string;
}

/** 내장 그라디언트 8개. 라이트·다크 어디서나 보기 좋게 중간 채도로 골랐다. */
export const GRADIENTS: readonly GradientPreset[] = [
  { id: 'ocean', label: '바다', css: 'linear-gradient(135deg, #2b6cb0 0%, #63b3ed 55%, #90cdf4 100%)' },
  { id: 'sunset', label: '노을', css: 'linear-gradient(135deg, #ea580c 0%, #f59e0b 50%, #fb7185 100%)' },
  { id: 'forest', label: '숲', css: 'linear-gradient(135deg, #2f855a 0%, #68d391 100%)' },
  { id: 'lavender', label: '라벤더', css: 'linear-gradient(135deg, #7c3aed 0%, #c4b5fd 100%)' },
  { id: 'peach', label: '복숭아', css: 'linear-gradient(135deg, #fb923c 0%, #fda4af 100%)' },
  { id: 'slate', label: '슬레이트', css: 'linear-gradient(135deg, #334155 0%, #94a3b8 100%)' },
  { id: 'aurora', label: '오로라', css: 'linear-gradient(135deg, #14b8a6 0%, #6366f1 50%, #d946ef 100%)' },
  { id: 'sand', label: '모래', css: 'linear-gradient(135deg, #b08968 0%, #e6ccb2 100%)' },
];

export const GRADIENT_PREFIX = 'gradient:';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg']);

/** 이미지 확장자인가(대소문자 무시) */
export function isImagePath(p: string): boolean {
  const dot = p.lastIndexOf('.');
  if (dot < 0 || dot === p.length - 1) return false;
  return IMAGE_EXTENSIONS.has(p.slice(dot + 1).toLowerCase());
}

export type ParsedCover = { kind: 'gradient'; id: string; css: string } | { kind: 'image'; ref: string };

/** 프런트매터 값 → 해석. 못 알아보는 값이면 null. */
export function parseCover(value: unknown): ParsedCover | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '') return null;
  if (text.toLowerCase().startsWith(GRADIENT_PREFIX)) {
    const id = text.slice(GRADIENT_PREFIX.length).trim().toLowerCase();
    const preset = GRADIENTS.find((g) => g.id === id);
    return preset ? { kind: 'gradient', id: preset.id, css: preset.css } : null;
  }
  return isImagePath(text) ? { kind: 'image', ref: text } : null;
}

/** 그라디언트 프런트매터 값 `gradient:<id>` */
export function gradientValue(id: string): string {
  return `${GRADIENT_PREFIX}${id}`;
}
