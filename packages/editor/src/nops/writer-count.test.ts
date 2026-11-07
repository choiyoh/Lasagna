import { countMarkdown, countPlain } from '@nopsidian/core';
import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from './md/document.js';

/** 편집 모드(에디터 문서 → 마크다운)와 소스 모드(원문)가 **같은 글자수**를 내는지 확인한다. */
const roundTrip = (markdown: string): string => {
  const parsed = parseDocument(markdown);
  return serializeDocument(parsed.doc as never, null);
};

const CASES: [string, string][] = [
  ['heading', '# 제목\n\n본문 문장입니다.\n'],
  ['list', '- 하나\n- 둘\n- 셋\n'],
  ['code', '```ts\nconst a = 1; // 주석\n```\n'],
  ['inline code', '`**그대로** # 아님` 그리고 본문\n'],
  ['callout', '> [!note] 제목\n> 내용 `코드`\n'],
  ['table', '| a | b |\n|---|---|\n| 1 | 2 |\n'],
  ['math', '수식 $x^2$ 과 $$y = 2$$\n'],
  ['link', '[보기](https://example.com/very/long/url) 와 [[노트|별칭]]\n'],
  ['image', '![[사진.png]] ![대체](a.png)\n'],
  ['toggle', '## 접이식 {.toggle}\n\n숨은 내용\n'],
  ['columns', ':::columns\n:::column\n첫째 열\n:::\n:::column\n둘째 열\n:::\n:::\n'],
  ['nested columns', '::::columns\n::::column\n바깥\n:::columns\n:::column\n안쪽\n:::\n:::\n::::\n::::\n'],
  ['footnote', '본문[^1]\n\n[^1]: 각주 내용\n'],
];

describe('편집 모드·소스 모드 글자수 동일', () => {
  it('여러 문서 모양에서 두 경로가 같은 값을 낸다', () => {
    const mismatches: string[] = [];
    for (const [name, markdown] of CASES) {
      const source = countMarkdown(markdown);
      const editor = countMarkdown(roundTrip(markdown));
      if (source.chars !== editor.chars || source.charsNoSpace !== editor.charsNoSpace || source.words !== editor.words) {
        mismatches.push(`${name}: source=${JSON.stringify(source)} editor=${JSON.stringify(editor)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe('에디터 모드 선택 ≤ 전체(퍼징)', () => {
  const DOCS = [
    '# 제목\n\n본문 [보기](https://x.y) 와 [[노트|별칭]]\n',
    '| a | b |\n|---|---|\n| 1 | 2 |\n',
    '- 하나\n  - 둘\n',
    '> [!note] 제목\n> 내용\n',
    ':::columns\n:::column\n첫째\n:::\n:::column\n둘째\n:::\n:::\n',
    '## 접이식 {.toggle}\n\n숨은 내용\n',
    '수식 $x^2$ 와 $$y$$\n',
    '본문[^1]\n\n[^1]: 각주 내용\n',
    '![[사진.png]] ![대체](a.png)\n',
    '```ts\nconst a = 1;\n```\n',
  ];

  it('임의 구간 선택이 전체를 넘지 않고, 전체 선택은 전체와 같다', () => {
    for (const markdown of DOCS) {
      const doc = parseDocument(markdown).doc as never as { textBetween(from: number, to: number, sep?: string): string; content: { size: number } };
      const size = doc.content.size;
      const total = countPlain(doc.textBetween(0, size, '\n'));
      const full = countPlain(doc.textBetween(0, size, '\n'));
      expect({ chars: full.chars, charsNoSpace: full.charsNoSpace }).toEqual({ chars: total.chars, charsNoSpace: total.charsNoSpace });
      for (let from = 0; from <= size; from += 3) {
        for (let to = from; to <= size; to += 7) {
          const part = countPlain(doc.textBetween(from, to, '\n'));
          expect(part.chars).toBeLessThanOrEqual(total.chars);
          expect(part.charsNoSpace).toBeLessThanOrEqual(total.charsNoSpace);
        }
      }
    }
  });
});
