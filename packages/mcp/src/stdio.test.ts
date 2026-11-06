import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { settingsPaths } from './lang.js';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// 실제 stdio MCP 서버를 띄워 언어(환경변수·설정 파일·OS 로캘)별 출력을 확인한다.
const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;
const PKG = path.resolve(__dirname, '..');
const BIN = path.join(PKG, 'dist', 'nopsidian-mcp.mjs');
let root = '';

beforeAll(() => {
  execFileSync(process.execPath, ['build.mjs'], { cwd: PKG, stdio: 'ignore' });
  root = mkdtempSync(path.join(tmpdir(), 'nops-mcp-stdio-'));
  mkdirSync(path.join(root, 'AI'), { recursive: true });
  mkdirSync(path.join(root, '할일'), { recursive: true });
  writeFileSync(path.join(root, '할일', '_db.yaml'), 'title: 할 일\nproperties:\n  점수: { type: number }\n');
  writeFileSync(path.join(root, 'note.md'), '# note\n');
}, 120_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

interface Session {
  send(msg: Record<string, unknown>): void;
  read(id: number): Promise<Record<string, unknown>>;
  close(): void;
}

function start(env: NodeJS.ProcessEnv): Session {
  const child = spawn(process.execPath, [BIN, '--vault', root, '--write'], {
    env: { PATH: process.env.PATH ?? '', HOME: root, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const waiting = new Map<number, (v: Record<string, unknown>) => void>();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += String(chunk);
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) {
        const msg = JSON.parse(line) as { id?: number };
        if (typeof msg.id === 'number') waiting.get(msg.id)?.(msg as Record<string, unknown>);
      }
      nl = buffer.indexOf('\n');
    }
  });
  const send = (msg: Record<string, unknown>) => child.stdin.write(`${JSON.stringify(msg)}\n`);
  return {
    send,
    read: (id: number) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout: ${id}`)), 15_000);
        waiting.set(id, (v) => {
          clearTimeout(timer);
          resolve(v);
        });
      }),
    close: () => child.kill(),
  };
}

async function handshake(session: Session) {
  session.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stdio-test', version: '1.0.0' } } });
  await session.read(1);
  session.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  session.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const listed = (await session.read(2)) as { result: { tools: { name: string; description?: string; inputSchema: { properties?: Record<string, unknown> } }[] } };
  return listed.result.tools;
}

describe('실제 stdio MCP 서버의 언어', () => {
  it('NOPSIDIAN_LANG=en 이면 도구 설명에 한글이 없고 스키마는 ko 와 같다', async () => {
    const en = start({ NOPSIDIAN_LANG: 'en' });
    const ko = start({ NOPSIDIAN_LANG: 'ko' });
    try {
      const enTools = await handshake(en);
      const koTools = await handshake(ko);
      const shape = (tools: typeof enTools) => tools.map((t) => ({ name: t.name, keys: Object.keys(t.inputSchema.properties ?? {}).sort() }));
      expect(shape(enTools)).toEqual(shape(koTools));
      expect(JSON.stringify(enTools)).not.toMatch(HANGUL);
      expect(JSON.stringify(koTools.map((t) => t.description))).toMatch(HANGUL); // ko 는 base 한국어 유지
    } finally {
      en.close();
      ko.close();
    }
  });

  it('설정 파일(en)만 있어도 영어이고, OS 로캘에 언어가 없으면 ko', async () => {
    const legacy = mkdtempSync(path.join(tmpdir(), 'nops-mcp-home-'));
    try {
      // 이 OS 의 userData 규칙대로 설정 파일을 만든다(테스트 HOME 기준)
      const settings = settingsPaths(process.platform, legacy, { XDG_CONFIG_HOME: path.join(legacy, '.config') })[0]!;
      mkdirSync(path.dirname(settings), { recursive: true });
      writeFileSync(settings, JSON.stringify({ version: 1, language: 'en' }));
      const fromFile = start({ HOME: legacy, XDG_CONFIG_HOME: path.join(legacy, '.config'), LANG: 'C' });
      try {
        const tools = await handshake(fromFile);
        expect(JSON.stringify(tools)).not.toMatch(HANGUL);
      } finally {
        fromFile.close();
      }
      const noLocale = start({ HOME: path.join(legacy, 'empty-home'), XDG_CONFIG_HOME: path.join(legacy, 'nope'), LANG: '' });
      try {
        const tools = await handshake(noLocale);
        expect(JSON.stringify(tools.map((t) => t.description))).toMatch(HANGUL);
      } finally {
        noLocale.close();
      }
    } finally {
      rmSync(legacy, { recursive: true, force: true });
    }
  });

  it('설정이 system 이고 OS 로캘 정보가 없으면 ko 로 뜬다', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'nops-mcp-sys-'));
    try {
      const settings = settingsPaths(process.platform, home, { XDG_CONFIG_HOME: path.join(home, '.config') })[0]!;
      mkdirSync(path.dirname(settings), { recursive: true });
      writeFileSync(settings, JSON.stringify({ version: 1, language: 'system' }));
      const session = start({ HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), LANG: 'C' });
      try {
        const tools = await handshake(session);
        expect(JSON.stringify(tools.map((t) => t.description))).toMatch(HANGUL);
      } finally {
        session.close();
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('템플릿 경로 오류가 두 언어 모두 한 문장으로 나온다', async () => {
    const call = async (locale: 'ko' | 'en') => {
      const session = start({ NOPSIDIAN_LANG: locale });
      try {
        await handshake(session);
        session.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'add_database_row', arguments: { database: '할일', title: 'x', template: '.bad' } } });
        const res = (await session.read(3)) as { result: { content: { text: string }[] } };
        return res.result.content[0]!.text;
      } finally {
        session.close();
      }
    };
    const koText = await call('ko');
    const enText = await call('en');
    expect(koText).toContain('템플릿 경로가 올바르지 않아요: 점(.)으로 시작하는 폴더·파일은 쓸 수 없어요');
    expect(enText).toContain('The template path is not valid (a name starts with a dot)');
    expect(enText).not.toMatch(HANGUL);
    expect(enText).not.toMatch(/\{\}/);
    expect(enText).not.toMatch(/cannot start with a dot/);
  });

  it('대표 오류도 영어로 나온다(허용 폴더 밖 쓰기)', async () => {
    const session = start({ NOPSIDIAN_LANG: 'en' });
    try {
      await handshake(session);
      session.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_note', arguments: { path: 'other.md', content: '# x' } } });
      const res = (await session.read(3)) as { result: { content: { text: string }[] } };
      expect(res.result.content[0]!.text).toContain('Writes are not allowed in this folder');
      expect(res.result.content[0]!.text).not.toMatch(HANGUL);
    } finally {
      session.close();
    }
  });
});
