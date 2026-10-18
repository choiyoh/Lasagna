/* eslint-disable @typescript-eslint/no-explicit-any -- 테스트: 도구 결과(JSON)를 느슨하게 읽는다 */import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { readAudit } from './audit.js';
import type { McpPolicy } from './policy.js';
import { createServer } from './server.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function makeVault() {
  const root = mkdtempSync(path.join(tmpdir(), 'nops-mcp-srv-'));
  dirs.push(root);
  mkdirSync(path.join(root, '프로젝트'));
  writeFileSync(path.join(root, '프로젝트/계획.md'), '---\ntags: [계획]\n---\n# 계획\n\n## 할 일\n\n- 설계 [[회의록]]\n');
  writeFileSync(path.join(root, '회의록.md'), '# 회의록\n\n오늘 [[계획]] 을 논의했다. #회의\n');
  return root;
}

async function connect(over: Partial<McpPolicy> = {}) {
  const root = makeVault();
  const policy: McpPolicy = { root, write: false, writeFolders: [], maxWritesPerMinute: 30, maxBytes: 100_000, ...over };
  const { server } = createServer(policy);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-agent', version: '1.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
    const text = r.content[0]!.text;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { isError: !!r.isError, text, json: json as Record<string, any> };
  };
  return { root, client, call, policy };
}

describe('MCP 서버 — 읽기 전용(기본)', () => {
  it('읽기 도구만 보이고 쓰기 도구는 없다', async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['get_backlinks', 'list_databases', 'list_notes', 'list_tags', 'query_database', 'read_note', 'search_notes']);
    expect((await client.listTools()).tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
    expect(client.getInstructions()).toContain('read-only');
  });
  it('검색·목록·읽기·백링크·태그', async () => {
    const { call } = await connect();
    const s = await call('search_notes', { query: '설계' });
    expect(s.json.results[0]).toMatchObject({ path: '프로젝트/계획.md' });
    const l = await call('list_notes', { folder: '프로젝트' });
    expect(l.json).toMatchObject({ total: 1, notes: [{ path: '프로젝트/계획.md', title: '계획', tags: ['계획'] }] });
    const r = await call('read_note', { path: '회의록' }); // 확장자 생략 가능
    expect(r.json).toMatchObject({ path: '회의록.md', title: '회의록', tags: ['회의'] });
    expect(r.json.content).toContain('[[계획]]');
    expect(r.json.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.json.links[0]).toMatchObject({ target: '계획', resolved: '프로젝트/계획.md' });
    const b = await call('get_backlinks', { path: '프로젝트/계획.md' });
    expect(b.json.backlinks.map((x: { path: string }) => x.path)).toEqual(['회의록.md']);
    expect((await call('list_tags')).json.tags.map((t: { tag: string }) => t.tag).sort()).toEqual(['계획', '회의']);
  });
  it('없는 노트는 오류로 알린다', async () => {
    const { call } = await connect();
    const r = await call('read_note', { path: '없음' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Note not found');
  });
});

describe('MCP 서버 — 쓰기 허용', () => {
  const write = { write: true, writeFolders: ['AI'] };
  it('쓰기 도구가 생기고 안내문에 허용 폴더가 나온다', async () => {
    const { client } = await connect(write);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['create_note', 'append_to_note', 'update_note', 'get_write_policy']));
    expect(client.getInstructions()).toContain('"AI/"');
  });
  it('만들고 → 읽고 → 덧붙이고 → 해시로 고친다. 모두 감사 기록에 남는다', async () => {
    const { call, root } = await connect(write);
    const c = await call('create_note', { path: 'AI/요약', title: '요약', content: '[[계획]] 을 정리했다', tags: ['ai'] });
    expect(c.isError).toBe(false);
    expect(c.json).toMatchObject({ path: 'AI/요약.md', status: 'saved' });
    expect(readFileSync(path.join(root, 'AI/요약.md'), 'utf8')).toBe('---\ntags:\n  - ai\n---\n\n# 요약\n\n[[계획]] 을 정리했다\n');
    // 새 노트가 바로 검색·백링크에 잡힌다
    expect((await call('search_notes', { query: '정리했다' })).json.results[0].path).toBe('AI/요약.md');
    expect((await call('get_backlinks', { path: '프로젝트/계획.md' })).json.backlinks.map((x: { path: string }) => x.path)).toContain('AI/요약.md');

    const a = await call('append_to_note', { path: 'AI/요약.md', content: '- 추가', heading: '요약' });
    expect(a.isError).toBe(false);
    const r = await call('read_note', { path: 'AI/요약.md' });
    expect(r.json.content).toContain('- 추가');
    const u = await call('update_note', { path: 'AI/요약.md', content: '# 요약\n\n통째로 교체', base_hash: r.json.hash });
    expect(u.isError).toBe(false);
    expect(readFileSync(path.join(root, 'AI/요약.md'), 'utf8')).toBe('# 요약\n\n통째로 교체\n');

    const log = readAudit(root).map((e) => `${e.action}:${e.path}:${e.client}`);
    expect(log).toEqual(['update:AI/요약.md:test-agent', 'append:AI/요약.md:test-agent', 'create:AI/요약.md:test-agent']);
  });
  it('허용 폴더 밖·낡은 해시·이미 있는 노트는 거부된다', async () => {
    const { call, root } = await connect(write);
    const out = await call('create_note', { path: '프로젝트/새노트', content: 'x' });
    expect(out).toMatchObject({ isError: true });
    expect(out.text).toContain('forbidden-folder');
    expect(existsSync(path.join(root, '프로젝트/새노트.md'))).toBe(false);
    expect((await call('append_to_note', { path: '프로젝트/계획.md', content: 'x' })).isError).toBe(true);
    expect((await call('update_note', { path: '프로젝트/계획.md', content: 'x', base_hash: 'a'.repeat(64) })).isError).toBe(true);
    expect(readFileSync(path.join(root, '프로젝트/계획.md'), 'utf8')).toContain('설계'); // 원본 그대로
    await call('create_note', { path: 'AI/a', content: '1' });
    expect((await call('create_note', { path: 'AI/a', content: '2' })).text).toContain('exists');
    const stale = await call('update_note', { path: 'AI/a', content: '3', base_hash: 'f'.repeat(64) });
    expect(stale.text).toContain('stale');
    expect(readAudit(root).filter((e) => e.action === 'denied').length).toBeGreaterThanOrEqual(4);
  });
  it('볼트 밖으로 나가는 경로는 거부한다', async () => {
    const { call, root } = await connect({ write: true, writeFolders: [''] });
    for (const bad of ['../탈출', '/tmp/탈출', '.nopsidian/x', 'a/../../탈출']) {
      const r = await call('create_note', { path: bad, content: 'x' });
      expect(r.isError, bad).toBe(true);
    }
    expect(existsSync(path.join(path.dirname(root), '탈출.md'))).toBe(false);
  });
});

describe('MCP 서버 — 데이터베이스', () => {
  const DB_YAML = [
    'title: 할 일',
    'properties:',
    '  상태: { type: status, options: [{name: 할 일, group: todo}, {name: 진행, group: doing}, {name: 완료, group: done}] }',
    '  점수: { type: number }',
    '  마감: { type: date }',
    '  분류: { type: multi_select, options: [{name: 집}, {name: 회사}] }',
    '  번호: { type: unique_id }',
    '  합: { type: formula, expr: "prop(\\"점수\\") * 2" }',
    '  관련: { type: relation, target: "*", twoWay: true, reverse: 역관련 }',
    'views:',
    '  - { id: v1, name: 전체, type: table, sort: [] }',
    '  - { id: v2, name: 진행만, type: table, sort: [], filter: { prop: 상태, op: "=", value: 진행 } }',
    '',
  ].join('\n');
  async function withDb(over: Partial<McpPolicy> = {}) {
    const c = await connect(over);
    mkdirSync(path.join(c.root, '할일'));
    writeFileSync(path.join(c.root, '할일/_db.yaml'), DB_YAML);
    writeFileSync(path.join(c.root, '할일/가.md'), '---\n상태: 진행\n점수: 5\n마감: 2026-11-01\n번호: 1\n---\n# 가\n본문 가\n');
    writeFileSync(path.join(c.root, '할일/나.md'), '---\n상태: 완료\n점수: 2\n번호: 2\n---\n# 나\n');
    writeFileSync(path.join(c.root, '할일/다.md'), '---\n상태: 진행\n점수: 9\n분류: [집]\n번호: 3\n---\n# 다\n');
    return c;
  }
  const write = { write: true, writeFolders: ['할일', 'AI'] };

  it('list_databases: 속성 형식·옵션·쓸 수 있는지를 알려 준다', async () => {
    const { call } = await withDb();
    const r = await call('list_databases');
    const db = r.json.databases[0];
    expect(db).toMatchObject({ folder: '할일', title: '할 일', rows: 3 });
    const prop = (n: string) => db.properties.find((p: { name: string }) => p.name === n);
    expect(prop('상태')).toMatchObject({ type: 'status', options: ['할 일', '진행', '완료'], writable: true });
    expect(prop('합')).toMatchObject({ writable: false });
    expect(prop('관련')).toMatchObject({ writable: false });
    expect(prop('번호').note).toContain('automatically');
    expect(db.views.map((v: { name: string }) => v.name)).toEqual(['전체', '진행만']);
  });
  it('query_database: 보기·필터·정렬·한도', async () => {
    const { call } = await withDb();
    const all = await call('query_database', { database: '할일' });
    expect(all.json).toMatchObject({ total: 3, matched: 3 });
    const view = await call('query_database', { database: '할 일', view: '진행만' }); // 제목으로도, 보기 이름으로도
    expect(view.json.rows.map((x: { title: string }) => x.title).sort()).toEqual(['가', '다']);
    const f = await call('query_database', { database: '할일', filter: [{ prop: '점수', op: '>=', value: 5 }], sort: [{ prop: '점수', dir: 'desc' }] });
    expect(f.json.rows.map((x: { title: string }) => x.title)).toEqual(['다', '가']);
    expect(f.json.rows[0].values).toMatchObject({ 상태: '진행', 점수: 9, 분류: ['집'] });
    expect((await call('query_database', { database: '할일', limit: 1, offset: 1 })).json.rows).toHaveLength(1);
    expect((await call('query_database', { database: '할일', filter: [{ prop: '없는속성', op: '=', value: 1 }] })).isError).toBe(true);
    expect((await call('query_database', { database: '없는DB' })).text).toContain('list_databases');
  });
  it('읽기 전용이면 행 쓰기 도구가 없다', async () => {
    const { client } = await withDb();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['list_databases', 'query_database']));
    expect(names).not.toContain('add_database_row');
  });
  it('add_database_row: 검증해서 행을 만들고 고유 ID·created 를 붙인다', async () => {
    const { call, root } = await withDb(write);
    const r = await call('add_database_row', { database: '할일', title: '새 일', values: { 상태: '할 일', 점수: '7', 마감: '2026-12-25', 분류: ['회사', '집'] }, body: '메모' });
    expect(r.isError).toBe(false);
    expect(r.json.path).toBe('할일/새 일.md');
    const text = readFileSync(path.join(root, '할일/새 일.md'), 'utf8');
    expect(text).toMatch(/^---\n상태: 할 일\n점수: 7\n마감: 2026-12-25\n분류:\n {2}- 회사\n {2}- 집\n번호: 4\ncreated: \d{4}-\d\d-\d\dT[\d:+-]+\n---\n\n메모$/);
    // 새 행이 바로 질의에 잡힌다
    expect((await call('query_database', { database: '할일', filter: [{ prop: '번호', op: '=', value: 4 }] })).json.rows[0]).toMatchObject({ title: '새 일', values: { 점수: 7 } });
    // 같은 제목이면 번호를 붙인다
    expect((await call('add_database_row', { database: '할일', title: '새 일' })).json.path).toBe('할일/새 일 2.md');
  });
  it('add_database_row: 잘못된 값은 이유를 알려 주며 거부한다', async () => {
    const { call, root } = await withDb(write);
    const cases: [Record<string, unknown>, string][] = [
      [{ 없는: 1 }, '없는 속성'],
      [{ 상태: '몰라' }, '쓸 수 있는 옵션: 할 일, 진행, 완료'],
      [{ 점수: '많이' }, '형식으로 읽을 수 없어요'],
      [{ 합: 1 }, '계산되는 속성'],
      [{ 관련: ['[[가]]'] }, '양방향 관계'],
      [{ title: 'x' }, 'title 인자'],
    ];
    for (const [values, why] of cases) {
      const r = await call('add_database_row', { database: '할일', title: '거부', values });
      expect(r.isError, JSON.stringify(values)).toBe(true);
      expect(r.text).toContain(why);
    }
    expect(existsSync(path.join(root, '할일/거부.md'))).toBe(false);
  });
  it('add_database_row: 허용 폴더 밖 데이터베이스는 거부한다', async () => {
    const { call, root } = await withDb({ write: true, writeFolders: ['AI'] });
    const r = await call('add_database_row', { database: '할일', title: '몰래', values: { 점수: 1 } });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('forbidden-folder');
    expect(existsSync(path.join(root, '할일/몰래.md'))).toBe(false);
  });
  it('update_database_row: 프런트매터의 그 키만 바꾸고 본문은 그대로, null 은 비운다', async () => {
    const { call, root } = await withDb(write);
    const r = await call('update_database_row', { path: '할일/가.md', values: { 상태: '완료', 마감: null } });
    expect(r.isError).toBe(false);
    expect(readFileSync(path.join(root, '할일/가.md'), 'utf8')).toBe('---\n상태: 완료\n점수: 5\n번호: 1\n---\n# 가\n본문 가\n');
    expect((await call('update_database_row', { path: '할일/가.md', values: { 상태: '몰라' } })).isError).toBe(true);
    expect((await call('update_database_row', { path: '프로젝트/계획.md', values: { 상태: '완료' } })).text).toContain('데이터베이스의 행이 아니에요');
    expect((await call('update_database_row', { path: '할일/없음.md', values: { 점수: 1 } })).isError).toBe(true);
    // 같은 값이면 파일을 다시 쓰지 않는다
    const before = readAudit(root).length;
    await call('update_database_row', { path: '할일/가.md', values: { 상태: '완료' } });
    expect(readAudit(root).length).toBe(before);
  });
});

describe('MCP 서버 — 템플릿과 오늘의 노트', () => {
  const localDay = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  async function withTemplate(over: Partial<McpPolicy>) {
    const c = await connect(over);
    mkdirSync(path.join(c.root, '할일'));
    mkdirSync(path.join(c.root, '템플릿'));
    writeFileSync(path.join(c.root, '할일/_db.yaml'), 'title: 할 일\nproperties:\n  점수: { type: number }\ndefaultTemplate: 템플릿/할일.md\nviews:\n  - { id: v1, name: 표, type: table, sort: [] }\n');
    writeFileSync(path.join(c.root, '템플릿/할일.md'), '---\n점수: 1\n---\n## 메모\n\n{{title}} 을(를) 시작\n');
    return c;
  }
  it('add_database_row: 기본 템플릿을 적용하고 값으로 덮어쓴다', async () => {
    const { call, root } = await withTemplate({ write: true, writeFolders: ['할일'] });
    expect((await call('list_databases')).json.databases[0]).toMatchObject({ defaultTemplate: '템플릿/할일.md' });
    const r = await call('add_database_row', { database: '할일', title: '새 행', values: { 점수: 8 }, body: '추가 메모' });
    expect(r.isError).toBe(false);
    const text = readFileSync(path.join(root, '할일/새 행.md'), 'utf8');
    expect(text).toMatch(/^---\n점수: 8\ncreated: [^\n]+\n---\n## 메모\n\n새 행 을\(를\) 시작\n\n추가 메모$/);
    // 템플릿 없이
    const none = await call('add_database_row', { database: '할일', title: '빈 행', template: '' });
    expect(readFileSync(path.join(root, '할일/빈 행.md'), 'utf8')).not.toContain('## 메모');
    expect(none.isError).toBe(false);
    // 없는 템플릿
    expect((await call('add_database_row', { database: '할일', title: 'x', template: '템플릿/없음.md' })).text).toContain('템플릿 노트가 없어요');
  });
  it('append_to_daily_note: 없으면 만들고, 있으면 덧붙인다(폴더는 앱 설정을 따른다)', async () => {
    const { call, root } = await connect({ write: true, writeFolders: ['일기'] });
    const day = localDay();
    const a = await call('append_to_daily_note', { content: '- 첫 기록' });
    expect(a.isError).toBe(false);
    expect(a.json.path).toBe(`일기/${day}.md`);
    expect(readFileSync(path.join(root, `일기/${day}.md`), 'utf8')).toBe(`# ${day}\n\n- 첫 기록\n`);
    await call('append_to_daily_note', { content: '- 둘째 기록' });
    expect(readFileSync(path.join(root, `일기/${day}.md`), 'utf8')).toBe(`# ${day}\n\n- 첫 기록\n\n- 둘째 기록\n`);
    // 다른 날짜
    expect((await call('append_to_daily_note', { content: '과거', date: '2026-01-02' })).json.path).toBe('일기/2026-01-02.md');
    // 앱 설정의 데일리 폴더
    mkdirSync(path.join(root, '.nopsidian'), { recursive: true });
    writeFileSync(path.join(root, '.nopsidian/config.json'), JSON.stringify({ dailyFolder: '저널' }));
    const denied = await call('append_to_daily_note', { content: 'x' });
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain('forbidden-folder');
  });
});
