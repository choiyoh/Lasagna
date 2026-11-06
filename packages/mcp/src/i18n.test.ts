import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import type { McpPolicy } from './policy.js';
import { usage } from './policy.js';
import { createServer } from './server.js';

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
