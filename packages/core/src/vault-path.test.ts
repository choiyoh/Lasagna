import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PathEscapeError, resolveInVault } from './vault-path.js';

function setup() {
  const base = mkdtempSync(path.join(tmpdir(), 'nops-'));
  const vault = path.join(base, 'vault');
  const outside = path.join(base, 'outside');
  mkdirSync(path.join(vault, 'sub'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'secret.txt'), 'x');
  return { vault, outside };
}

describe('resolveInVault', () => {
  it('볼트 안의 상대 경로(없는 파일 포함)를 허용한다', () => {
    const { vault } = setup();
    expect(resolveInVault(vault, 'sub/new.md')).toMatch(/sub[\\/]new\.md$/);
    expect(resolveInVault(vault, 'a/b/c.md')).toMatch(/a[\\/]b[\\/]c\.md$/);
  });

  it('.. 탈출을 막는다', () => {
    const { vault } = setup();
    expect(() => resolveInVault(vault, '../outside/secret.txt')).toThrow(PathEscapeError);
    expect(() => resolveInVault(vault, 'sub/../../x')).toThrow(PathEscapeError);
  });

  it('절대 경로와 NUL을 막는다', () => {
    const { vault } = setup();
    expect(() => resolveInVault(vault, '/etc/passwd')).toThrow(PathEscapeError);
    expect(() => resolveInVault(vault, 'a\0b')).toThrow(PathEscapeError);
  });

  it('심볼릭 링크로 볼트 밖을 가리키는 경로를 막는다', () => {
    const { vault, outside } = setup();
    symlinkSync(outside, path.join(vault, 'link'));
    expect(() => resolveInVault(vault, 'link/secret.txt')).toThrow(PathEscapeError);
    expect(() => resolveInVault(vault, 'link/new.txt')).toThrow(PathEscapeError);
  });
});
