import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDirectRun, main } from './cli.js';

afterEach(() => vi.restoreAllMocks());

describe('isDirectRun', () => {
  it('실행 인자가 이 모듈이면 직접 실행이다', () => {
    expect(isDirectRun(['/usr/bin/node', fileURLToPath(import.meta.url)], import.meta.url)).toBe(true);
  });
  it('앱이 불러 쓸 때(인자가 다르거나 없을 때)는 직접 실행이 아니다', () => {
    expect(isDirectRun(['/Applications/Nopsidian.app/Contents/MacOS/nopsidian', '--mcp-stdio', '--vault', '/v'], import.meta.url)).toBe(false);
    expect(isDirectRun(['/usr/bin/node', '.'], import.meta.url)).toBe(false);
    expect(isDirectRun(['/usr/bin/node'], import.meta.url)).toBe(false);
    expect(isDirectRun(['/usr/bin/node', '/없는/파일.mjs'], import.meta.url)).toBe(false);
  });
});

describe('main', () => {
  it('--help 는 사용법을 stdout 으로 내고 0 을 돌려준다', async () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    });
    expect(await main(['--help'])).toBe(0);
    expect(out.join('')).toContain('사용법: node nopsidian-mcp.mjs');
  });

  it('잘못된 인자는 stderr 로 알리고 2 를 돌려준다', async () => {
    const err: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      err.push(String(chunk));
      return true;
    });
    expect(await main(['--vault', '/없는/볼트/경로'])).toBe(2);
    expect(err.join('')).toContain('볼트 폴더가 없어요');
    expect(err.join('')).toContain('사용법');
  });
});
