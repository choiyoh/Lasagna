import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { parseDbSchema } from './schema.js';
import {
  buildRowNote,
  moveDbView,
  newDbYaml,
  removeDbProperty,
  removeDbView,
  renameDbProperty,
  renameFrontmatterKey,
  setDbMeta,
  setDbProperty,
  setFrontmatter,
  upsertDbView,
} from './yaml-edit.js';

/** 원문의 프런트매터만 읽는다(값 왕복 확인용). */
function fm(content: string): Record<string, unknown> {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/.exec(content);
  return (parseYaml(m?.[1] ?? '') ?? {}) as Record<string, unknown>;
}

describe('setFrontmatter', () => {
  it('키를 추가·수정·삭제하고 주석·순서를 지킨다', () => {
    const src = '---\n# 위쪽 주석\ntitle: 노트\n상태: 읽는 중 # 인라인 주석\n---\n\n본문\n';
    const out = setFrontmatter(src, { 평점: 5, 상태: '완료', title: undefined });
    expect(out).toBe('---\n# 위쪽 주석\n상태: 완료 # 인라인 주석\n평점: 5\n---\n\n본문\n');
    expect(fm(out)).toEqual({ 상태: '완료', 평점: 5 });
  });

  it('같은 값을 다시 설정하면 바이트가 그대로다', () => {
    const src = "---\n'a': 'v'\nz: 1\n---\nbody";
    expect(setFrontmatter(src, { a: 'v' })).toBe(src);
    expect(setFrontmatter(src, { z: 1, a: 'v' })).toBe(src);
    expect(setFrontmatter(src, { 없는키: undefined })).toBe(src);
  });

  it('CRLF 프런트매터는 CRLF 로 유지하고 새 줄도 CRLF 로 쓴다', () => {
    const src = '---\r\n# 주석\r\na: 1\r\n---\r\n본문\r\n둘째 줄\r\n';
    const out = setFrontmatter(src, { b: 2, a: 3 });
    expect(out).toBe('---\r\n# 주석\r\na: 3\r\nb: 2\r\n---\r\n본문\r\n둘째 줄\r\n');
    expect(out).not.toMatch(/[^\r]\n/);
  });

  it('프런트매터가 없으면 맨 앞에 만들고 본문은 그대로 둔다', () => {
    expect(setFrontmatter('본문만\n', { title: 'X' })).toBe('---\ntitle: X\n---\n본문만\n');
    expect(setFrontmatter('', { title: 'X' })).toBe('---\ntitle: X\n---\n');
    expect(setFrontmatter('첫줄\r\n둘째\r\n', { a: 1 })).toBe('---\r\na: 1\r\n---\r\n첫줄\r\n둘째\r\n');
  });

  it('본문 바이트는 건드리지 않는다', () => {
    const body = '\n# 제목\n\n```ts\nconst a = 1;   \n```\n\n- [ ] 할 일  \n\n';
    expect(setFrontmatter(`---\na: 1\n---${body}`, { a: 2 })).toBe(`---\na: 2\n---${body}`);
  });

  it('빈 프런트매터에는 키를 추가할 수 있다', () => {
    expect(setFrontmatter('---\n---\n본문', { a: 1 })).toBe('---\na: 1\n---\n본문');
    expect(setFrontmatter('---\n---\n본문', {})).toBe('---\n---\n본문');
  });

  it('깨진 YAML 은 Error 를 던진다', () => {
    expect(() => setFrontmatter('---\na: [\n---\n본문', { b: 1 })).toThrow(
      expect.objectContaining({ key: 'db.issue.yaml' }) as never,
    );
  });

  it('값 타입별로 쓰고 다시 읽으면 같은 값이다', () => {
    const values = {
      날짜: { start: '2026-10-12', end: '2026-10-13' },
      태그: ['가', '나'],
      평점: 4.5,
      읽음: true,
      상태: '완료',
      관련: '[[다른 노트]]',
      한글: '한글 값',
    };
    const out = setFrontmatter('', values);
    expect(fm(out)).toEqual(values);
    // 위키링크는 대괄호 때문에 따옴표로 감싼다.
    expect(out).toContain('관련: "[[다른 노트]]"');
    // 다시 설정해도(왕복) 값이 같다.
    expect(fm(setFrontmatter(out, values))).toEqual(values);
    expect(setFrontmatter(out, values)).toBe(out);
  });
});

describe('renameFrontmatterKey', () => {
  it('값·위치·주석을 유지한 채 이름만 바꾼다', () => {
    const src = '# 주석\na: 1 # 인라인\nb: 2\n---\n본문';
    const out = renameFrontmatterKey(src, 'b', 'c');
    expect(out).toBe(src); // 프런트매터가 없는 원문(구분선만 있는 경우)은 그대로
    const src2 = '---\n# 주석\na: 1 # 인라인\nb: 2\n---\n본문';
    expect(renameFrontmatterKey(src2, 'b', 'c')).toBe('---\n# 주석\na: 1 # 인라인\nc: 2\n---\n본문');
  });

  it('없는 키는 그대로, 이미 있는 이름이면 Error', () => {
    const src = '---\na: 1\nb: 2\n---\n본문';
    expect(renameFrontmatterKey(src, 'z', 'c')).toBe(src);
    expect(() => renameFrontmatterKey(src, 'a', 'b')).toThrow(expect.objectContaining({ key: 'core.err.keyExists' }) as never);
  });
});

describe('buildRowNote', () => {
  it('undefined 를 뺀 키를 준 순서대로 쓴다', () => {
    const out = buildRowNote({ 제목: '책', 평점: 4, 메모: undefined }, '본문\n');
    expect(out).toBe('---\n제목: 책\n평점: 4\n---\n\n본문\n');
  });

  it('값이 없으면 프런트매터 없이 본문만', () => {
    expect(buildRowNote({}, '본문')).toBe('본문');
    expect(buildRowNote({ a: undefined })).toBe('');
  });
});

/** 설계 문서 스타일의 `_db.yaml`(주석 포함). */
const DB = `# 독서 목록
version: 1
title: 독서 목록
properties:
  # 독서 노트의 핵심
  상태: { type: status, options: [{ name: 읽는 중, group: doing }, { name: 완료, group: done }] } # 상태
  평점: { type: number, format: stars }
  관련 노트: { type: relation, target: "*", twoWay: false, reverse: 역참조 }
  역참조: { type: relation, target: "*", twoWay: false }
  읽은 권수: { type: rollup, relation: 관련 노트, property: 상태, fn: count }
views:
  - id: v1
    name: 전체
    type: table
    columns: [title, 상태, 평점, 관련 노트]
    sort: [{ prop: 평점, dir: desc }]
    widths: { 평점: 120 }
    calc: { 평점: avg }
  - id: v2
    name: 보드
    type: board
    groupBy: 상태
    subGroupBy: 평점
    dateProp: 평점
    cover: 평점
    filter:
      and:
        - { prop: 상태, op: "=", value: 완료 }
        - or:
            - { prop: 평점, op: ">=", value: 3 }
            - { prop: 상태, op: "!=", value: 읽는 중 }
`;

describe('_db.yaml 편집', () => {
  it('setDbProperty: 없으면 추가하고, 있으면 같은 위치에서 값만 교체한다', () => {
    const added = setDbProperty('version: 1\nproperties:\n  a: { type: text }\n', 'b', { type: 'number', format: 'number' });
    expect(parseDbSchema(added).schema.properties).toEqual({ a: { type: 'text' }, b: { type: 'number', format: 'number' } });

    const updated = setDbProperty(DB, '평점', { type: 'number', format: 'percent' });
    expect(parseDbSchema(updated).schema.properties['평점']).toEqual({ type: 'number', format: 'percent' });
    expect(updated).toContain('# 상태'); // 주석 보존
    expect(updated.indexOf('상태:')).toBeLessThan(updated.indexOf('평점:')); // 순서 보존
    // 같은 정의를 다시 넣으면 원문 그대로(값이 같으면 노드를 건드리지 않는다).
    expect(setDbProperty(DB, '평점', { type: 'number', format: 'stars' })).toBe(DB);
  });

  it('setDbProperty: properties 키가 없으면 만든다', () => {
    expect(setDbProperty('title: X\n', 'a', { type: 'text' })).toBe('title: X\nproperties:\n  a:\n    type: text\n');
    expect(setDbProperty('', 'a', { type: 'text' })).toBe('properties:\n  a:\n    type: text\n');
  });

  it('removeDbProperty: 속성·뷰 참조·필터 조건을 함께 지운다', () => {
    const out = removeDbProperty(DB, '평점');
    const { schema, issues } = parseDbSchema(out);
    expect(issues).toEqual([]);
    expect(Object.keys(schema.properties)).toEqual(['상태', '관련 노트', '역참조', '읽은 권수']);
    expect(out).not.toContain('평점');
    expect(out).toContain('# 독서 목록'); // 주석 보존
    // 중첩 or 안의 다른 조건은 남는다.
    expect(schema.views[1]!.filter).toEqual({ and: [{ prop: '상태', op: '=', value: '완료' }, { or: [{ prop: '상태', op: '!=', value: '읽는 중' }] }] });
    expect(schema.views[0]!.columns).toEqual(['title', '상태', '관련 노트']);
    expect(schema.views[0]!.sort).toEqual([]);
  });

  it('removeDbProperty: 없는 속성이면 입력 그대로', () => {
    expect(removeDbProperty(DB, '없음')).toBe(DB);
    expect(removeDbProperty('', '없음')).toBe('');
  });

  it('removeDbProperty: 마지막 필터 조건을 지우면 filter 키도 사라진다', () => {
    const src = 'views:\n  - id: v1\n    filter: { prop: a, op: "=", value: 1 }\n';
    expect(removeDbProperty(src, 'a')).toBe('views:\n  - id: v1\n');
  });

  it('renameDbProperty: 속성 키와 모든 참조를 바꾼다', () => {
    const out = renameDbProperty(DB, '평점', '점수');
    const { schema, issues } = parseDbSchema(out);
    expect(issues).toEqual([]);
    expect(Object.keys(schema.properties)).toEqual(['상태', '점수', '관련 노트', '역참조', '읽은 권수']);
    expect(schema.views[0]!.columns).toEqual(['title', '상태', '점수', '관련 노트']);
    expect(schema.views[0]!.sort).toEqual([{ prop: '점수', dir: 'desc' }]);
    expect(schema.views[0]!.widths).toEqual({ 점수: 120 });
    expect(schema.views[0]!.calc).toEqual({ 점수: 'avg' });
    expect(schema.views[1]!.groupBy).toBe('상태');
    expect(schema.views[1]!.subGroupBy).toBe('점수');
    expect(schema.views[1]!.dateProp).toBe('점수');
    expect(schema.views[1]!.cover).toBe('점수');
    expect(schema.views[1]!.filter).toEqual({
      and: [{ prop: '상태', op: '=', value: '완료' }, { or: [{ prop: '점수', op: '>=', value: 3 }, { prop: '상태', op: '!=', value: '읽는 중' }] }],
    });
    expect(out).toContain('# 상태'); // 인라인 주석 보존
  });

  it('renameDbProperty: 롤업·관계 참조도 바꾼다', () => {
    const out = renameDbProperty(DB, '관련 노트', '링크');
    const rolled = renameDbProperty(DB, '상태', '진행');
    expect(out).toContain('relation: 링크, property: 상태');
    expect(rolled).toContain('relation: 관련 노트, property: 진행');
    expect(renameDbProperty(DB, '역참조', '백링크')).toContain('reverse: 백링크');
    expect(renameDbProperty(DB, '없음', 'X')).toBe(DB);
    expect(renameDbProperty(DB, '평점', '평점')).toBe(DB);
  });

  it('upsertDbView: 같은 id 는 교체하고 새 id 는 끝에 붙인다', () => {
    const replaced = upsertDbView(DB, { id: 'v1', name: '전체 수정', type: 'list', sort: [] });
    const parsed = parseDbSchema(replaced).schema;
    expect(parsed.views.map((v) => v.id)).toEqual(['v1', 'v2']);
    expect(parsed.views[0]!.type).toBe('list');
    expect(parsed.views[0]!.name).toBe('전체 수정');

    const appended = upsertDbView(DB, { id: 'v3', name: '목록', type: 'list', sort: [] });
    expect(parseDbSchema(appended).schema.views.map((v) => v.id)).toEqual(['v1', 'v2', 'v3']);
    expect(appended).toContain('- id: v3');

    // views 키가 없으면 만든다.
    expect(upsertDbView('version: 1\n', { id: 'v1', name: '표', type: 'table', sort: [] })).toContain('views:\n  - id: v1');
  });

  it('removeDbView: id 로 지우고, 없으면 입력 그대로', () => {
    const out = removeDbView(DB, 'v1');
    expect(parseDbSchema(out).schema.views.map((v) => v.id)).toEqual(['v2']);
    expect(out).toContain('# 독서 목록');
    expect(removeDbView(DB, '없음')).toBe(DB);
  });

  it('moveDbView: 순서를 옮기고 범위는 클램프한다', () => {
    const two = 'views:\n  - { id: v1, type: table }\n  - { id: v2, type: board }\n';
    const moved = moveDbView(two, 'v1', 1);
    expect(parseDbSchema(moved).schema.views.map((v) => v.id)).toEqual(['v2', 'v1']);
    const clamped = moveDbView(two, 'v2', 99); // 마지막으로 클램프 → 이미 마지막이라 무변경
    expect(clamped).toBe(two);
    expect(moveDbView(two, 'v2', -5)).toContain('views:\n  - { id: v2, type: board }');
    expect(moveDbView(two, '없음', 0)).toBe(two);
    expect(moveDbView(two, 'v1', 0)).toBe(two);
  });

  it('setDbMeta: 설정·삭제', () => {
    const src = 'version: 1\n# 주석\ntitle: 옛 제목\nrowsFolder: .\n';
    const out = setDbMeta(src, { title: '새 제목', rowsFolder: undefined, templates: ['t1'], defaultTemplate: 't1' });
    expect(parseDbSchema(out).schema).toMatchObject({ title: '새 제목', templates: ['t1'], defaultTemplate: 't1' });
    expect(out).not.toContain('rowsFolder');
    expect(out).toContain('# 주석'); // 주석은 남는다(지운 키에 붙어 있던 선행 주석은 다음 항목으로)
    expect(out).toContain('title: 새 제목');
    // 빈 제목은 삭제
    const noTitle = setDbMeta(src, { title: '' });
    expect(parseDbSchema(noTitle).schema.title).toBeUndefined();
    expect(noTitle).not.toContain('title:');
    expect(noTitle).toContain('# 주석');
    // 없는 키 삭제는 무변경
    expect(setDbMeta(src, { defaultTemplate: undefined })).toBe(src);
    expect(setDbMeta('', { title: 'X' })).toBe('title: X\n');
  });

  it('newDbYaml: parseDbSchema 로 읽어 issues 가 없다', () => {
    const out = newDbYaml('독서 목록');
    expect(out.endsWith('\n')).toBe(true);
    const { schema, issues } = parseDbSchema(out);
    expect(issues).toEqual([]);
    expect(schema.title).toBe('독서 목록');
    expect(schema.properties).toEqual({});
    expect(schema.views).toHaveLength(1);
    expect(schema.views[0]).toMatchObject({ id: 'v1', name: '보기', type: 'table' });
  });

  it('깨진 YAML 은 편집 함수 모두 Error', () => {
    const broken = 'a: [\n';
    // 예전 정규식 → 코드+params 로 던진다
    const throws = (fn: () => unknown) => expect(fn).toThrow(/db\.issue\.yaml|YAML/);
    throws(() => setDbProperty(broken, 'a', { type: 'text' }));
    throws(() => removeDbProperty(broken, 'a'));
    throws(() => renameDbProperty(broken, 'a', 'b'));
    throws(() => upsertDbView(broken, { id: 'v1', name: '표', type: 'table', sort: [] }));
    throws(() => removeDbView(broken, 'v1'));
    throws(() => moveDbView(broken, 'v1', 0));
    throws(() => setDbMeta(broken, { title: 'x' }));
  });

  it('빈 입력은 빈 문서로 시작한다', () => {
    expect(removeDbProperty('', 'a')).toBe('');
    expect(removeDbView('', 'v1')).toBe('');
    expect(moveDbView('', 'v1', 0)).toBe('');
    expect(setDbMeta('', { title: 'X' })).toBe('title: X\n');
  });
});

describe('setFrontmatter: 스칼라 자리에 날짜 기간(맵)', () => {
  it('날짜 하나를 기간으로 바꾸고 다시 하나로 되돌린다', () => {
    const a = setFrontmatter('---\n마감: 2026-10-16\n제목: x\n---\n본문\n', { 마감: { start: '2026-10-16', end: '2026-10-18' } });
    expect(a).toBe('---\n마감: { start: 2026-10-16, end: 2026-10-18 }\n제목: x\n---\n본문\n');
    const b = setFrontmatter(a, { 마감: '2026-10-16' });
    expect(b).toBe('---\n마감: 2026-10-16\n제목: x\n---\n본문\n');
  });
  it('없던 키로 기간을 새로 쓴다', () => {
    expect(setFrontmatter('본문\n', { 기간: { start: '2026-01-01', end: '2026-01-02' } })).toBe('---\n기간: { start: 2026-01-01, end: 2026-01-02 }\n---\n본문\n');
  });
});
