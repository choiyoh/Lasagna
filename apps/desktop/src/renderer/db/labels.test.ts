import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import { groupLabel } from './labels';

afterEach(() => setLocale('ko'));

describe('groupLabel', () => {
  it('빈 값·체크 라벨은 지금 언어로 그린다', () => {
    expect(groupLabel({ label: '(없음)', labelKey: 'empty' })).toBe('(없음)');
    expect(groupLabel({ label: '체크됨', labelKey: 'checked' })).toBe('체크됨');
    expect(groupLabel({ label: '체크 안 됨', labelKey: 'unchecked' })).toBe('체크 안 됨');
    setLocale('en');
    expect(groupLabel({ label: '(없음)', labelKey: 'empty' })).toBe('(Empty)');
    expect(groupLabel({ label: '체크됨', labelKey: 'checked' })).toBe('Checked');
    expect(groupLabel({ label: '체크 안 됨', labelKey: 'unchecked' })).toBe('Not checked');
  });

  it('옵션 이름 같은 값 라벨은 그대로 쓴다', () => {
    setLocale('en');
    expect(groupLabel({ label: '완료' })).toBe('완료');
    expect(groupLabel({ label: '2026-11-05' })).toBe('2026-11-05');
  });
});
