import { countMarkdown } from '@nopsidian/core';
import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from './md/document.js';
import type { Node as PMNode } from 'prosemirror-model';
import { editorSelectionStats, editorTotalStats } from './writer-stats.js';
import { countPlain } from '@nopsidian/core';

const docOf = (markdown: string): PMNode => parseDocument(markdown).doc as unknown as PMNode;

/** UI 가 실제로 쓰는 함수(에디터 총계)와 소스 총계를 비교한다. */
const DOCS: [string, string][] = [
  ['novel', '# 1화\n\n밤이 깊어지면 도시의 불빛이 하나씩 꺼지고, 서연은 창가에 앉았다.\n\n두 번째 문단입니다.\n'],
  ['columns', ':::columns\n:::column\n첫째\n:::\n:::column\n둘째\n:::\n:::\n'],
  ['nested columns', '::::columns\n::::column\n바깥\n:::columns\n:::column\n안쪽\n:::\n:::\n::::\n::::\n'],
  ['wiki', '본문 [[노트]] 와 [[노트|별칭]] 링크\n'],
  ['toggle', '## 접이식 {.toggle}\n\n숨은 내용\n'],
  ['footnote', '본문[^1]\n\n[^1]: 각주 내용\n'],
  ['hard break', '줄1  \n줄2\n'],
  ['table', '| a | b |\n|---|---|\n| 1 | 2 |\n'],
  ['math', '수식 $x^2$ 와 $$y$$\n'],
  ['image', '![[사진.png]] ![대체](a.png)\n'],
  ['code block', '```ts\nconst a = 1;\n```\n'],
  ['inline code', '본문 `const a = 1;` 코드\n'],
  ['list', '- 하나\n- 둘\n- 셋\n'],
  ['callout', '> [!note] 제목\n> 내용\n'],
  ['escape', '\\*별표\\* 와 \\# 제목\n'],
];

describe('에디터 총계 == 소스 총계(UI 함수 대상)', () => {
  it('여러 문서 모양에서 같은 값을 낸다', () => {
    const diffs: string[] = [];
    for (const [name, markdown] of DOCS) {
      const editor = editorTotalStats(docOf(markdown), null)!;
      const source = countMarkdown(markdown);
      if (editor.chars !== source.chars || editor.charsNoSpace !== source.charsNoSpace) {
        diffs.push(`${name}: editor=${JSON.stringify(editor)} source=${JSON.stringify(source)}`);
      }
    }
    expect(diffs).toEqual([]);
  });

  it('전체 선택은 총계와 항등, 임의 구간은 선택 ≤ 전체(클램프 없이도)', () => {
    for (const [name, markdown] of DOCS) {
      const doc = docOf(markdown);
      const size = doc.content.size;
      const total = editorTotalStats(doc, null)!;
      expect(editorSelectionStats(doc, 0, size, total)).toEqual(total);
      for (let from = 0; from <= size; from += 2) {
        for (let to = from; to <= size; to += 3) {
          const part = editorSelectionStats(doc, from, to, total);
          if (!part) continue;
          if (part.chars > total.chars || part.charsNoSpace > total.charsNoSpace) {
            throw new Error(`${name} ${from}..${to}: part=${JSON.stringify(part)} total=${JSON.stringify(total)}`);
          }
        }
      }
    }
  });

  it('직렬화 원문은 소스 마크다운과 같은 글자수를 낸다(왕복)', () => {
    for (const [name, markdown] of DOCS) {
      const round = serializeDocument(docOf(markdown), null);
      expect([name, countMarkdown(round)]).toEqual([name, countMarkdown(markdown)]);
    }
  });
});

describe('부분 선택 글자수(UI 함수) — 한 문단 안은 직렬화 없이 정확히', () => {
  /** 문단 텍스트에서 탐색 문자열의 시작 위치(문서 위치) */
  const posOf = (doc: PMNode, needle: string): { from: number; to: number } => {
    let found: { from: number; to: number } | null = null;
    doc.descendants((node, pos) => {
      if (found) return false;
      if (node.isText && node.text && node.text.includes(needle)) {
        const at = pos + (node.text.indexOf(needle) ?? 0);
        found = { from: at, to: at + needle.length };
        return false;
      }
      return true;
    });
    if (!found) throw new Error(`not found: ${needle}`);
    return found;
  };
  const sel = (markdown: string, needle: string, total?: ReturnType<typeof editorTotalStats>) => {
    const doc = docOf(markdown);
    const t = total ?? editorTotalStats(doc, null)!;
    const { from, to } = posOf(doc, needle);
    return { stats: editorSelectionStats(doc, from, to, t), total: t, from, to };
  };

  it('문단 안 1·3·5자 선택과 공백 포함/제외', () => {
    const md = '가나다라마바사아자차\\n';
    for (const [needle, chars] of [['가', 1], ['가나다', 3], ['가나다라마', 5]] as [string, number][]) {
      const { stats } = sel(md, needle);
      expect([needle, stats?.chars]).toEqual([needle, chars]);
      expect(stats?.charsNoSpace).toBe(chars);
    }
    // 공백 포함 구간
    const spaced = sel('가나 다라 마바\\n', '나 다');
    expect(spaced.stats).toMatchObject({ chars: 3, charsNoSpace: 2 });
  });

  it('굵게·링크·위키링크·이모지·NFD 가 섞인 구간', () => {
    const md = '**굵게** [링크](https://x.y) [[노트|별칭]] 😀\\n';
    expect(sel(md, '굵게').stats?.chars).toBe(2);
    expect(sel(md, '링크').stats?.chars).toBe(2);
    expect(sel(md, '😀').stats?.chars).toBe(1);
    const nfd = '한글'.normalize('NFD');
    expect(sel(`${nfd}\\n`, nfd).stats?.chars).toBe(2);
  });

  it('두 문단·제목+문단·목록 항목·표 셀·코드 블록 선택', () => {
    // 여러 블록에 걸친 선택은 블록 구분자 텍스트 기준(정의)
    const cross = sel('첫 문단\\n\\n둘째 문단\\n', '문단');
    expect(cross.stats?.chars).toBe(2);
    const head = sel('# 제목\\n\\n본문\\n', '제목');
    expect(head.stats?.chars).toBe(2);
    expect(sel('- 항목 하나\\n', '항목').stats?.chars).toBe(2);
    expect(sel('| a | b |\n|---|---|\n| 1 | 2 |\n', 'a').stats?.chars).toBe(1);
    expect(sel('```\nconst a = 1;\n```\n', 'a = 1').stats?.chars).toBe(5);
  });

  it('전체 선택 후 일부만 남기기 — 남긴 글자수 그대로', () => {
    const md = '가나다라마바사아자차\\n';
    const doc = docOf(md);
    const total = editorTotalStats(doc, null)!;
    expect(editorSelectionStats(doc, 0, doc.content.size, total)).toEqual(total);
    const { from, to } = posOf(doc, '가나다');
    expect(editorSelectionStats(doc, from, to, total)?.chars).toBe(3);
  });

  it('퍼징: 문단 안 임의 구간의 선택 글자수 == 그 텍스트의 글자수', () => {
    const md = '가나다라 마바사 **굵게** [링크](https://x.y) 😀 abc\\n';
    const doc = docOf(md);
    const total = editorTotalStats(doc, null)!;
    const size = doc.content.size;
    for (let from = 0; from < size - 4; from += 1) {
      for (let len = 1; len <= 5; len += 1) {
        const to = from + len;
        if (to > size) continue;
        const stats = editorSelectionStats(doc, from, to, total);
        if (!stats) continue;
        const expected = countPlain(doc.textBetween(from, to, '\n', ''));
        expect([from, to, stats.chars]).toEqual([from, to, expected.chars]);
      }
    }
  });
});
