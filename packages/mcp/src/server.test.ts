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
    expect(names).toEqual(['get_backlinks', 'list_notes', 'list_tags', 'read_note', 'search_notes']);
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
