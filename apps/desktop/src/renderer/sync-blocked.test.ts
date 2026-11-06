import { setLocale } from '@nopsidian/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import { blockedPlanText, resultErrorText } from './sync-blocked';

const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;
const params = { tracked: 10, deletes: 4, percent: 40 };
afterEach(() => setLocale('ko'));

describe('blockedPlanText', () => {
  it('코드가 있으면 언어를 따라 다시 그린다(ko ↔ en)', () => {
    setLocale('ko');
    expect(blockedPlanText({ blocked: '옛 문구', blockedCode: 'deleteRatio', blockedParams: params })).toBe(
      '파일 10개 중 4개(40%)를 지우려 해요. 의도한 게 맞는지 확인해 주세요.',
    );
    setLocale('en');
    const en = blockedPlanText({ blocked: '옛 문구', blockedCode: 'deleteRatio', blockedParams: params });
    expect(en).toBe('This would delete 4 of 10 files (40%). Check that this is what you want.');
    expect(en).not.toMatch(HANGUL);
    setLocale('ko');
    expect(blockedPlanText({ blocked: '', blockedCode: 'deleteRatio', blockedParams: params })).toContain('10개 중 4개');
  });

  it('값이 없거나 자리표시자가 남으면 일반 문구로 폴백한다', () => {
    for (const locale of ['ko', 'en'] as const) {
      setLocale(locale);
      const text = blockedPlanText({ blocked: '레거시', blockedCode: 'deleteRatio' });
      expect(text).not.toMatch(/\{[a-zA-Z_]/);
      if (locale === 'en') expect(text).not.toMatch(HANGUL);
      else expect(text).toMatch(HANGUL);
    }
  });

  it('코드가 없으면 레거시 문자열을 그대로 쓴다', () => {
    expect(blockedPlanText({ blocked: '옛 기록 문구' })).toBe('옛 기록 문구');
    expect(blockedPlanText({ blocked: null })).toBe('');
  });
});

describe('resultErrorText', () => {
  it('키가 있으면 그릴 때 번역하고(영→한→영), 없으면 메시지를 그대로 쓴다', () => {
    const item = { message: 'sync.err.remoteAhead', key: 'sync.err.remoteAhead', params: { path: 'a.md' } };
    setLocale('ko');
    expect(resultErrorText(item)).toBe('원격이 먼저 바뀌었어요: a.md');
    setLocale('en');
    expect(resultErrorText(item)).toBe('The file changed on Drive first: a.md');
    setLocale('ko');
    expect(resultErrorText(item)).toBe('원격이 먼저 바뀌었어요: a.md');
    expect(resultErrorText({ message: '레거시 문구' })).toBe('레거시 문구');
  });

  it('키가 이상해 자리표시자가 남으면 원래 메시지로 폴백한다', () => {
    setLocale('en');
    const text = resultErrorText({ message: 'fallback', key: 'sync.err.network', params: {} });
    expect(text).not.toMatch(/\{[a-zA-Z_]/);
  });
});
