import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import {
  blockAt,
  canTurnInto,
  deleteBlock,
  dropToColumns,
  duplicateBlock,
  moveBlock,
  normalizeColumns,
  turnInto,
} from '../src/nops/blocks';
import { parseDocument, serializeDocument } from '../src/nops/md';

function stateOf(src: string) {
  const { doc } = parseDocument(src);
  return EditorState.create({ doc });
}

/** 문서에서 `text`를 포함한 첫 텍스트블록의 블록 참조 */
function blockWith(state: EditorState, text: string) {
  let pos = -1;
  state.doc.descendants((n, p) => {
    if (pos < 0 && n.isTextblock && n.textContent.includes(text)) pos = p + 1;
    return pos < 0;
  });
  if (pos < 0) throw new Error(`"${text}" 없음`);
  return blockAt(state.doc.resolve(pos))!;
}

const md = (state: EditorState) => serializeDocument(state.doc, null);
const apply = (state: EditorState, tr: ReturnType<typeof duplicateBlock> | null) => {
  if (!tr) throw new Error('트랜잭션 없음');
  return state.apply(tr);
};

describe('blockAt', () => {
  it('문단 / 제목 / 목록 항목(첫 문단은 항목 대표) / 콜아웃 제목은 콜아웃 / 표 안은 표', () => {
    const s = stateOf('# 제목\n\n문단\n\n- 항목1\n- 항목2\n\n> [!note] 콜아웃 제목\n> 본문\n\n| 셀A | 셀B |\n| - | - |\n| 셀C | 셀D |\n');
    expect(blockWith(s, '제목').node.type.name).toBe('heading');
    expect(blockWith(s, '문단').node.type.name).toBe('paragraph');
    expect(blockWith(s, '항목1').node.type.name).toBe('list_item');
    expect(blockWith(s, '콜아웃 제목').node.type.name).toBe('callout');
    expect(blockWith(s, '본문').node.type.name).toBe('paragraph');
    expect(blockWith(s, '셀C').node.type.name).toBe('table');
  });
});

describe('복제 / 삭제', () => {
  it('복제하면 바로 뒤에 같은 블록이 생기고 블록 ID는 지워진다', () => {
    const s0 = stateOf('앞\n\n내용 ^abc\n\n뒤\n');
    const s1 = apply(s0, duplicateBlock(s0, blockWith(s0, '내용')));
    expect(md(s1)).toBe('앞\n\n내용 ^abc\n\n내용\n\n뒤\n');
  });

  it('목록 항목 복제', () => {
    const s0 = stateOf('- a\n- b\n');
    const s1 = apply(s0, duplicateBlock(s0, blockWith(s0, 'a')));
    expect(md(s1)).toBe('- a\n- a\n- b\n');
  });

  it('삭제: 목록의 마지막 항목을 지우면 목록도 사라진다', () => {
    const s0 = stateOf('앞\n\n- 혼자\n\n뒤\n');
    const s1 = apply(s0, deleteBlock(s0, blockWith(s0, '혼자')));
    expect(md(s1)).toBe('앞\n\n뒤\n');
    expect(() => s1.doc.check()).not.toThrow();
  });

  it('삭제: 문서의 유일한 블록을 지워도 유효한 문서가 남는다', () => {
    const s0 = stateOf('혼자\n');
    const s1 = apply(s0, deleteBlock(s0, blockWith(s0, '혼자')));
    expect(() => s1.doc.check()).not.toThrow();
    expect(s1.doc.childCount).toBe(1);
  });
});

describe('이동', () => {
  it('위/아래로 한 칸 이동하고 끝에서는 null', () => {
    const s0 = stateOf('가\n\n나\n\n다\n');
    const down = apply(s0, moveBlock(s0, blockWith(s0, '가'), 1));
    expect(md(down)).toBe('나\n\n가\n\n다\n');
    expect(moveBlock(s0, blockWith(s0, '가'), -1)).toBeNull();
    expect(moveBlock(s0, blockWith(s0, '다'), 1)).toBeNull();
    const up = apply(s0, moveBlock(s0, blockWith(s0, '다'), -1));
    expect(md(up)).toBe('가\n\n다\n\n나\n');
  });

  it('목록 항목은 같은 목록 안에서 이동한다', () => {
    const s0 = stateOf('- a\n- b\n- c\n');
    const s1 = apply(s0, moveBlock(s0, blockWith(s0, 'c'), -1));
    expect(md(s1)).toBe('- a\n- c\n- b\n');
  });

  it('콜아웃 제목 위로는 올라가지 않는다', () => {
    const s0 = stateOf('> [!note] 제목\n> 본문\n');
    expect(moveBlock(s0, blockWith(s0, '본문'), -1)).toBeNull();
  });
});

describe('블록 종류 바꾸기', () => {
  const conv = (src: string, text: string, kind: Parameters<typeof turnInto>[2]) => {
    const s0 = stateOf(src);
    const ref = blockWith(s0, text);
    const s1 = apply(s0, turnInto(s0, ref, kind));
    expect(() => s1.doc.check()).not.toThrow();
    return md(s1);
  };

  it('문단 → 제목/코드/목록/인용/콜아웃/토글', () => {
    expect(conv('내용 **굵게**\n', '내용', 'h2')).toBe('## 내용 **굵게**\n');
    expect(conv('내용\n', '내용', 'code')).toBe('```\n내용\n```\n');
    expect(conv('내용\n', '내용', 'bullet')).toBe('- 내용\n');
    expect(conv('내용\n', '내용', 'ordered')).toBe('1. 내용\n');
    expect(conv('내용\n', '내용', 'todo')).toBe('- [ ] 내용\n');
    expect(conv('내용\n', '내용', 'quote')).toBe('> 내용\n');
    expect(conv('내용\n', '내용', 'callout')).toBe('> [!note] 내용\n');
    expect(conv('내용\n', '내용', 'toggle')).toBe('> [!toggle]+ 내용\n');
  });

  it('제목 → 문단, 코드 → 문단(서식 없는 텍스트)', () => {
    expect(conv('## 제목\n', '제목', 'paragraph')).toBe('제목\n');
    expect(conv('```\nx = 1\n```\n', 'x = 1', 'paragraph')).toBe('x = 1\n');
  });

  it('목록 항목: 글머리 ↔ 번호 ↔ 할 일, 항목을 꺼내 일반 블록으로', () => {
    expect(conv('- a\n- b\n', 'a', 'ordered')).toBe('1. a\n2. b\n');
    expect(conv('- a\n- b\n', 'b', 'todo')).toBe('- a\n- [ ] b\n');
    expect(conv('- a\n- b\n- c\n', 'b', 'h1')).toBe('- a\n\n# b\n\n- c\n');
    expect(conv('- 혼자\n', '혼자', 'paragraph')).toBe('혼자\n');
  });

  it('바꿀 수 없는 조합은 거부한다', () => {
    const s = stateOf('> [!note] 제목\n> 본문\n\n---\n');
    expect(canTurnInto(blockWith(s, '본문'), 'paragraph')).toBe(false);
    expect(turnInto(s, blockWith(s, '제목'), 'h1')).toBeNull();
  });
});

describe('좌우 드롭으로 열 만들기', () => {
  const srcRange = (state: EditorState, ref: ReturnType<typeof blockWith>) => ({ from: ref.pos, to: ref.pos + ref.node.nodeSize });

  it('블록을 다른 블록의 오른쪽/왼쪽에 놓으면 두 열이 된다', () => {
    const s0 = stateOf('가\n\n나\n\n다\n');
    const dragged = blockWith(s0, '다');
    const s1 = apply(s0, dropToColumns(s0, srcRange(s0, dragged), blockWith(s0, '가'), 'right'));
    expect(md(s1)).toBe('::::columns\n\n:::column\n\n가\n\n:::\n\n:::column\n\n다\n\n:::\n\n::::\n\n나\n');
    const s2 = apply(s0, dropToColumns(s0, srcRange(s0, dragged), blockWith(s0, '가'), 'left'));
    expect(md(s2)).toBe('::::columns\n\n:::column\n\n다\n\n:::\n\n:::column\n\n가\n\n:::\n\n::::\n\n나\n');
    expect(() => s2.doc.check()).not.toThrow();
  });

  it('위쪽에 있는 블록을 아래 블록 옆으로 옮겨도 위치가 어긋나지 않는다', () => {
    const s0 = stateOf('가\n\n나\n\n다\n');
    const s1 = apply(s0, dropToColumns(s0, srcRange(s0, blockWith(s0, '가')), blockWith(s0, '다'), 'right'));
    expect(md(s1)).toBe('나\n\n::::columns\n\n:::column\n\n다\n\n:::\n\n:::column\n\n가\n\n:::\n\n::::\n');
  });

  it('이미 있는 열 옆에 놓으면 열이 하나 늘고, 5열이면 거부한다', () => {
    const cols = (n: number) =>
      '::::columns\n\n' + Array.from({ length: n }, (_, i) => `:::column\n\nc${i}\n\n:::\n\n`).join('') + '::::\n\n밖\n';
    const s0 = stateOf(cols(2));
    const s1 = apply(s0, dropToColumns(s0, srcRange(s0, blockWith(s0, '밖')), blockWith(s0, 'c1'), 'right'));
    const columns = s1.doc.child(0);
    expect(columns.childCount).toBe(3);
    expect(columns.child(2).textContent).toBe('밖');
    const s5 = stateOf(cols(5));
    expect(dropToColumns(s5, srcRange(s5, blockWith(s5, '밖')), blockWith(s5, 'c0'), 'left')).toBeNull();
  });

  it('자기 자신 옆에는 놓을 수 없다', () => {
    const s0 = stateOf('가\n\n나\n');
    const r = blockWith(s0, '가');
    expect(dropToColumns(s0, srcRange(s0, r), r, 'right')).toBeNull();
  });

  it('목록 항목을 열 옆으로 옮기면 목록으로 감싸서 들어간다', () => {
    const s0 = stateOf('문단\n\n- a\n- b\n');
    const s1 = apply(s0, dropToColumns(s0, srcRange(s0, blockWith(s0, 'b')), blockWith(s0, '문단'), 'right'));
    expect(() => s1.doc.check()).not.toThrow();
    expect(md(s1)).toContain('- b');
    expect(md(s1)).toContain('- a');
  });
});

describe('열 정리', () => {
  it('열 안의 마지막 블록이 빠져나가 비게 되면 그 열을 지우고, 하나 남으면 열을 푼다', () => {
    const s0 = stateOf('::::columns\n\n:::column\n\n왼\n\n:::\n\n:::column\n\n오\n\n:::\n\n::::\n');
    const ref = blockWith(s0, '왼');
    const tr = deleteBlock(s0, ref); // 열이 비어 사라진다
    const s1 = s0.apply(tr);
    const fix = normalizeColumns(s1);
    const s2 = fix ? s1.apply(fix) : s1;
    expect(md(s2)).toBe('오\n');
    expect(() => s2.doc.check()).not.toThrow();
  });

  it('일부러 만든 빈 열은 건드리지 않는다(이동/삭제 뒤에만 호출하므로) — 그래도 비지 않은 열이 2개 이상이면 변화 없음', () => {
    const s0 = stateOf('::::columns\n\n:::column\n\n왼\n\n:::\n\n:::column\n\n오\n\n:::\n\n::::\n');
    expect(normalizeColumns(s0)).toBeNull();
  });
});

describe('선택 보존', () => {
  it('복제 후 커서는 복제본 안에 있다', () => {
    const s0 = stateOf('가\n');
    const s1 = apply(s0, duplicateBlock(s0, blockWith(s0, '가')));
    expect(s1.selection instanceof TextSelection).toBe(true);
    const $from = s1.selection.$from;
    expect($from.parent.textContent).toBe('가');
    expect($from.index(0)).toBe(1);
  });
});

void (null as unknown as PMNode);
