import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PolicyError, canWrite, normalizeFolder, parseArgs, validateNotePath, type McpPolicy } from './policy.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const vault = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'nops-mcp-pol-'));
  dirs.push(d);
  return d;
};

describe('parseArgs', () => {
  it('기본은 읽기 전용', () => {
    const v = vault();
    const p = parseArgs(['--vault', v], {}) as McpPolicy;
    expect(p).toMatchObject({ root: v, write: false, writeFolders: [] });
  });
  it('--write 만 주면 AI 폴더에만 쓴다', () => {
    const p = parseArgs(['--vault', vault(), '--write'], {}) as McpPolicy;
    expect(p.write).toBe(true);
    expect(p.writeFolders).toEqual(['AI']);
  });
  it('--write-folder 는 여러 번, 중복 제거, . 은 볼트 전체', () => {
    const p = parseArgs(['--vault', vault(), '--write', '--write-folder', 'AI/', '--write-folder', '메모', '--write-folder', 'AI'], {}) as McpPolicy;
    expect(p.writeFolders).toEqual(['AI', '메모']);
    const all = parseArgs(['--vault', vault(), '--write', '--write-folder', '.'], {}) as McpPolicy;
    expect(all.writeFolders).toEqual(['']);
  });
  it('환경 변수로도 볼트를 받는다', () => {
    const v = vault();
    expect((parseArgs([], { NOPSIDIAN_VAULT: v }) as McpPolicy).root).toBe(v);
  });
  it('--help', () => expect(parseArgs(['--help'], {})).toBe('help'));
  it('잘못된 입력은 PolicyError', () => {
    const v = vault();
    expect(() => parseArgs([], {})).toThrow(PolicyError);
    expect(() => parseArgs(['--vault', path.join(v, '없음')], {})).toThrow(/볼트 폴더가 없어요/);
    expect(() => parseArgs(['--vault', v, '--write-folder', 'AI'], {})).toThrow(/--write 와 함께/);
    expect(() => parseArgs(['--vault', v, '--write', '--write-folder', '../x'], {})).toThrow(PolicyError);
    expect(() => parseArgs(['--vault', v, '--write', '--write-folder', '.nopsidian'], {})).toThrow(PolicyError);
    expect(() => parseArgs(['--vault', v, '--bogus'], {})).toThrow(/알 수 없는 옵션/);
    expect(() => parseArgs(['--vault', v, '--write', '--max-writes-per-minute', '0'], {})).toThrow(PolicyError);
    expect(() => parseArgs(['--vault'], {})).toThrow(/값이 필요/);
  });
});

describe('경로 검증', () => {
  it('상대 경로를 정규화하고 .md 를 붙인다', () => {
    expect(validateNotePath('AI/요약')).toBe('AI/요약.md');
    expect(validateNotePath('./AI\\요약.md')).toBe('AI/요약.md');
  });
  it('위험한 경로는 거부한다', () => {
    for (const bad of ['', '/etc/passwd', 'C:/x', '../밖', 'a/../../밖', '.nopsidian/x', 'AI/.숨김', 'a//b', 'a/b?.md', 'x\u0000y']) {
      expect(() => validateNotePath(bad), bad).toThrow(PolicyError);
    }
  });
  it('폴더 정규화', () => {
    expect(normalizeFolder('')).toBe('');
    expect(normalizeFolder('/AI/하위/')).toBe('AI/하위');
  });
  it('canWrite: 폴더 경계를 지킨다', () => {
    const p = { write: true, writeFolders: ['AI'] } as McpPolicy;
    expect(canWrite(p, 'AI/a.md')).toBe(true);
    expect(canWrite(p, 'AI/하위/a.md')).toBe(true);
    expect(canWrite(p, 'AIx/a.md')).toBe(false);
    expect(canWrite(p, 'a.md')).toBe(false);
    expect(canWrite({ write: true, writeFolders: [''] } as McpPolicy, 'a.md')).toBe(true);
    expect(canWrite({ write: false, writeFolders: [''] } as McpPolicy, 'a.md')).toBe(false);
  });
});
