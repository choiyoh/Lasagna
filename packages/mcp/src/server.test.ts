/* eslint-disable @typescript-eslint/no-explicit-any -- 테스트: 도구 결과(JSON)를 느슨하게 읽는다 */import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { readAudit } from './audit.js';
import { planRevert } from './revert.js';
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
    expect(names).toEqual(['get_backlinks', 'list_comments', 'list_databases', 'list_notes', 'list_tags', 'query_database', 'read_note', 'search_notes']);
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

describe('MCP 서버 — 긴 노트 페이징과 partial 해시', () => {
  const write = { write: true, writeFolders: ['AI'], maxBytes: 1_000_000 };
  // 4만 자를 넘기는 결정적 노트(한 줄마다 번호가 있어 순서가 뒤바뀌면 바로 드러난다)
  const LONG = `${Array.from({ length: 2000 }, (_, i) => `- line ${String(i).padStart(5, '0')} ${'x'.repeat(40)}`).join('\n')}\n`;

  async function withLongNote() {
    const c = await connect(write);
    mkdirSync(path.join(c.root, 'AI'), { recursive: true });
    const file = path.join(c.root, 'AI/long.md');
    writeFileSync(file, LONG);
    return { ...c, file };
  }

  it('잘린 내용을 partial 해시로 그대로 되쓰면 거부되고 파일은 그대로다(데이터 유실 회귀)', async () => {
    const { call, root, file } = await withLongNote();
    const before = readFileSync(file, 'utf8');
    const r = await call('read_note', { path: 'AI/long.md' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ truncated: true, total_chars: LONG.length, offset: 0, returned_chars: 40_000, next_offset: 40_000 });
    expect(r.json.content).toBe(LONG.slice(0, 40_000));
    expect(r.json.hash).toMatch(/^partial:[0-9a-f]{64}$/);

    const u = await call('update_note', { path: 'AI/long.md', content: r.json.content, base_hash: r.json.hash });
    expect(u.isError).toBe(true);
    expect(u.text).toContain('partial');
    expect(u.text).toContain('append_to_note');
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(readAudit(root).some((e) => e.action === 'denied' && e.tool === 'update_note')).toBe(true);
  });

  it('offset/next_offset 로 끝까지 읽으면 전체 내용이 그대로 맞아떨어진다', async () => {
    const { call } = await withLongNote();
    let text = '';
    let offset = 0;
    const pages: { hash: string; next_offset: number | null }[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await call('read_note', { path: 'AI/long.md', offset });
      expect(r.isError).toBe(false);
      text += r.json.content;
      pages.push({ hash: r.json.hash, next_offset: r.json.next_offset });
      if (r.json.next_offset === null) break;
      offset = r.json.next_offset;
    }
    expect(text).toBe(LONG);
    expect(pages).toHaveLength(3); // 108,000자 → 40,000 + 40,000 + 나머지
    expect(pages.map((p) => p.next_offset)).toEqual([40_000, 80_000, null]);
    expect(pages.every((p) => p.hash.startsWith('partial:'))).toBe(true); // 한 번에 다 못 읽으므로 모든 페이지가 부분 읽기
    // limit 을 주면 그만큼만 돌려준다
    const small = await call('read_note', { path: 'AI/long.md', offset: 0, limit: 10 });
    expect(small.json).toMatchObject({ returned_chars: 10, next_offset: 10, truncated: true });
    expect(small.json.content).toBe(LONG.slice(0, 10));
  });

  it('partial 해시라도 내용이 짧아지지 않으면 update_note 가 통과한다', async () => {
    const { call, file } = await withLongNote();
    const r = await call('read_note', { path: 'AI/long.md' });
    const edited = `${LONG}새 문단\n`;
    const u = await call('update_note', { path: 'AI/long.md', content: edited, base_hash: r.json.hash });
    expect(u.isError).toBe(false);
    expect(u.json.status).toBe('saved');
    expect(readFileSync(file, 'utf8')).toBe(edited);
  });

  it('읽은 뒤 디스크가 바뀐 partial 해시는 stale 로 거부된다', async () => {
    const { call, file } = await withLongNote();
    const r = await call('read_note', { path: 'AI/long.md' });
    writeFileSync(file, `${LONG}다른 사람이 고침\n`);
    const u = await call('update_note', { path: 'AI/long.md', content: `${LONG}내 편집\n`, base_hash: r.json.hash });
    expect(u.isError).toBe(true);
    expect(u.text).toContain('stale');
    expect(readFileSync(file, 'utf8')).toBe(`${LONG}다른 사람이 고침\n`);
  });

  it('짧은 노트는 접두사 없는 전체 해시·truncated=false·next_offset=null 이고 짧게 고쳐도 된다', async () => {
    const { call, root } = await connect({ write: true, writeFolders: ['AI'] });
    expect((await call('create_note', { path: 'AI/short', content: '# 짧음\n\n본문' })).isError).toBe(false);
    const r = await call('read_note', { path: 'AI/short' });
    expect(r.json.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.json).toMatchObject({ truncated: false, next_offset: null, offset: 0, returned_chars: r.json.content.length, total_chars: r.json.content.length });
    const u = await call('update_note', { path: 'AI/short', content: '짧게', base_hash: r.json.hash });
    expect(u.isError).toBe(false);
    expect(readFileSync(path.join(root, 'AI/short.md'), 'utf8')).toBe('짧게\n');
  });

  it('끝을 넘어선 offset 은 오류다', async () => {
    const { call } = await withLongNote();
    const past = await call('read_note', { path: 'AI/long.md', offset: LONG.length });
    expect(past.isError).toBe(true);
    expect(past.text).toContain('beyond the end');
    expect((await call('read_note', { path: 'AI/long.md', offset: LONG.length + 100 })).isError).toBe(true);
    // 경계: 마지막 한 글자부터는 읽힌다
    const last = await call('read_note', { path: 'AI/long.md', offset: LONG.length - 1 });
    expect(last.isError).toBe(false);
    expect(last.json).toMatchObject({ content: LONG.slice(-1), returned_chars: 1, next_offset: null, truncated: true });
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

describe('MCP 서버 — 댓글', () => {
  it('list_comments 는 읽기 전용에서도 되고, add_comment 는 쓰기를 켜야 있다', async () => {
    const ro = await connect();
    expect((await ro.client.listTools()).tools.map((t) => t.name)).not.toContain('add_comment');
    expect((await ro.call('list_comments', { path: '회의록' })).json).toMatchObject({ open: 0, comments: [] });
    expect((await ro.call('list_comments', { path: '없음' })).isError).toBe(true);
  });
  it('허용 폴더 밖의 노트에도 댓글을 달 수 있고(본문은 그대로), 기록과 함께 읽힌다', async () => {
    const { call, root } = await connect({ write: true, writeFolders: ['AI'] });
    const before = readFileSync(path.join(root, '회의록.md'), 'utf8');
    const r = await call('add_comment', { path: '회의록', text: '결론이 빠졌어요', quote: '오늘 [[계획]] 을 논의했다.' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ path: '회의록.md', author: 'test-agent' });
    expect(readFileSync(path.join(root, '회의록.md'), 'utf8')).toBe(before);
    const l = await call('list_comments', { path: '회의록.md' });
    expect(l.json).toMatchObject({ open: 1 });
    expect(l.json.comments[0]).toMatchObject({ author: 'test-agent', text: '결론이 빠졌어요', quote: '오늘 [[계획]] 을 논의했다.' });
    expect(readAudit(root)[0]).toMatchObject({ action: 'comment', path: '회의록.md', client: 'test-agent' });
    // 없는 노트·빈 댓글
    expect((await call('add_comment', { path: '없음', text: 'x' })).text).toContain('not-found');
    expect((await call('add_comment', { path: '회의록', text: '   ' })).isError).toBe(true);
  });
});

describe('MCP 서버 — 앱 정책 파일', () => {
  const write = { write: true, writeFolders: ['AI'] };
  const policyPath = (root: string) => path.join(root, '.nopsidian', 'mcp-policy.json');
  const setPolicy = (root: string, over: Record<string, unknown> = {}) => {
    mkdirSync(path.dirname(policyPath(root)), { recursive: true });
    writeFileSync(policyPath(root), JSON.stringify({ version: 1, write: true, writeFolders: ['AI'], maxWritesPerMinute: 30, ...over }));
  };

  it('파일이 없으면 서버 인자 그대로 동작한다', async () => {
    const { call } = await connect(write);
    const p = await call('get_write_policy');
    expect(p.json).toMatchObject({ write: true, source: 'args', reason: null });
    expect((await call('create_note', { path: 'AI/no-policy', content: 'x' })).isError).toBe(false);
  });

  it('파일이 쓰기를 끄면 도구는 남아 있고 다음 쓰기부터 policy-disabled 로 거부하며, 다시 켜면 복구한다', async () => {
    const { call, root, client } = await connect(write);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('create_note');

    setPolicy(root, { write: false });
    const denied = await call('create_note', { path: 'AI/blocked', content: 'x' });
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain('policy-disabled');
    expect(existsSync(path.join(root, 'AI/blocked.md'))).toBe(false);
    expect(readAudit(root).some((e) => e.action === 'denied' && e.tool === 'create_note')).toBe(true);
    expect((await call('get_write_policy')).json).toMatchObject({ write: false, source: 'file', reason: 'policy-disabled' });

    setPolicy(root, { write: true });
    expect((await call('create_note', { path: 'AI/recovered', content: 'x' })).isError).toBe(false);
    expect((await call('get_write_policy')).json).toMatchObject({ write: true, source: 'file', reason: null });
  });

  it('깨진 파일은 policy-invalid 로 안전하게 거부하고 이유를 보여 준다', async () => {
    const { call, root } = await connect(write);
    mkdirSync(path.dirname(policyPath(root)), { recursive: true });
    writeFileSync(policyPath(root), '{깨짐');
    const denied = await call('create_note', { path: 'AI/invalid', content: 'x' });
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain('policy-invalid');
    expect((await call('get_write_policy')).json).toMatchObject({ write: false, reason: 'policy-invalid' });
  });

  it('파일 폴더와 인자 폴더의 교집합만 허용한다', async () => {
    const { call, root } = await connect({ write: true, writeFolders: ['AI', '일기'] });
    setPolicy(root, { writeFolders: ['AI'] });
    expect((await call('create_note', { path: 'AI/inside', content: 'x' })).isError).toBe(false);
    const out = await call('create_note', { path: '일기/outside', content: 'x' });
    expect(out.isError).toBe(true);
    expect(out.text).toContain('forbidden-folder');
    expect((await call('get_write_policy')).json).toMatchObject({ folders: ['AI'], source: 'file' });
  });

  it('파일이 쓰기를 끄면 add_comment 도 거부한다', async () => {
    const { call, root } = await connect(write);
    setPolicy(root, { write: false });
    const r = await call('add_comment', { path: '회의록', text: '정책 확인' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('policy-disabled');
    expect(readAudit(root).some((e) => e.action === 'denied' && e.tool === 'add_comment')).toBe(true);
  });

  it('.nopsidian 안에는 MCP 쓰기 도구로 쓸 수 없다', async () => {
    const { call } = await connect({ write: true, writeFolders: [''] });
    const r = await call('create_note', { path: '.nopsidian/정책', content: 'x' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('bad-input');
  });
});

describe('MCP 서버 — edit_note', () => {
  const write = { write: true, writeFolders: ['AI'] };

  it('정확히 한 곳만 바꾸고 감사·버전 기록에 남긴다', async () => {
    const { call, root } = await connect(write);
    expect((await call('create_note', { path: 'AI/edit', content: '# 편집\n\n빨강 사과 하나' })).isError).toBe(false);
    const r = await call('read_note', { path: 'AI/edit' });
    const e = await call('edit_note', { path: 'AI/edit', old_text: '빨강 사과', new_text: '초록 사과', base_hash: r.json.hash });
    expect(e.isError).toBe(false);
    expect(readFileSync(path.join(root, 'AI/edit.md'), 'utf8')).toBe('# 편집\n\n초록 사과 하나\n');
    const entry = readAudit(root).find((x) => x.tool === 'edit_note')!;
    expect(entry).toMatchObject({ action: 'update', path: 'AI/edit.md' });
    const revert = planRevert(root, entry.t, entry.path);
    expect(revert.plan).toMatchObject({ action: 'restore' });
    if (revert.plan.action === 'restore') expect(revert.plan.content).toContain('빨강 사과');
  });

  it('0곳·2곳 이상은 일치 개수를 담아 거부하고 파일을 바꾸지 않는다', async () => {
    const { call, root } = await connect(write);
    expect((await call('create_note', { path: 'AI/repeat', content: '# 제목\n\n반복 반복' })).isError).toBe(false);
    const before = readFileSync(path.join(root, 'AI/repeat.md'), 'utf8');
    const r = await call('read_note', { path: 'AI/repeat' });
    const two = await call('edit_note', { path: 'AI/repeat', old_text: '반복', new_text: '한 번', base_hash: r.json.hash });
    expect(two.isError).toBe(true);
    expect(two.text).toContain('2 occurrences');
    const none = await call('edit_note', { path: 'AI/repeat', old_text: '없는 말', new_text: 'x', base_hash: r.json.hash });
    expect(none.isError).toBe(true);
    expect(none.text).toContain('0 occurrences');
    expect(readFileSync(path.join(root, 'AI/repeat.md'), 'utf8')).toBe(before);
    expect(readAudit(root).filter((e) => e.action === 'denied' && e.tool === 'edit_note').length).toBeGreaterThanOrEqual(2);
  });

  it('낡은 해시와 허용 폴더 밖은 거부한다', async () => {
    const { call, root } = await connect(write);
    await call('create_note', { path: 'AI/stale', content: '처음' });
    const r = await call('read_note', { path: 'AI/stale' });
    await call('append_to_note', { path: 'AI/stale', content: '바뀜' });
    const stale = await call('edit_note', { path: 'AI/stale', old_text: '처음', new_text: '다시', base_hash: r.json.hash });
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain('stale');
    const outside = await call('read_note', { path: '프로젝트/계획.md' });
    const denied = await call('edit_note', { path: '프로젝트/계획.md', old_text: '설계', new_text: '다른 설계', base_hash: outside.json.hash });
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain('forbidden-folder');
    expect(readFileSync(path.join(root, '프로젝트/계획.md'), 'utf8')).toContain('설계');
  });

  it('긴 노트의 partial 해시로도 한 곳만 바꾼다(전체를 잃지 않는다)', async () => {
    const { call, root } = await connect(write);
    const long = `${Array.from({ length: 1200 }, (_, i) => `- line ${String(i).padStart(5, '0')} ${'x'.repeat(40)}`).join('\n')}\n`;
    mkdirSync(path.join(root, 'AI'), { recursive: true });
    writeFileSync(path.join(root, 'AI/long-edit.md'), long);
    const first = await call('read_note', { path: 'AI/long-edit.md' });
    expect(first.json.hash).toMatch(/^partial:/);
    const e = await call('edit_note', { path: 'AI/long-edit.md', old_text: 'line 00001', new_text: 'line EDITED', base_hash: first.json.hash });
    expect(e.isError).toBe(false);
    const after = readFileSync(path.join(root, 'AI/long-edit.md'), 'utf8');
    expect(after).toContain('line EDITED');
    expect(after.length).toBeGreaterThan(40_000);
    expect(after).toContain('line 01199');
  });

  it('프런트매터 안의 문자열도 바꾼다', async () => {
    const { call, root } = await connect(write);
    expect((await call('create_note', { path: 'AI/fm', content: '---\ntitle: 옛 제목\n---\n# 본문\n' })).isError).toBe(false);
    const r = await call('read_note', { path: 'AI/fm' });
    const e = await call('edit_note', { path: 'AI/fm', old_text: 'title: 옛 제목', new_text: 'title: 새 제목', base_hash: r.json.hash });
    expect(e.isError).toBe(false);
    expect(readFileSync(path.join(root, 'AI/fm.md'), 'utf8')).toContain('title: 새 제목');
  });

  it('CRLF 노트는 LF 로 준 old_text 도 찾고 줄바꿈 표기를 유지한다', async () => {
    const { call, root } = await connect(write);
    mkdirSync(path.join(root, 'AI'), { recursive: true });
    writeFileSync(path.join(root, 'AI/crlf.md'), '# CRLF\r\n\r\n- 하나\r\n- 둘\r\n');
    const r = await call('read_note', { path: 'AI/crlf.md' });
    const e = await call('edit_note', { path: 'AI/crlf.md', old_text: '- 하나\n- 둘', new_text: '- ONE\n- TWO', base_hash: r.json.hash });
    expect(e.isError).toBe(false);
    const text = readFileSync(path.join(root, 'AI/crlf.md'), 'utf8');
    expect(text).toContain('- ONE\r\n- TWO\r\n');
    expect(text).not.toMatch(/[^\r]\n/);
  });

  it('NFD 노트는 NFC 로 준 old_text 도 찾고 표기를 유지한다', async () => {
    const { call, root } = await connect(write);
    mkdirSync(path.join(root, 'AI'), { recursive: true });
    writeFileSync(path.join(root, 'AI/nfd.md'), `# ${'한글'.normalize('NFD')}\n\n${'수정 전'.normalize('NFD')}\n`);
    const r = await call('read_note', { path: 'AI/nfd.md' });
    const e = await call('edit_note', { path: 'AI/nfd.md', old_text: '수정 전', new_text: '수정 후', base_hash: r.json.hash });
    expect(e.isError).toBe(false);
    expect(readFileSync(path.join(root, 'AI/nfd.md'), 'utf8')).toContain('수정 후'.normalize('NFD'));
  });
});
