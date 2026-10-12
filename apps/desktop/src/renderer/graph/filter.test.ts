import { describe, expect, it } from 'vitest';
import {
  colorForNode,
  filterNodes,
  matchesQuery,
  parseGraphQuery,
  type ColorGroup,
  type FilterNode,
} from './filter';

const note: FilterNode = {
  id: '내 폴더/클린 코드.md',
  kind: 'note',
  label: '클린 코드',
  folder: '내 폴더',
  tags: ['프로젝트/알파', '책'],
};

const rootNote: FilterNode = {
  id: '메모.md',
  kind: 'note',
  label: 'Clean Code',
  folder: '',
  tags: ['초안'],
};

const tagNode: FilterNode = {
  id: '#프로젝트/알파',
  kind: 'tag',
  label: '프로젝트/알파',
  folder: '',
  tags: [],
};

const unresolved: FilterNode = {
  id: '?클린 코드',
  kind: 'unresolved',
  label: '클린 코드',
  folder: '',
  tags: [],
};

describe('parseGraphQuery', () => {
  it('공백으로 항을 나누고 접두어 없는 항은 label(field null)로 둔다', () => {
    expect(parseGraphQuery('클린 코드')).toEqual({
      terms: [
        { negate: false, field: null, value: '클린' },
        { negate: false, field: null, value: '코드' },
      ],
    });
  });

  it('따옴표로 묶으면 공백 포함 한 항', () => {
    expect(parseGraphQuery('"클린 코드"')).toEqual({
      terms: [{ negate: false, field: null, value: '클린 코드' }],
    });
  });

  it('필드 접두어와 부정, 따옴표 값을 분해한다', () => {
    expect(parseGraphQuery('-tag:초안').terms).toEqual([
      { negate: true, field: 'tag', value: '초안' },
    ]);
    expect(parseGraphQuery('tag:#초안').terms).toEqual([
      { negate: false, field: 'tag', value: '#초안' },
    ]);
    expect(parseGraphQuery('path:"내 폴더"').terms).toEqual([
      { negate: false, field: 'path', value: '내 폴더' },
    ]);
    expect(parseGraphQuery('kind:note').terms).toEqual([
      { negate: false, field: 'kind', value: 'note' },
    ]);
  });

  it('알 수 없는 접두어는 통째로 label 항', () => {
    expect(parseGraphQuery('foo:bar').terms).toEqual([
      { negate: false, field: null, value: 'foo:bar' },
    ]);
    expect(parseGraphQuery('12:30').terms).toEqual([
      { negate: false, field: null, value: '12:30' },
    ]);
  });

  it('닫히지 않은 따옴표는 끝까지를 한 항으로 본다', () => {
    expect(parseGraphQuery('"클린 코드').terms).toEqual([
      { negate: false, field: null, value: '클린 코드' },
    ]);
    expect(parseGraphQuery('path:"내 폴더').terms).toEqual([
      { negate: false, field: 'path', value: '내 폴더' },
    ]);
  });

  it('빈 값 항과 공백뿐인 질의는 항이 없다', () => {
    expect(parseGraphQuery('tag:').terms).toEqual([]);
    expect(parseGraphQuery('-tag:').terms).toEqual([]);
    expect(parseGraphQuery('   ').terms).toEqual([]);
    expect(parseGraphQuery('').terms).toEqual([]);
  });
});

describe('matchesQuery — label', () => {
  it('부분 일치, 대소문자 무시, 한글 그대로', () => {
    expect(matchesQuery(note, '린 코')).toBe(true);
    expect(matchesQuery(rootNote, 'clean')).toBe(true);
    expect(matchesQuery(rootNote, 'CODE')).toBe(true);
    expect(matchesQuery(note, '없는말')).toBe(false);
  });

  it('여러 항은 AND', () => {
    expect(matchesQuery(note, '클린 코드')).toBe(true);
    expect(matchesQuery(note, '클린 없는말')).toBe(false);
  });

  it('알 수 없는 접두어는 label 전체에 부분 일치시킨다', () => {
    const node: FilterNode = { ...rootNote, label: 'foo:bar 메모' };
    expect(matchesQuery(node, 'foo:bar')).toBe(true);
    expect(matchesQuery(rootNote, 'foo:bar')).toBe(false);
  });
});

describe('matchesQuery — tag', () => {
  it('정확 일치와 하위 태그 접두 일치', () => {
    expect(matchesQuery(note, 'tag:책')).toBe(true);
    expect(matchesQuery(note, 'tag:프로젝트')).toBe(true);
    expect(matchesQuery(note, 'tag:프로젝트/알파')).toBe(true);
    expect(matchesQuery(note, 'tag:알파')).toBe(false);
    expect(matchesQuery(note, 'tag:프로젝트/베타')).toBe(false);
  });

  it('tag:#x 형태의 # 도 허용', () => {
    expect(matchesQuery(note, 'tag:#책')).toBe(true);
    expect(matchesQuery(note, 'tag:#프로젝트')).toBe(true);
  });

  it('태그 노드는 자기 id 가 같은 규칙으로 맞으면 일치', () => {
    expect(matchesQuery(tagNode, 'tag:프로젝트')).toBe(true);
    expect(matchesQuery(tagNode, 'tag:#프로젝트/알파')).toBe(true);
    expect(matchesQuery(tagNode, 'tag:알파')).toBe(false);
    expect(matchesQuery(tagNode, 'tag:책')).toBe(false);
  });

  it('미해결 노드는 tag 질의에 맞지 않는다', () => {
    expect(matchesQuery(unresolved, 'tag:클린')).toBe(false);
  });
});

describe('matchesQuery — path/folder/file', () => {
  it('path 는 노트 경로에만 부분 일치', () => {
    expect(matchesQuery(note, 'path:"내 폴더"')).toBe(true);
    expect(matchesQuery(note, 'path:폴더/클린 코드')).toBe(true);
    expect(matchesQuery(rootNote, 'path:메모')).toBe(true);
    expect(matchesQuery(note, 'path:메모')).toBe(false);
    expect(matchesQuery(tagNode, 'path:프로젝트')).toBe(false);
    expect(matchesQuery(unresolved, 'path:클린')).toBe(false);
  });

  it('folder 는 같은 폴더이거나 하위 폴더일 때만 일치', () => {
    expect(matchesQuery(note, 'folder:"내 폴더"')).toBe(true);
    expect(matchesQuery(note, 'folder:내')).toBe(false);
    expect(matchesQuery(rootNote, 'folder:메모')).toBe(false);
    expect(matchesQuery(note, 'folder:"다른 폴더"')).toBe(false);
    expect(matchesQuery(tagNode, 'folder:"내 폴더"')).toBe(false);
  });

  it('file 은 확장자를 뗀 마지막 경로 조각에 부분 일치', () => {
    expect(matchesQuery(note, 'file:"클린 코드"')).toBe(true);
    expect(matchesQuery(note, 'file:코드')).toBe(true);
    expect(matchesQuery(note, 'file:.md')).toBe(false);
    expect(matchesQuery(note, 'file:메모')).toBe(false);
    expect(matchesQuery(tagNode, 'file:알파')).toBe(false);
    expect(matchesQuery(unresolved, 'file:클린')).toBe(false);
  });
});

describe('matchesQuery — kind, 부정, 빈 질의', () => {
  it('kind 는 종류가 같을 때 일치', () => {
    expect(matchesQuery(note, 'kind:note')).toBe(true);
    expect(matchesQuery(tagNode, 'kind:note')).toBe(false);
    expect(matchesQuery(tagNode, 'kind:tag')).toBe(true);
    expect(matchesQuery(unresolved, 'kind:unresolved')).toBe(true);
  });

  it('부정 항은 일치하지 않아야 통과', () => {
    expect(matchesQuery(rootNote, '-tag:초안')).toBe(false);
    expect(matchesQuery(note, '-tag:초안')).toBe(true);
    expect(matchesQuery(note, '-path:"내 폴더"')).toBe(false);
    expect(matchesQuery(tagNode, '-path:"내 폴더"')).toBe(true);
    expect(matchesQuery(unresolved, '-tag:초안')).toBe(true);
  });

  it('빈 질의(공백만)는 모두 일치', () => {
    for (const node of [note, rootNote, tagNode, unresolved]) {
      expect(matchesQuery(node, '   ')).toBe(true);
      expect(matchesQuery(node, '')).toBe(true);
    }
  });

  it('이미 파싱한 질의도 받는다', () => {
    const parsed = parseGraphQuery('tag:책 -path:메모');
    expect(matchesQuery(note, parsed)).toBe(true);
    expect(matchesQuery(rootNote, parsed)).toBe(false);
  });
});

describe('colorForNode', () => {
  const groups: ColorGroup[] = [
    { query: 'tag:초안', color: '#888' },
    { query: 'tag:책', color: '#f00' },
    { query: 'kind:unresolved', color: '#0f0' },
  ];

  it('위에서부터 처음 일치하는 그룹의 색', () => {
    expect(colorForNode(note, groups, '#ccc')).toBe('#f00');
    expect(colorForNode(rootNote, groups, '#ccc')).toBe('#888');
    expect(colorForNode(unresolved, groups, '#ccc')).toBe('#0f0');
    expect(colorForNode(tagNode, groups, '#ccc')).toBe('#ccc');
  });

  it('여러 그룹에 맞으면 앞 그룹이 이긴다', () => {
    const both: FilterNode = { ...note, tags: ['초안', '책'] };
    expect(colorForNode(both, groups, '#ccc')).toBe('#888');
  });

  it('일치하는 그룹이 없으면 폴백', () => {
    expect(colorForNode(note, [], '#ccc')).toBe('#ccc');
  });
});

describe('filterNodes', () => {
  const nodes = [note, rootNote, tagNode, unresolved];

  it('맞는 노드만 순서를 유지해 돌려준다', () => {
    expect(filterNodes(nodes, 'kind:note')).toEqual([note, rootNote]);
    expect(filterNodes(nodes, 'tag:책')).toEqual([note]);
    expect(filterNodes(nodes, 'label 없는')).toEqual([]);
  });

  it('빈 질의는 전부 그대로', () => {
    expect(filterNodes(nodes, '  ')).toEqual(nodes);
  });
});
