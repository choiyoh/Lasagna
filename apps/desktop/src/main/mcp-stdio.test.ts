import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runMcpStdio, type RunMcpStdioOptions } from './mcp-stdio';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** resources/ 같은 임시 폴더에 가짜 MCP 서버 번들을 만든다 */
const resources = (source?: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nops-mcp-stdio-'));
  dirs.push(dir);
  if (source !== undefined) writeFileSync(path.join(dir, 'nopsidian-mcp.mjs'), source);
  return dir;
};

const opts = (resourcesPath: string, extra: Partial<RunMcpStdioOptions> = {}): RunMcpStdioOptions => ({
  packaged: true,
  resourcesPath,
  appPath: '/앱/Contents/Resources/app.asar',
  ...extra,
});

describe('runMcpStdio', () => {
  it('서버 번들이 없으면 stderr 로 알리고 1 을 돌려준다', async () => {
    const err: string[] = [];
    const code = await runMcpStdio(['--vault', '/볼트'], opts(resources(), { stderr: (t) => err.push(t) }));
    expect(code).toBe(1);
    expect(err.join('')).toContain('서버 파일이 없어요');
    expect(err.join('')).toContain('nopsidian-mcp.mjs');
  });

  it('번들을 불러 인자를 그대로 넘기고 서버가 준 종료 코드를 돌려준다', async () => {
    const dir = resources("import { writeFileSync } from 'node:fs';\nexport async function main(argv) { writeFileSync(new URL('./args.json', import.meta.url), JSON.stringify(argv)); return 7; }\n");
    const err: string[] = [];
    const code = await runMcpStdio(['--vault', '/볼트', '--write'], opts(dir, { stderr: (t) => err.push(t) }));
    expect(code).toBe(7);
    expect(JSON.parse(readFileSync(path.join(dir, 'args.json'), 'utf8'))).toEqual(['--vault', '/볼트', '--write']);
    expect(err).toEqual([]);
  });

  it('개발 중에는 저장소의 빌드 결과를 불러온다', async () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'nops-mcp-repo-'));
    dirs.push(repo);
    const dist = path.join(repo, 'packages/mcp/dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(path.join(dist, 'nopsidian-mcp.mjs'), 'export function main() { return 0; }\n');
    const code = await runMcpStdio([], { packaged: false, appPath: path.join(repo, 'apps/desktop'), resourcesPath: '/무시' });
    expect(code).toBe(0);
  });

  it('main 이 없는 번들이면 1 을 돌려준다', async () => {
    const err: string[] = [];
    const code = await runMcpStdio([], opts(resources('export const 다른것 = 1;\n'), { stderr: (t) => err.push(t) }));
    expect(code).toBe(1);
    expect(err.join('')).toContain('main 이 없어요');
  });

  it('main 이 던지면 stderr 로 남기고 1 을 돌려준다', async () => {
    const err: string[] = [];
    const code = await runMcpStdio([], opts(resources('export function main() { throw new Error("망했어요"); }\n'), { stderr: (t) => err.push(t) }));
    expect(code).toBe(1);
    expect(err.join('')).toContain('망했어요');
  });
});
