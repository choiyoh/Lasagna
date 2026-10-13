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
const reindex = () => {
  ix = new Indexer(root, ':memory:');
  ix.scan();
  ix.syncAssets();
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'nops-compute-'));
  put(
    '프로젝트/_db.yaml',
    `title: 프로젝트
properties:
  예산: { type: number }
  할일: { type: relation, target: 할일, twoWay: true, reverse: 프로젝트 }
  할일 수: { type: rollup, relation: 할일, property: title, fn: count }
  완료 수: { type: rollup, relation: 할일, property: 완료, fn: checked }
  남은 예산: { type: formula, expr: 'prop("예산") - prop("할일 수") * 10' }
  요약: { type: formula, expr: 'prop("title") + " (" + prop("완료 수") + "/" + prop("할일 수") + ")"' }
  깨짐: { type: formula, expr: 'prop("예산") / 0' }
  문법: { type: formula, expr: 'prop("예산") +' }
  순환A: { type: formula, expr: 'prop("순환B") + 1' }
  순환B: { type: formula, expr: 'prop("순환A") + 1' }
views:
  - { id: v, type: table }
`,
  );
  put('프로젝트/알파.md', '---\n예산: 100\n할일: ["[[일 하나]]", "[[일 둘]]"]\n---\n');
  put('프로젝트/베타.md', '---\n예산: 50\n---\n');
  put(
    '할일/_db.yaml',
    `title: 할일
properties:
  완료: { type: checkbox }
  프로젝트: { type: relation, target: 프로젝트, twoWay: true, reverse: 할일 }
  가중치: { type: number }
  두배: { type: formula, expr: 'prop("가중치") * 2' }
views:
  - { id: v, type: table }
`,
  );
  put('할일/일 하나.md', '---\n완료: true\n가중치: 3\n---\n');
  put('할일/일 둘.md', '---\n완료: false\n가중치: 4\n---\n');
  reindex();
});

describe('관계·롤업·수식 계산', () => {
  it('롤업(count·checked)과 수식(롤업·속성 참조)이 계산된다', () => {
    const r = ix.queryDatabase({ folder: '프로젝트', viewId: 'v' });
    const alpha = r.rows.find((x) => x.title === '알파')!;
    expect(alpha.values['할일 수']).toBe(2);
    expect(alpha.values['완료 수']).toBe(1);
    expect(alpha.values['남은 예산']).toBe(80);
    expect(alpha.values['요약']).toBe('알파 (1/2)');
    const beta = r.rows.find((x) => x.title === '베타')!;
    expect(beta.values['할일 수']).toBe(0);
    expect(beta.values['남은 예산']).toBe(50);
  });

  it('수식의 오류는 값을 비우고 행·속성별 메시지로 알려 준다', () => {
    const r = ix.queryDatabase({ folder: '프로젝트', viewId: 'v' });
    const alpha = r.rows.find((x) => x.title === '알파')!;
    expect(alpha.values['깨짐']).toBeNull();
    expect(r.errors[alpha.path]!['깨짐']).toMatch(/0으로/);
    expect(r.errors[alpha.path]!['문법']).toBeTruthy();
  });

  it('서로를 참조하는 수식은 순환 참조 오류가 되고 다른 속성은 영향이 없다', () => {
    const r = ix.queryDatabase({ folder: '프로젝트', viewId: 'v' });
    const alpha = r.rows.find((x) => x.title === '알파')!;
    expect(r.errors[alpha.path]!['순환A']).toMatch(/순환/);
    expect(r.errors[alpha.path]!['순환B']).toMatch(/순환/);
    expect(alpha.values['남은 예산']).toBe(80);
  });

  it('다른 데이터베이스의 계산된 값도 롤업할 수 있다', () => {
    put(
      '프로젝트/_db.yaml',
      `title: 프로젝트
properties:
  할일: { type: relation, target: 할일 }
  두배 합: { type: rollup, relation: 할일, property: 두배, fn: sum }
views:
  - { id: v, type: table }
`,
    );
    reindex();
    const r = ix.queryDatabase({ folder: '프로젝트', viewId: 'v' });
    expect(r.rows.find((x) => x.title === '알파')!.values['두배 합']).toBe(14);
  });

  it('계산된 값으로 필터·정렬·그룹한다', () => {
    const r = ix.queryDatabase({
      folder: '프로젝트',
      view: { id: 'x', type: 'table', sort: [{ prop: '남은 예산', dir: 'desc' }], filter: { and: [{ prop: '할일 수', op: '>=', value: 1 }] } },
    });
    expect(r.rows.map((x) => x.title)).toEqual(['알파']);
    const g = ix.queryDatabase({ folder: '프로젝트', view: { id: 'y', type: 'table', sort: [], groupBy: '할일 수' } });
    expect(g.groups!.map((x) => x.label).sort()).toEqual(['0', '2']);
  });

  it('자기 자신을 가리키는 관계의 롤업도 순환 없이 계산된다', () => {
    put('트리/_db.yaml', 'title: 트리\nproperties:\n  자식: { type: relation, target: 트리 }\n  자식 수: { type: rollup, relation: 자식, property: title, fn: count }\nviews:\n  - { id: v, type: table }\n');
    put('트리/뿌리.md', '---\n자식: ["[[잎1]]", "[[잎2]]"]\n---\n');
    put('트리/잎1.md', '---\n---\n');
    put('트리/잎2.md', '---\n---\n');
    reindex();
    const r = ix.queryDatabase({ folder: '트리', viewId: 'v' });
    expect(r.rows.find((x) => x.title === '뿌리')!.values['자식 수']).toBe(2);
  });
});
