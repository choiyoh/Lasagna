import { describe, expect, it } from 'vitest';
import { GRADIENTS, GRADIENT_PREFIX, gradientValue, isImagePath, parseCover } from './cover';

describe('cover', () => {
  it('볼트 안 이미지 경로를 알아본다', () => {
    expect(parseCover('attachments/산.jpg')).toEqual({ kind: 'image', ref: 'attachments/산.jpg' });
    expect(parseCover('  attachments/산.jpg  ')).toEqual({ kind: 'image', ref: 'attachments/산.jpg' });
    expect(parseCover('사진.PNG')).toEqual({ kind: 'image', ref: '사진.PNG' });
    expect(parseCover('a/b/그림.WebP')).toEqual({ kind: 'image', ref: 'a/b/그림.WebP' });
  });

  it('내장 그라디언트를 알아본다', () => {
    const g = GRADIENTS[0]!;
    expect(parseCover(gradientValue(g.id))).toEqual({ kind: 'gradient', id: g.id, css: g.css });
    expect(parseCover(`  ${GRADIENT_PREFIX}OCEAN `)).toEqual(parseCover(gradientValue('ocean')));
  });

  it('숫자·null·undefined·빈 문자열은 커버가 아니다', () => {
    expect(parseCover(null)).toBeNull();
    expect(parseCover(undefined)).toBeNull();
    expect(parseCover(7)).toBeNull();
    expect(parseCover({})).toBeNull();
    expect(parseCover('')).toBeNull();
    expect(parseCover('   ')).toBeNull();
  });

  it('모르는 그라디언트 id 는 커버가 아니다', () => {
    expect(parseCover('gradient:없음')).toBeNull();
    expect(parseCover('gradient:')).toBeNull();
    expect(parseCover('gradient: ocean extra')).toBeNull();
    expect(parseCover('gradient:ocean/../x.png')).toBeNull();
  });

  it('이미지 확장자가 아니면 커버가 아니다', () => {
    expect(parseCover('attachments/문서.pdf')).toBeNull();
    expect(parseCover('attachments/그림')).toBeNull();
    expect(parseCover('attachments/그림.')).toBeNull();
    expect(parseCover('gradient')).toBeNull();
  });

  it('isImagePath 는 확장자만 본다(대소문자 무시)', () => {
    expect(isImagePath('a.png')).toBe(true);
    expect(isImagePath('a.JPEG')).toBe(true);
    expect(isImagePath('a/b/c.avif')).toBe(true);
    expect(isImagePath('a.svg')).toBe(true);
    expect(isImagePath('a.pdf')).toBe(false);
    expect(isImagePath('a')).toBe(false);
    expect(isImagePath('a.')).toBe(false);
    expect(isImagePath('a.png ')).toBe(false);
  });

  it('GRADIENTS 는 id 가 서로 다른 8개이고 css 가 linear-gradient 로 시작한다', () => {
    expect(GRADIENTS).toHaveLength(8);
    expect(new Set(GRADIENTS.map((g) => g.id)).size).toBe(8);
    for (const g of GRADIENTS) {
      expect(g.id).toMatch(/^[a-z]+$/);
      expect(g.label).not.toBe('');
      expect(g.css.startsWith('linear-gradient(')).toBe(true);
    }
  });

  it('gradientValue 왕복', () => {
    for (const g of GRADIENTS) {
      const parsed = parseCover(gradientValue(g.id));
      expect(parsed?.kind === 'gradient' ? parsed.id : null).toBe(g.id);
    }
    expect(gradientValue('ocean')).toBe('gradient:ocean');
  });
});
