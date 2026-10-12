import { describe, expect, it } from 'vitest';
import { linkMention } from './mention-link';

/**
 * 변경 전후를 비교해 **정확히 한 구간만** 바뀌었고 그 구간이 `from` → `to`인지 확인한다.
 * 나머지 바이트는 그대로여야 한다(CRLF 보존까지 이 단언으로 함께 본다).
 */
function expectSingleEdit(before: string, after: string, from: string, to: string) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  expect(before.slice(start, endBefore)).toBe(from);
  expect(after.slice(start, endAfter)).toBe(to);
  // 바뀐 구간 앞뒤가 그대로 이어 붙여졌는지(삽입·삭제 없음)까지 확인
  expect(before.slice(0, start) + to + before.slice(endBefore)).toBe(after);
}

describe('linkMention', () => {
  it('글자 그대로가 대상 이름과 같으면 [[대상]]으로 바꾼다', () => {
    const before = '머리말\n\n클린 코드를 읽는다\n꼬리말\n';
    const r = linkMention(before, { line: 3, terms: ['클린 코드'], target: '클린 코드' });
    expect(r.changed).toBe(true);
    expect(r.replaced).toBe('클린 코드');
    expect(r.content).toBe('머리말\n\n[[클린 코드]]를 읽는다\n꼬리말\n');
    expectSingleEdit(before, r.content, '클린 코드', '[[클린 코드]]');
  });

  it('조사가 붙은 출현도 인식한다', () => {
    const before = '리팩터링은 좋다\n';
    const r = linkMention(before, { line: 1, terms: ['리팩터링'], target: '리팩터링' });
    expect(r.content).toBe('[[리팩터링]]은 좋다\n');
  });

  it('대소문자가 다르면 별칭 형태로 바꾸고 원래 글자를 replaced로 돌려준다', () => {
    const before = 'clean code 를 읽는다\n';
    const r = linkMention(before, { line: 1, terms: ['Clean Code'], target: 'Clean Code' });
    expect(r.changed).toBe(true);
    expect(r.replaced).toBe('clean code');
    expect(r.content).toBe('[[Clean Code|clean code]] 를 읽는다\n');
    expectSingleEdit(before, r.content, 'clean code', '[[Clean Code|clean code]]');
  });

  it('블록 안의 첫 번째 출현만 바꾼다', () => {
    const before = '클린 코드 그리고 클린 코드\n';
    const r = linkMention(before, { line: 1, terms: ['클린 코드'], target: '클린 코드' });
    expect(r.content).toBe('[[클린 코드]] 그리고 클린 코드\n');
    expectSingleEdit(before, r.content, '클린 코드', '[[클린 코드]]');
  });

  it('여러 terms 중 블록에서 가장 앞에 나오는 출현을 쓴다', () => {
    const before = '별칭 코드는 좋다\n';
    const r = linkMention(before, {
      line: 1,
      terms: ['클린 코드', '별칭 코드'],
      target: '클린 코드',
    });
    expect(r.replaced).toBe('별칭 코드');
    expect(r.content).toBe('[[클린 코드|별칭 코드]]는 좋다\n');
  });

  it('같은 위치면 더 긴 말을 쓴다', () => {
    const before = '클린 코드를 읽는다\n';
    const r = linkMention(before, { line: 1, terms: ['클린', '클린 코드'], target: '클린 코드' });
    expect(r.replaced).toBe('클린 코드');
    expect(r.content).toBe('[[클린 코드]]를 읽는다\n');
  });

  it('코드 블록·수식·HTML 블록은 건너뛴다', () => {
    const before = '```\n클린 코드\n```\n\n$$\n클린 코드\n$$\n\n<div>클린 코드</div>\n';
    for (const line of [2, 5, 8]) {
      const r = linkMention(before, { line, terms: ['클린 코드'], target: '클린 코드' });
      expect(r).toEqual({ content: before, changed: false });
    }
  });

  it('인라인 코드 안은 건너뛰고 그 뒤의 진짜 출현을 바꾼다', () => {
    const before = '`클린 코드` 그리고 클린 코드\n';
    const r = linkMention(before, { line: 1, terms: ['클린 코드'], target: '클린 코드' });
    expect(r.replaced).toBe('클린 코드');
    expect(r.content).toBe('`클린 코드` 그리고 [[클린 코드]]\n');
    expectSingleEdit(before, r.content, '클린 코드', '[[클린 코드]]');
  });

  it('이미 링크된 같은 말은 건드리지 않고 뒤의 출현을 바꾼다', () => {
    const before = '[[클린 코드]]와 클린 코드\n';
    const r = linkMention(before, { line: 1, terms: ['클린 코드'], target: '클린 코드' });
    expect(r.content).toBe('[[클린 코드]]와 [[클린 코드]]\n');
    expectSingleEdit(before, r.content, '클린 코드', '[[클린 코드]]');

    const embedded = '![[클린 코드]] 그리고 클린 코드\n';
    const r2 = linkMention(embedded, { line: 1, terms: ['클린 코드'], target: '클린 코드' });
    expect(r2.content).toBe('![[클린 코드]] 그리고 [[클린 코드]]\n');
  });

  it('마크다운 링크 안은 건너뛰고 뒤의 출현을 바꾼다', () => {
    const before = '[클린 코드](독서/클린%20코드.md) 그리고 클린 코드\n';
    const r = linkMention(before, { line: 1, terms: ['클린 코드'], target: '독서/클린 코드' });
    expect(r.content).toBe(
      '[클린 코드](독서/클린%20코드.md) 그리고 [[독서/클린 코드|클린 코드]]\n',
    );
    expectSingleEdit(before, r.content, '클린 코드', '[[독서/클린 코드|클린 코드]]');
  });

  it('출현이 없거나 줄이 블록에 속하지 않으면 바꾸지 않는다', () => {
    const before = '머리말\n\n클린 코드를 읽는다\n';
    expect(linkMention(before, { line: 1, terms: ['없는 말'], target: '없는 말' })).toEqual({
      content: before,
      changed: false,
    });
    // 빈 줄(2)과 범위 밖(99)
    for (const line of [2, 99]) {
      expect(linkMention(before, { line, terms: ['머리말'], target: '머리말' })).toEqual({
        content: before,
        changed: false,
      });
    }
  });

  it('프런트매터가 있어도 파일 전체 기준 줄 번호를 쓴다', () => {
    const before = '---\ntitle: x\n---\n# 제목\n\n클린 코드를 읽는다\n';
    const r = linkMention(before, { line: 6, terms: ['클린 코드'], target: '클린 코드' });
    expect(r.content).toBe('---\ntitle: x\n---\n# 제목\n\n[[클린 코드]]를 읽는다\n');
    expectSingleEdit(before, r.content, '클린 코드', '[[클린 코드]]');
    // 프런트매터 안의 줄은 속한 블록이 없다
    expect(linkMention(before, { line: 2, terms: ['x'], target: 'x' })).toEqual({
      content: before,
      changed: false,
    });
  });

  it('CRLF와 나머지 바이트를 그대로 둔다', () => {
    const before = '제목\r\n\r\n클린 코드를 읽는다\r\n끝\r\n';
    const r = linkMention(before, { line: 3, terms: ['클린 코드'], target: '클린 코드' });
    expect(r.content).toBe('제목\r\n\r\n[[클린 코드]]를 읽는다\r\n끝\r\n');
    expectSingleEdit(before, r.content, '클린 코드', '[[클린 코드]]');
  });

  it('표 안에서 별칭 형태가 필요하면 |를 이스케이프한다', () => {
    const before = '| 이름 | 설명 |\n| --- | --- |\n| clean code | 좋은 책 |\n';
    const r = linkMention(before, { line: 3, terms: ['Clean Code'], target: 'Clean Code' });
    expect(r.changed).toBe(true);
    expect(r.replaced).toBe('clean code');
    expect(r.content).toBe(
      '| 이름 | 설명 |\n| --- | --- |\n| [[Clean Code\\|clean code]] | 좋은 책 |\n',
    );
    expectSingleEdit(before, r.content, 'clean code', '[[Clean Code\\|clean code]]');
  });

  it('표에서 글자 그대로가 대상과 같으면 이스케이프 없이 [[대상]]으로 쓴다', () => {
    const before = '| 이름 | 설명 |\n| --- | --- |\n| 클린 코드 | 좋은 책 |\n';
    const r = linkMention(before, { line: 3, terms: ['클린 코드'], target: '클린 코드' });
    expect(r.content).toBe('| 이름 | 설명 |\n| --- | --- |\n| [[클린 코드]] | 좋은 책 |\n');
  });

  it('위험한 문자(|, #, [, ])가 든 대상 이름으로는 바꾸지 않는다', () => {
    const before = '제목 # 태그를 읽는다\n';
    for (const target of ['제목 # 태그', 'a|b', '[x]', 'x]y']) {
      expect(linkMention(before, { line: 1, terms: ['제목'], target })).toEqual({
        content: before,
        changed: false,
      });
    }
    // 대상 이름이 비어 있어도 바꾸지 않는다
    expect(linkMention(before, { line: 1, terms: ['제목'], target: '' })).toEqual({
      content: before,
      changed: false,
    });
  });

  it('앞뒤가 글자·숫자로 붙은 출현은 멘션으로 보지 않는다', () => {
    const before = '슈퍼클린 코드와 클린 코드!\n';
    const r = linkMention(before, { line: 1, terms: ['클린 코드'], target: '클린 코드' });
    expect(r.replaced).toBe('클린 코드');
    expect(r.content).toBe('슈퍼클린 코드와 [[클린 코드]]!\n');
  });
});
