import { describe, expect, it } from 'vitest';
import { splitUnits } from '../merge3.js';
import { assemble, parseNote, replaceBlock } from './parse.js';

import { generateNote as generate, randomGarbage } from '../testing/corpus.js';

function checkInvariants(src: string) {
  const note = parseNote(src);
  expect(assemble(note)).toBe(src);
  expect(splitUnits(src).join('')).toBe(src);
  let prev = note.frontmatter?.end ?? 0;
  for (const b of note.blocks) {
    expect(b.start).toBeGreaterThanOrEqual(prev);
    expect(b.end).toBeGreaterThan(b.start);
    expect(src.slice(b.start, b.end)).toBe(b.source);
    expect(b.lineEnd).toBeGreaterThanOrEqual(b.lineStart);
    // 같은 내용으로 교체해도 문서는 바뀌지 않는다
    expect(replaceBlock(note, b.index, b.source)).toBe(src);
    prev = b.end;
  }
  const lines = src.split('\n').length;
  for (const l of note.meta.links) {
    expect(l.line).toBeGreaterThanOrEqual(1);
    expect(l.line).toBeLessThanOrEqual(lines);
  }
}

describe('라운드트립 코퍼스', () => {
  it('합성 노트 500개가 바이트 단위로 보존된다', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const src = generate(seed);
      try {
        checkInvariants(src);
      } catch (e) {
        throw new Error(`seed ${seed} 실패\n${JSON.stringify(src)}\n${e instanceof Error ? e.message : e}`);
      }
    }
  });

  it('임의의 깨진 입력 3000개에서도 예외 없이 보존된다', () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const src = randomGarbage(seed);
      try {
        checkInvariants(src);
      } catch (e) {
        throw new Error(`garbage seed ${seed} 실패\n${JSON.stringify(src)}\n${e instanceof Error ? e.message : e}`);
      }
    }
  });
});

describe('각주 왕복 45가지', () => {
  const cases: [string, string][] = [
    ['기본 참조·정의', '본문[^1]\n\n[^1]: 각주\n'],
    ['연속 줄', '본문[^1]\n\n[^1]: 첫째\n    이어짐\n'],
    ['정의 없는 참조', '본문[^없음]\n'],
    ['안 쓰는 정의', '[^안씀]: 내용\n'],
    ['중복 정의', '본문[^1]\n\n[^1]: 하나\n\n[^1]: 둘\n'],
    ['참조가 정의보다 먼저', '앞 문단[^a]\n\n[^a]: 정의\n'],
    ['여러 줄 정의', '[^1]: 첫째\n    둘째\n    셋째\n'],
    ['각주 안 목록', '[^1]:\n    - 하나\n    - 둘\n'],
    ['각주 안 코드', '[^1]:\n    ```\n    code\n    ```\n'],
    ['각주 안 표', '[^1]:\n    | a | b |\n    | - | - |\n    | 1 | 2 |\n'],
    ['각주 안 제목', '[^1]:\n    ## 내부 제목\n'],
    ['정의 뒤 빈 줄 없음', '본문[^1]\n\n[^1]: 정의\n다음 문단\n'],
    ['이모지 라벨', '본문[^🙂]\n\n[^🙂]: 이모지\n'],
    ['파이프 라벨 표 밖', '본문[^a|b]\n\n[^a|b]: 파이프\n'],
    ['파이프 라벨 표 안', '| a[^a|b] |\n| --- |\n| x |\n\n[^a|b]: 표\n'],
    ['링크 참조 정의', '[text][ref]\n\n[ref]: https://example.com\n\n본문[^1]\n\n[^1]: 각주\n'],
    ['블록 ID', '본문 ^abc\n'],
    ['위키링크 안 캐럿', '[[a^b]]\n'],
    ['인라인 수식 캐럿', '$a^b$\n'],
    ['정규식', '/\\^\\[abc\\]/\n'],
    ['닫히지 않은 각주', '본문[^1\n'],
    ['빈 라벨', '본문[^]\n'],
    ['이스케이프', '\\[^1]\n'],
    ['코드 블록 안 각주', '```\n[^1]\n```\n'],
    ['인라인 코드 안 각주', '`[^1]`\n'],
    ['인용문 안 정의', '> [^1]: 인용\n'],
    ['목록 안 정의', '- [^1]: 목록\n'],
    ['표 셀 각주', '| a[^1] | b |\n| --- | --- |\n| x | y |\n\n[^1]: 표 셀\n'],
    ['BOM', '\ufeff본문[^1]\n\n[^1]: BOM\n'],
    ['CRLF 본문', '본문[^1]\r\n\r\n[^1]: CRLF\r\n'],
    ['CRLF 표', '| a[^1] |\r\n| --- |\r\n| x |\r\n\r\n[^1]: 표\r\n'],
    ['프런트매터', '---\ntitle: 각주\n---\n\n본문[^1]\n\n[^1]: 정의\n'],
    ['공백 라벨 원형', '본문[^Note One]\n\n[^Note One]: 정의\n'],
    ['대문자 라벨 원형', '본문[^ABC]\n\n[^ABC]: 정의\n'],
    ['한글 라벨 원형', '본문[^각주]\n\n[^각주]: 정의\n'],
    ['인라인 각주', '본문 ^[내용] 끝\n'],
    ['정의 안 빈 줄', '[^1]: 첫째\n\n    둘째\n'],
    ['같은 라벨 여러 참조', '본문[^1] 또[^1]\n\n[^1]: 정의\n'],
    ['빈 정의', '본문[^1]\n\n[^1]:\n'],
    ['두 칸 뒤 정의', '본문[^1]\n\n[^1]:  두 칸\n'],
    ['정의 없는 참조와 안 쓰는 정의', '본문[^없음]\n\n[^안씀]: 정의\n'],
    ['정의 뒤 다음 문단', '본문[^1]\n\n[^1]: 정의\n다음 문단\n'],
    ['정의만 있는 문서', '[^1]: 정의\n'],
    ['참조만 있는 문서', '본문[^1]\n'],
    ['여러 각주 혼합', '본문[^1] [^name] ^[인라인]\n\n[^1]: 하나\n\n[^name]: 이름\n'],
  ];

  for (const [name, src] of cases) {
    it(name, () => {
      checkInvariants(src);
    });
  }
});
