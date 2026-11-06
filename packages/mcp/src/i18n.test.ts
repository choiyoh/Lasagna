import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import type { McpPolicy } from './policy.js';
import { usage } from './policy.js';
import { createServer } from './server.js';
import { NoteWriter } from './writer.js';
import { tr } from './i18n.js';

const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;
const dirs: string[] = [];
afterEach(() => {
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
  setLocale('ko');
});

async function connect(locale: 'ko' | 'en', over: Partial<McpPolicy> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'nops-mcp-i18n-'));
  dirs.push(root);
  mkdirSync(path.join(root, 'AI'));
  writeFileSync(path.join(root, 'note.md'), '# note\n');
  setLocale(locale);
  const policy: McpPolicy = { root, write: true, writeFolders: ['AI'], maxWritesPerMinute: 30, maxBytes: 1000, ...over };
  const { server } = createServer(policy);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-agent', version: '1.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
  return { client, call, root };
}

describe('MCP 서버 문구의 로캘', () => {
  it('영어에서는 도구 설명·스키마 설명에 한글이 없고, 스키마 구조는 ko 와 같다', async () => {
    const ko = await connect('ko');
    const en = await connect('en');
    const koTools = (await ko.client.listTools()).tools;
    const enTools = (await en.client.listTools()).tools;
    const shape = (tools: typeof koTools) =>
      tools.map((t) => ({ name: t.name, keys: Object.keys(t.inputSchema.properties ?? {}).sort() })).sort((a, b) => a.name.localeCompare(b.name));
    expect(shape(enTools)).toEqual(shape(koTools));

    const jsons = [JSON.stringify(enTools.map((t) => t.description ?? '')), JSON.stringify(enTools.map((t) => t.inputSchema))];
    for (const json of jsons) expect(json).not.toMatch(HANGUL);
  });

  it('대표 오류가 화면 언어를 따른다(쓰기 금지 폴더·읽기 전용)', async () => {
    const en = await connect('en');
    const denied = await en.call('create_note', { path: 'note2.md', content: '# x' });
    expect(denied.isError).toBe(true);
    const english = en.client;
    const text = denied.content[0]!.text;
    expect(text).toContain('Writes are not allowed in this folder');
    expect(text).not.toMatch(HANGUL);

    const ko = await connect('ko');
    const deniedKo = await ko.call('create_note', { path: 'note2.md', content: '# x' });
    expect(deniedKo.content[0]!.text).toContain('이 폴더에는 쓸 수 없어요');
    void english;
  });

  it('도움말(usage)도 언어를 따른다', () => {
    setLocale('ko');
    expect(usage()).toContain('사용법: node nopsidian-mcp.mjs');
    setLocale('en');
    expect(usage()).toContain('Usage: node nopsidian-mcp.mjs');
    expect(usage()).not.toMatch(HANGUL);
  });
});

describe('정책 거부·감사·폴더 규칙', () => {
  it('정책 파일이 쓰기를 끄면 응답은 지금 언어, 감사 note 는 base(ko) 값', async () => {
    const en = await connect('en', { write: true, writeFolders: ['AI'] });
    mkdirSync(path.join(en.root, '.nopsidian'), { recursive: true });
    writeFileSync(path.join(en.root, '.nopsidian', 'mcp-policy.json'), JSON.stringify({ version: 1, write: false, writeFolders: ['AI'], maxWritesPerMinute: 30 }));
    // 서버는 정책 파일을 요청마다 다시 읽는다
    const denied = await en.call('create_note', { path: 'AI/new.md', content: '# x' });
    expect(denied.content[0]!.text).toContain('Writing is turned off in the app settings');
    expect(denied.content[0]!.text).not.toMatch(HANGUL);
    const audit = readFileSync(path.join(en.root, '.nopsidian', 'mcp-audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const denial = audit.find((a) => a.action === 'denied');
    expect(denial.note).toContain('앱 설정에서 쓰기를 꺼 두었어요');
  });

  it('정책 파일이 없고 이미 일기 폴더가 있으면 영어 서버도 그 폴더를 쓴다', async () => {
    const en = await connect('en', { write: true, writeFolders: [''] });
    mkdirSync(path.join(en.root, '일기'), { recursive: true });
    const r = await en.call('append_to_daily_note', { date: '2026-11-05', content: 'hi' });
    if (r.isError) throw new Error(r.content[0]!.text);
    expect(existsSync(path.join(en.root, '일기', '2026-11-05.md'))).toBe(true);
    expect(existsSync(path.join(en.root, 'Journal'))).toBe(false);
  });

  it('잘못된 경로의 감사 note 도 base(ko)로 저장하고 응답만 영어', async () => {
    const en = await connect('en', { write: true, writeFolders: ['AI'] });
    const r = await en.call('create_note', { path: '.hidden.md', content: '# x' });
    expect(r.content[0]!.text).toContain('cannot start with a dot');
    const audit = readFileSync(path.join(en.root, '.nopsidian', 'mcp-audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const denial = audit.find((a) => a.action === 'denied');
    expect(denial.note).toContain('점(.)으로 시작하는 폴더·파일은 쓸 수 없어요');
    expect(denial.note).not.toMatch(/cannot start/);
  });

  it('템플릿 경로 오류는 문장을 끼우지 않는다(ko base 동일·en 이유 명사구)', () => {
    const ko = tr('mcpDb.err.badTemplatePath', { message: tr('mcpPolicy.err.dotName'), reason: '' });
    expect(ko).toBe('템플릿 경로가 올바르지 않아요: 점(.)으로 시작하는 폴더·파일은 쓸 수 없어요');
    setLocale('en');
    const en = tr('mcpDb.err.badTemplatePath', { message: '', reason: tr('mcpDb.reason.dotName') });
    setLocale('ko');
    expect(en).toBe('The template path is not valid: a name starts with a dot');
    expect(en).not.toMatch(HANGUL);
  });

  it('댓글 fallback 작성자는 언어와 무관하게 base 값으로 저장한다', async () => {
    const en = await connect('en', { write: true, writeFolders: ['AI'] });
    // 클라이언트 이름이 없는 writer(앱이 직접 띄운 stdio 서버와 같은 상태)
    const writer = new NoteWriter({ root: en.root, write: true, writeFolders: ['AI'], maxWritesPerMinute: 30, maxBytes: 100_000 } as never);
    writer.comment('add_comment', 'note.md', 'hi');
    const dir = path.join(en.root, '.nopsidian', 'comments');
    const raw = readFileSync(path.join(dir, readdirSync(dir)[0]!), 'utf8');
    expect(raw).toContain('AI 에이전트');
  });
});
