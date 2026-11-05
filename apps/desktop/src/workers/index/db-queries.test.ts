import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Indexer } from './indexer';

let root: string;
let ix: Indexer;
const put = (rel: string, body: string) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'nops-db-'));
  put(
    '독서/_db.yaml',
    `title: 독서 목록
properties:
  저자: { type: text }
  상태: { type: status, options: [{name: 읽을 예정, group: todo}, {name: 읽는 중, group: doing}, {name: 완료, group: done}] }
  평점: { type: number, format: stars }
  태그들: { type: multi_select, options: [{name: 개발}, {name: 소설}] }
views:
  - { id: all, name: 전체, type: table, sort: [{prop: 평점, dir: desc}] }
  - { id: board, name: 보드, type: board, groupBy: 상태 }
  - { id: good, name: 좋은 책, type: table, filter: { and: [{prop: 평점, op: ">=", value: 4}] } }
`,
  );
  put('독서/클린 코드.md', '---\n저자: 마틴\n상태: 읽는 중\n평점: 5\n태그들: [개발]\ncreated: 2026-10-01\n---\n# 클린 코드\n');
  put('독서/리팩터링.md', '---\n저자: 파울러\n상태: 완료\n평점: 4\n태그들: [개발, 소설]\n---\n본문\n');
  put('독서/메모.md', '---\n상태: 읽을 예정\n---\n');
  put('독서/하위/깊은.md', '---\n저자: 하위\n---\n');
  put('일반 노트.md', '# 그냥 노트\n');
  put('다른/_db.yaml', 'title: 다른\nrowsFolder: "**"\n');
  put('다른/a.md', '---\n---\n');
  put('다른/중첩/b.md', '---\n---\n');
  ix = new Indexer(root, ':memory:');
  ix.scan();
  ix.syncAssets();
});

describe('데이터베이스 질의(인덱서)', () => {
  it('_db.yaml 이 있는 폴더를 데이터베이스로 찾고 행 수를 센다(기본은 하위 폴더 제외)', () => {
    const dbs = ix.databases();
    expect(dbs.map((d) => [d.folder, d.title, d.rowCount])).toEqual([
      ['다른', '다른', 2], // rowsFolder: ** → 하위 폴더 포함
      ['독서', '독서 목록', 3],
    ]);
    expect(ix.databaseFolders()).toEqual(['다른', '독서']);
    expect(ix.databaseRowPaths('독서')).toEqual(['독서/리팩터링.md', '독서/메모.md', '독서/클린 코드.md']);
  });

  it('저장된 뷰로 정렬·필터한다', () => {
    const all = ix.queryDatabase({ folder: '독서', viewId: 'all' });
    expect(all.total).toBe(3);
    expect(all.rows.map((r) => r.title)).toEqual(['클린 코드', '리팩터링', '메모']); // 평점 내림차순, 빈 값은 뒤
    expect(all.rows[0]!.values['평점']).toBe(5);
    expect(all.rows[0]!.values['태그들']).toEqual(['개발']);
    const good = ix.queryDatabase({ folder: '독서', viewId: 'good' });
    expect(good.matched).toBe(2);
  });

  it('보드 그룹은 정의된 옵션을 빈 그룹까지 순서대로 돌려준다', () => {
    const b = ix.queryDatabase({ folder: '독서', viewId: 'board' });
    expect(b.rows).toEqual([]);
    expect(b.groups!.map((g) => [g.label, g.count])).toEqual([
      ['읽을 예정', 1],
      ['읽는 중', 1],
      ['완료', 1],
    ]);
  });

  it('임시 뷰(저장 전)와 groupLimit', () => {
    const r = ix.queryDatabase({ folder: '독서', view: { id: 'tmp', type: 'table', sort: [], filter: { and: [{ prop: 'title', op: 'contains', value: '코드' }] } } });
    expect(r.rows.map((x) => x.title)).toEqual(['클린 코드']);
    const g = ix.queryDatabase({ folder: '독서', view: { id: 't', type: 'board', sort: [], groupBy: '저자' }, groupLimit: 1 });
    expect(g.groups!.every((x) => x.rows.length <= 1)).toBe(true);
    expect(() => ix.queryDatabase({ folder: '독서', view: { type: 'nope' } })).toThrow(/보기 설정/);
    expect(() => ix.queryDatabase({ folder: '없는폴더' })).toThrow(/찾을 수 없어요/);
  });

  it('created_time 같은 파일 값과 offset/limit', () => {
    const r = ix.queryDatabase({ folder: '독서', viewId: 'all', offset: 1, limit: 1 });
    expect(r.rows).toHaveLength(1);
    expect(r.matched).toBe(3);
  });

  it('갤러리는 본문 첫 이미지를 커버로 풀어 준다(첨부 폴더 위치와 무관)', () => {
    put('독서/그림.md', '---\n저자: x\n---\n앞글 ![[표지.png|200]] 뒤 ![](다른.jpg)\n');
    put('attachments/표지.png', 'png');
    ix.indexFile('독서/그림.md');
    ix.syncAssets();
    const r = ix.queryDatabase({ folder: '독서', view: { id: 'g', type: 'gallery', sort: [] } });
    expect(r.rows.find((x) => x.title === '그림')!.cover).toBe('attachments/표지.png');
    expect(r.rows.find((x) => x.title === '메모')!.cover).toBeUndefined();
  });

  it('인덱스가 바뀌면 캐시된 계산 결과를 다시 만든다', () => {
    const before = ix.queryDatabase({ folder: '독서', viewId: 'all' });
    expect(before.rows.find((x) => x.title === '메모')!.values['평점']).toBeNull();
    put('독서/메모.md', '---\n상태: 읽을 예정\n평점: 3\n---\n');
    ix.indexFile('독서/메모.md');
    const after = ix.queryDatabase({ folder: '독서', viewId: 'all' });
    expect(after.rows.find((x) => x.title === '메모')!.values['평점']).toBe(3);
  });
});

describe('계산 오류 문구와 로캘', () => {
  it('언어를 바꾸면 다음 질의에서 오류 문구가 새 언어로 다시 계산된다(캐시 무효화)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nops-db-locale-'));
    const file = (rel: string, body: string) => {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), body);
    };
    file(
      '수식/_db.yaml',
      `title: 수식
properties:
  값: { type: text }
  계산: { type: formula, expr: 'round(prop("값"))' }
views:
  - { id: all, name: 전체, type: table }
`,
    );
    file('수식/행.md', '---\n값: abc\n---\n');
    const local = new Indexer(dir, ':memory:');
    local.scan();
    const ko = local.queryDatabase({ folder: '수식', viewId: 'all', locale: 'ko' });
    expect(ko.errors['수식/행.md']?.['계산']).toBe('round: 숫자가 필요한데 문자열 이에요');
    const en = local.queryDatabase({ folder: '수식', viewId: 'all', locale: 'en' });
    expect(en.errors['수식/행.md']?.['계산']).toBe('round: expected a number but got Text');
    // 같은 언어로 다시 물으면 캐시를 쓴다(문구 동일)
    expect(local.queryDatabase({ folder: '수식', viewId: 'all', locale: 'en' }).errors['수식/행.md']?.['계산']).toBe(
      'round: expected a number but got Text',
    );
  });
});

describe('행 노트(rowDatabase) 오류 문구와 로캘', () => {
  it('db.row 경로도 요청 언어로 수식 오류를 만든다', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nops-db-row-locale-'));
    const file = (rel: string, body: string) => {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), body);
    };
    file(
      '수식/_db.yaml',
      `title: 수식
properties:
  값: { type: text }
  계산: { type: formula, expr: 'round(prop("값"))' }
views:
  - { id: all, name: 전체, type: table }
`,
    );
    file('수식/행.md', '---\n값: abc\n---\n');
    const local = new Indexer(dir, ':memory:');
    local.scan();
    const ko = local.rowDatabase('수식/행.md', 'ko');
    expect(ko?.errors['계산']).toBe('round: 숫자가 필요한데 문자열 이에요');
    const en = local.rowDatabase('수식/행.md', 'en');
    expect(en?.errors['계산']).toBe('round: expected a number but got Text');
  });
});
