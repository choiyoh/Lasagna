import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { globalGraph, localGraph, type GraphData, type GraphNode } from './graph-queries';
import { Indexer } from './indexer';

let root: string;
let ix: Indexer;

const put = (rel: string, body: string) => {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
};

/**
 * alpha → beta(위키링크 2개, 하나는 별칭) / alpha → alpha(자기 링크) / alpha → delta(별칭) /
 * alpha → gamma(마크다운 링크) / beta → gamma / beta → epsilon(2단계 거리용) / gamma → beta.
 * 미해결 `[[고스트]]`는 alpha·beta 둘 다에 있고, 태그는 alpha(공통·태그·태그/하위)와 solo(솔로태그).
 */
const VAULT: Record<string, string> = {
  'alpha.md': [
    '---',
    'tags: [공통]',
    '---',
    '# 알파',
    '',
    '[[beta]] 와 [[beta|둘째]] · [[alpha]] · [[알파별칭]] · [[고스트]] · [감마](gamma.md)',
    '',
    '본문 #태그 #태그/하위 #공통',
  ].join('\n'),
  'beta.md': '# 베타\n\n[[gamma]] 와 [[고스트]] 와 [[epsilon]]\n',
  'gamma.md': '# 감마\n\n[[beta]]\n',
  'delta.md': '---\naliases: [알파별칭]\n---\n# 델타\n\n링크 없음\n',
  'epsilon.md': '# 엡실론\n\n링크 없음\n',
  'solo.md': '# 솔로\n\n링크 없음 #솔로태그\n',
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'nops-graph-'));
  ix = new Indexer(root);
  for (const [rel, body] of Object.entries(VAULT)) put(rel, body);
  ix.scan();
  // 그래프 질의는 dst_page 가 채워져 있다고 가정한다(호출 쪽 책임)
  ix.resolveLinks();
});

afterEach(() => {
  ix.close();
  rmSync(root, { recursive: true, force: true });
});

const nodeOf = (g: GraphData, id: string): GraphNode => {
  const found = g.nodes.find((n) => n.id === id);
  if (!found)
    throw new Error(`노드 없음: ${id} (있는 노드: ${g.nodes.map((n) => n.id).join(', ')})`);
  return found;
};
const ids = (g: GraphData): string[] => g.nodes.map((n) => n.id);
const edgeKeys = (g: GraphData): string[] =>
  g.edges.map((e) => `${e.source} -> ${e.target} (${e.kind})`);
const noteDepths = (g: GraphData): Array<[string, number | undefined]> =>
  g.nodes.filter((n) => n.kind === 'note').map((n) => [n.id, n.depth]);

describe('globalGraph', () => {
  it('기본값: 노트 사이 링크만, 중복·자기 링크 제외, 별칭 링크 포함', () => {
    const g = globalGraph(ix.db);
    expect(ids(g)).toEqual([
      'alpha.md',
      'beta.md',
      'delta.md',
      'epsilon.md',
      'gamma.md',
      'solo.md',
    ]);
    expect(g.nodes.every((n) => n.kind === 'note')).toBe(true);
    expect(g.nodes.every((n) => !('depth' in n))).toBe(true);
    expect(edgeKeys(g)).toEqual([
      'alpha.md -> beta.md (link)',
      'alpha.md -> delta.md (link)',
      'alpha.md -> gamma.md (link)',
      'beta.md -> epsilon.md (link)',
      'beta.md -> gamma.md (link)',
      'gamma.md -> beta.md (link)',
    ]);
    // alpha → beta 는 링크가 2개지만 엣지는 1개, 자기 링크 alpha → alpha 는 없다
    expect(g.edges.filter((e) => e.source === 'alpha.md' && e.target === 'beta.md')).toHaveLength(
      1,
    );
    expect(g.edges.some((e) => e.source === e.target)).toBe(false);
    // 태그·미해결은 기본값에서 빠진다
    expect(ids(g).some((id) => id.startsWith('#') || id.startsWith('?'))).toBe(false);

    expect(nodeOf(g, 'alpha.md')).toMatchObject({ label: '알파', folder: '', degree: 3 });
    expect(nodeOf(g, 'solo.md').degree).toBe(0);
  });

  it('노트 노드에는 태그를 정렬·중복 제거해 담는다', () => {
    const g = globalGraph(ix.db);
    // 공통은 프런트매터와 인라인 양쪽에 있지만 한 번만
    expect(nodeOf(g, 'alpha.md').tags).toEqual(['공통', '태그', '태그/하위']);
    expect(nodeOf(g, 'solo.md').tags).toEqual(['솔로태그']);
    expect(nodeOf(g, 'beta.md').tags).toEqual([]);
  });

  it('includeOrphans: false 면 엣지 없는 노트를 뺀다', () => {
    const g = globalGraph(ix.db, { includeOrphans: false });
    expect(ids(g)).toEqual(['alpha.md', 'beta.md', 'delta.md', 'epsilon.md', 'gamma.md']);
    expect(g.edges).toHaveLength(6);
  });

  it('includeUnresolved: true 면 대상 텍스트가 같은 링크를 노드 하나로 합친다', () => {
    const g = globalGraph(ix.db, { includeUnresolved: true });
    expect(g.nodes.filter((n) => n.id === '?고스트')).toHaveLength(1);
    expect(nodeOf(g, '?고스트')).toEqual({
      id: '?고스트',
      kind: 'unresolved',
      label: '고스트',
      folder: '',
      tags: [],
      degree: 2,
    });
    expect(edgeKeys(g).filter((k) => k.includes('?고스트'))).toEqual([
      'alpha.md -> ?고스트 (link)',
      'beta.md -> ?고스트 (link)',
    ]);
  });

  it('대상 텍스트가 비었거나 임베드인 미해결 링크는 미해결 노드로 만들지 않는다', () => {
    const page = ix.db.prepare(`SELECT id FROM pages WHERE path='solo.md'`).get() as { id: number };
    const ins = ix.db.prepare(
      `INSERT INTO links(src_page, dst_raw, kind, is_resolved) VALUES(?, ?, ?, 0)`,
    );
    ins.run(page.id, '', 'wikilink');
    ins.run(page.id, '그림', 'embed');

    // 저장된 볼트의 `[[고스트]]` 외에 새 미해결 노드·엣지가 생기지 않아야 한다
    const g = globalGraph(ix.db, { includeUnresolved: true });
    expect(ids(g).filter((id) => id.startsWith('?'))).toEqual(['?고스트']);
    expect(edgeKeys(g)).toHaveLength(8);
  });

  it('includeTags: true 면 태그 노드와 노트→태그 엣지를 붙인다', () => {
    const g = globalGraph(ix.db, { includeTags: true });
    expect(nodeOf(g, '#공통')).toEqual({
      id: '#공통',
      kind: 'tag',
      label: '#공통',
      folder: '',
      tags: [],
      degree: 1,
    });
    expect(
      g.edges.filter((e) => e.kind === 'tag').map((e) => `${e.source} -> ${e.target}`),
    ).toEqual([
      'alpha.md -> #공통',
      'alpha.md -> #태그',
      'alpha.md -> #태그/하위',
      'solo.md -> #솔로태그',
    ]);
    expect(nodeOf(g, 'alpha.md').degree).toBe(6);
  });
});

describe('localGraph', () => {
  it('깊이 1 · both: 중심과 이웃, 포함된 노트 사이 엣지 전부', () => {
    const g = localGraph(ix.db, 'beta.md');
    expect(ids(g)).toEqual(['alpha.md', 'beta.md', 'epsilon.md', 'gamma.md']);
    expect(noteDepths(g)).toEqual([
      ['alpha.md', 1],
      ['beta.md', 0],
      ['epsilon.md', 1],
      ['gamma.md', 1],
    ]);
    // gamma → beta 는 중심으로 들어오는 방향이지만 두 노트가 모두 포함되므로 넣는다
    expect(edgeKeys(g)).toEqual([
      'alpha.md -> beta.md (link)',
      'alpha.md -> gamma.md (link)',
      'beta.md -> epsilon.md (link)',
      'beta.md -> gamma.md (link)',
      'gamma.md -> beta.md (link)',
    ]);
    expect(nodeOf(g, 'beta.md').degree).toBe(4);
  });

  it('depth 로 2단계까지 넓힌다', () => {
    const g = localGraph(ix.db, 'alpha.md', { depth: 2 });
    // gamma 는 alpha 에서 마크다운 링크로 바로 이어져 1단계, epsilon 은 beta 를 거쳐 2단계
    expect(noteDepths(g)).toEqual([
      ['alpha.md', 0],
      ['beta.md', 1],
      ['delta.md', 1],
      ['epsilon.md', 2],
      ['gamma.md', 1],
    ]);
    expect(edgeKeys(g)).toEqual([
      'alpha.md -> beta.md (link)',
      'alpha.md -> delta.md (link)',
      'alpha.md -> gamma.md (link)',
      'beta.md -> epsilon.md (link)',
      'beta.md -> gamma.md (link)',
      'gamma.md -> beta.md (link)',
    ]);
  });

  it('direction 은 탐색 방향만 정한다(엣지는 포함된 노트 사이면 모두 넣는다)', () => {
    const out = localGraph(ix.db, 'beta.md', { direction: 'out' });
    expect(ids(out)).toEqual(['beta.md', 'epsilon.md', 'gamma.md']);
    expect(edgeKeys(out)).toEqual([
      'beta.md -> epsilon.md (link)',
      'beta.md -> gamma.md (link)',
      'gamma.md -> beta.md (link)',
    ]);
    expect(nodeOf(out, 'beta.md').degree).toBe(3);

    const inc = localGraph(ix.db, 'beta.md', { direction: 'in' });
    expect(ids(inc)).toEqual(['alpha.md', 'beta.md', 'gamma.md']);
    expect(edgeKeys(inc)).toEqual([
      'alpha.md -> beta.md (link)',
      'alpha.md -> gamma.md (link)',
      'beta.md -> gamma.md (link)',
      'gamma.md -> beta.md (link)',
    ]);
  });

  it('depth 는 1~5로 클램프한다', () => {
    const one = localGraph(ix.db, 'alpha.md', { depth: 1 });
    expect(localGraph(ix.db, 'alpha.md', { depth: 0 }).nodes).toEqual(one.nodes);
    expect(localGraph(ix.db, 'alpha.md', { depth: 99 }).nodes).toEqual(
      localGraph(ix.db, 'alpha.md', { depth: 5 }).nodes,
    );
    // 연결된 노트는 alpha·beta·delta·epsilon·gamma 뿐(solo 는 끊겨 있다)
    expect(ids(localGraph(ix.db, 'alpha.md', { depth: 5 }))).toEqual([
      'alpha.md',
      'beta.md',
      'delta.md',
      'epsilon.md',
      'gamma.md',
    ]);
  });

  it('없는 centerPath 는 빈 그래프', () => {
    expect(localGraph(ix.db, '없는/노트.md')).toEqual({ nodes: [], edges: [] });
  });

  it('includeOrphans 는 무시한다(중심 노트는 항상 포함)', () => {
    const g = localGraph(ix.db, 'solo.md', { includeOrphans: false });
    expect(ids(g)).toEqual(['solo.md']);
    expect(nodeOf(g, 'solo.md')).toMatchObject({ degree: 0, depth: 0 });
  });

  it('태그·미해결 노드는 포함된 노트에 붙고 depth 가 없다', () => {
    const g = localGraph(ix.db, 'alpha.md', {
      depth: 2,
      includeTags: true,
      includeUnresolved: true,
    });
    expect(ids(g)).toEqual([
      '#공통',
      '#태그',
      '#태그/하위',
      '?고스트',
      'alpha.md',
      'beta.md',
      'delta.md',
      'epsilon.md',
      'gamma.md',
    ]);
    expect(edgeKeys(g)).toEqual([
      'alpha.md -> #공통 (tag)',
      'alpha.md -> #태그 (tag)',
      'alpha.md -> #태그/하위 (tag)',
      'alpha.md -> ?고스트 (link)',
      'alpha.md -> beta.md (link)',
      'alpha.md -> delta.md (link)',
      'alpha.md -> gamma.md (link)',
      'beta.md -> ?고스트 (link)',
      'beta.md -> epsilon.md (link)',
      'beta.md -> gamma.md (link)',
      'gamma.md -> beta.md (link)',
    ]);
    expect(noteDepths(g)).toEqual([
      ['alpha.md', 0],
      ['beta.md', 1],
      ['delta.md', 1],
      ['epsilon.md', 2],
      ['gamma.md', 1],
    ]);
    expect(g.nodes.filter((n) => n.kind !== 'note').every((n) => n.depth === undefined)).toBe(true);
    expect(nodeOf(g, 'alpha.md').degree).toBe(7);
    expect(nodeOf(g, '?고스트').degree).toBe(2);
  });

  it('포함되지 않은 노트의 태그·미해결 링크는 붙이지 않는다', () => {
    const g = localGraph(ix.db, 'solo.md', { includeTags: true, includeUnresolved: true });
    expect(ids(g)).toEqual(['#솔로태그', 'solo.md']);
    expect(edgeKeys(g)).toEqual(['solo.md -> #솔로태그 (tag)']);
    expect(nodeOf(g, 'solo.md').depth).toBe(0);
    expect(nodeOf(g, '#솔로태그').degree).toBe(1);
    expect(nodeOf(g, '#솔로태그').depth).toBeUndefined();
  });
});
