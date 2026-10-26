import { describe, expect, it } from 'vitest';
import { matchParts } from './search-highlight';

const marked = (text: string, query: string) => matchParts(text, query).map((p) => (p.hit ? `[${p.text}]` : p.text)).join('');

describe('matchParts', () => {
  it('일치한 글자만 표시한다', () => {
    expect(marked('읽기 쉬운 코드', '읽기')).toBe('[읽기] 쉬운 코드');
  });

  it('대소문자를 가리지 않는다', () => {
    expect(marked('Clean Code', 'code')).toBe('Clean [Code]');
  });

  it('여러 낱말을 각각 표시한다', () => {
    expect(marked('읽기 쉬운 코드', '읽기 코드')).toBe('[읽기] 쉬운 [코드]');
  });

  it('겹치는 구간은 한 번만 표시한다', () => {
    expect(marked('aaa', 'aa')).toBe('[aa]a');
  });

  it('맞는 곳이 없으면 원문 그대로 한 조각이다', () => {
    expect(matchParts('본문', '없음')).toEqual([{ text: '본문', hit: false }]);
    expect(matchParts('본문', '   ')).toEqual([{ text: '본문', hit: false }]);
  });

  it('제외어(-단어)는 강조하지 않는다', () => {
    expect(marked('읽기 쉬운 코드', '-읽기')).toBe('읽기 쉬운 코드');
  });
});
