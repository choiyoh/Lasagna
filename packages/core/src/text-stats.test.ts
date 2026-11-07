import { describe, expect, it } from 'vitest';
import { countMarkdown, countVisible, graphemeCount } from './text-stats.js';

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
    expect(stats('| a | b |\n|---|---|\n| 1 | 2 |')).toEqual({ chars: 6, charsNoSpace: 4, words: 4 });
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
    expect(countVisible(nfd)).toEqual(countVisible(nfc));
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
