import { describe, expect, it } from 'vitest';
import { countMarkdown, countPlain, graphemeCount, visibleText } from './text-stats.js';

const stats = (md: string) => countMarkdown(md);

describe('글자수 규칙', () => {
  it('빈 문서는 0', () => {
    expect(stats('')).toEqual({ chars: 0, charsNoSpace: 0, words: 0 });
    expect(stats('\n\n')).toEqual({ chars: 0, charsNoSpace: 0, words: 0 });
  });

  it('공백 포함/제외·줄바꿈 제외', () => {
    expect(stats('가나 다라')).toEqual({ chars: 5, charsNoSpace: 4, words: 2 });
    expect(stats('가나\n다라')).toEqual({ chars: 4, charsNoSpace: 4, words: 2 });
  });

  it('frontmatter 는 세지 않는다', () => {
    expect(stats('---\ntitle: 제목\ntags: [a]\n---\n본문')).toEqual({ chars: 2, charsNoSpace: 2, words: 1 });
  });

  it('마크다운 기호는 보이지 않으므로 세지 않는다', () => {
    expect(stats('# 제목')).toEqual({ chars: 2, charsNoSpace: 2, words: 1 });
    expect(stats('**굵게** _기울임_ ~~취소~~ `코드`')).toEqual({ chars: 12, charsNoSpace: 9, words: 4 });
    expect(stats('- 항목\n- 둘째')).toEqual({ chars: 4, charsNoSpace: 4, words: 2 });
    expect(stats('> 인용')).toEqual({ chars: 2, charsNoSpace: 2, words: 1 });
    // 표는 셀 텍스트만 센다(패딩 공백은 보이는 글자가 아님) → AST 도입으로 기대값 변경
    expect(stats('| a | b |\n|---|---|\n| 1 | 2 |')).toEqual({ chars: 4, charsNoSpace: 4, words: 4 });
  });

  it('링크는 표시 텍스트만, 이미지는 세지 않는다', () => {
    expect(stats('[보기](https://example.com/very/long)')).toEqual({ chars: 2, charsNoSpace: 2, words: 1 });
    expect(stats('[[노트|별칭]]')).toEqual({ chars: 2, charsNoSpace: 2, words: 1 });
    expect(stats('[[노트]]')).toEqual({ chars: 2, charsNoSpace: 2, words: 1 });
    expect(stats('![[사진.png]]')).toEqual({ chars: 0, charsNoSpace: 0, words: 0 });
    expect(stats('![대체](a.png)')).toEqual({ chars: 0, charsNoSpace: 0, words: 0 });
  });

  it('코드 블록 내용은 포함한다(펜스 표식은 제외)', () => {
    expect(stats('```ts\nconst a = 1;\n```')).toEqual({ chars: 12, charsNoSpace: 9, words: 4 });
  });

  it('grapheme 1글자=1, 이모지 1, NFC/NFD 동일', () => {
    expect(graphemeCount('👍🏽')).toBe(1);
    expect(stats('👍🏽')).toEqual({ chars: 1, charsNoSpace: 1, words: 1 });
    const nfc = '한글';
    const nfd = nfc.normalize('NFD');
    expect(countPlain(nfd)).toEqual(countPlain(nfc));
    expect(stats('👨‍👩‍👧')).toEqual({ chars: 1, charsNoSpace: 1, words: 1 });
  });

  it('영어 단어 수를 함께 센다', () => {
    expect(stats('Hello world, again')).toEqual({ chars: 18, charsNoSpace: 16, words: 3 });
  });

  it('코드 블록·인라인 코드는 마크다운 해석 없이 그대로 센다', () => {
    expect(stats('```md\n# 코드 주석\n- 코드 목록\n**코드 굵게**\n```')).toEqual({ chars: 23, charsNoSpace: 18, words: 8 });
    expect(stats('`**굵게** # 아님`')).toEqual({ chars: 11, charsNoSpace: 9, words: 3 });
  });

  it('콜아웃 표식은 빼고 제목·내용만 센다', () => {
    expect(stats('> [!note] 제목\n> 내용')).toEqual({ chars: 4, charsNoSpace: 4, words: 2 });
    expect(stats('> [!warning]')).toEqual({ chars: 0, charsNoSpace: 0, words: 0 });
  });

  it('수식은 원문 LaTeX 을 세지 않는다', () => {
    expect(stats('$x^2 + y^2$')).toEqual({ chars: 0, charsNoSpace: 0, words: 0 });
    expect(stats('$$\nE = mc^2\n$$')).toEqual({ chars: 0, charsNoSpace: 0, words: 0 });
  });

  it('5만 자 문서도 빠르게 센다', () => {
    const text = '가나다라마바사 아자차카타파하\n'.repeat(3500).slice(0, 50_000);
    const started = performance.now();
    const r = stats(text);
    const ms = performance.now() - started;
    expect(r.chars).toBeGreaterThan(40_000);
    expect(ms).toBeLessThan(1500);
  });
});

describe('columns·toggle 표식과 선택 구간', () => {
  it('columns/toggle 표식은 어떤 콜론 개수·중첩에서도 세지 않는다', () => {
    expect(stats(':::columns\n:::column\n첫째\n:::\n:::column\n둘째\n:::\n:::')).toEqual({ chars: 4, charsNoSpace: 4, words: 2 });
    expect(stats('::::columns\n::::column\n가\n::::\n::::')).toEqual({ chars: 1, charsNoSpace: 1, words: 1 });
    expect(stats('## 접이식 {.toggle}\n\n숨은 내용')).toEqual({ chars: 9, charsNoSpace: 7, words: 3 });
    expect(visibleText('::::columns\n가\n::::')).toBe('가\n');
  });
});

describe('코드 구간은 마크다운을 해석하지 않는다(회귀)', () => {
  it('펜스 코드 안의 마크다운·HTML·속성·콜아웃·파이프를 그대로 센다', () => {
    expect(stats('```\n[x](y)\n```')).toEqual({ chars: 6, charsNoSpace: 6, words: 1 });
    expect(stats('```\n{.toggle}\n```')).toEqual({ chars: 9, charsNoSpace: 9, words: 1 });
    expect(stats('```\n[!note]\n```')).toEqual({ chars: 7, charsNoSpace: 7, words: 1 });
    expect(stats('```\n<b>\n```')).toEqual({ chars: 3, charsNoSpace: 3, words: 1 });
    expect(stats('```\na|b\n```')).toEqual({ chars: 3, charsNoSpace: 3, words: 1 });
    expect(stats('```md\n# 제목\n- 항목\n**굵게**\n```')).toEqual({ chars: 14, charsNoSpace: 12, words: 5 });
  });

  it('인라인 코드 안의 표식도 그대로 센다', () => {
    expect(stats('`[x](y)`')).toEqual({ chars: 6, charsNoSpace: 6, words: 1 });
    expect(stats('`{.toggle}`')).toEqual({ chars: 9, charsNoSpace: 9, words: 1 });
    expect(stats('`[!note]`')).toEqual({ chars: 7, charsNoSpace: 7, words: 1 });
    expect(stats('`<b>`')).toEqual({ chars: 3, charsNoSpace: 3, words: 1 });
    expect(stats('`a|b`')).toEqual({ chars: 3, charsNoSpace: 3, words: 1 });
  });
});

describe('본문 중간의 리터럴은 보이는 글자다', () => {
  it('중괄호·콜아웃 모양 문자열도 본문에서는 그대로 센다', () => {
    const attr = '그는 {이상한} 표정';
    expect(visibleText(attr)).toBe(attr);
    expect(stats(attr)).toEqual({ chars: 11, charsNoSpace: 9, words: 3 });
    const callout = '기호 [!note] 텍스트';
    expect(visibleText(callout)).toBe(callout);
    expect(stats(callout)).toEqual({ chars: 14, charsNoSpace: 12, words: 3 });
  });
});

describe('성능(마스크 캐시)', () => {
  it('12만 자 초기 계산 ≤ 600ms(선형)', () => {
    const mk = (n: number) => ('문장 하나를 길게 씁니다. 대사 "안녕" 그리고 **강조** [링크](https://x.y/z)\n').repeat(n).slice(0, n * 50);
    const half = mk(1200); // 약 6만 자
    const big = mk(2400); // 약 12만 자
    const time = (doc: string) => {
      const t0 = performance.now();
      countMarkdown(doc);
      return performance.now() - t0;
    };
    // 파서·JIT 워밍(부하가 있는 CI 에서도 흔들리지 않게 두 번 재고 최솟값을 쓴다)
    time(mk(50) + '#w');
    time(big + '#warm');
    const halfMs = Math.min(time(half + '#half1'), time(half + '#half2'));
    const bigMs = Math.min(time(big + '#big1'), time(big + '#big2'));
    expect(countMarkdown(big + '#big1').chars).toBeGreaterThan(60_000);
    expect(bigMs).toBeLessThanOrEqual(600);
    // 선형성: 두 배 문서가 3.5배를 넘지 않는다(파서 특성상 완전 선형은 아님)
    expect(bigMs / Math.max(halfMs, 1)).toBeLessThanOrEqual(3.5);

    // 같은 문서는 캐시에서 즉시 돌아온다
    const key = big + '#big1';
    countMarkdown(key);
    const q0 = performance.now();
    for (let k = 0; k < 50; k += 1) countMarkdown(key);
    expect((performance.now() - q0) / 50).toBeLessThanOrEqual(1);
  });
});

describe('AST 경계 회귀(코드리뷰봇 사례)', () => {
  it('링크·이미지·위키링크 안의 인라인 코드', () => {
    // 링크 표시 텍스트 안의 코드는 보이는 글자
    expect(visibleText('[보기 `코드`](https://example.com/very/long/url)')).toBe('보기 코드');
    expect(stats('[보기 `코드`](https://example.com/very/long/url)')).toEqual({ chars: 5, charsNoSpace: 4, words: 2 });
    // 이미지 대체 텍스트는 보이지 않는다
    expect(stats('![대체 `코드`](a.png)')).toEqual({ chars: 0, charsNoSpace: 0, words: 0 });
    // 위키링크는 별칭만(별칭 안 백틱은 이 문법에서 리터럴)
    expect(visibleText('[[노트|별칭 `코드`]]')).toBe('별칭 코드');
  });

  it('백틱 개수·줄 걸친 코드·들여쓴 코드·인용 안 펜스', () => {
    expect(stats('a`b`c')).toEqual({ chars: 3, charsNoSpace: 3, words: 1 }); // 화면에는 abc 로 보인다
    expect(visibleText('a`b`c')).toBe('abc');
    expect(stats('`줄\n바뀜`')).toEqual({ chars: 3, charsNoSpace: 3, words: 2 }); // 줄바꿈은 글자수에서 빠진다
    expect(stats('    들여쓴 코드\n')).toEqual({ chars: 6, charsNoSpace: 5, words: 2 });
    expect(visibleText('    들여쓴 코드\n').trim()).toBe('들여쓴 코드');
    expect(stats('> ```\n> 코드\n> ```\n')).toEqual({ chars: 2, charsNoSpace: 2, words: 1 });
  });

  it('frontmatter 안의 펜스는 본문에 영향을 주지 않는다', () => {
    expect(stats('---\ntitle: x\ncode: ```\n---\n[보기](https://x.y)')).toEqual({ chars: 2, charsNoSpace: 2, words: 1 });
  });

  it('중첩 인용 콜아웃도 표식만 빼고 제목·내용을 센다', () => {
    const md = '> > [!note] 제목\n> > 내용';
    expect(visibleText(md)).not.toContain('[!note]');
    expect(visibleText(md).trim()).toBe('제목\n내용'.trim());
    expect(stats(md)).toEqual({ chars: 4, charsNoSpace: 4, words: 2 });
  });
});
