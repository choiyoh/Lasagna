import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { effectivePolicy, intersectWriteFolders, policyPath, readPolicyFile, writePolicyFile, type PolicyFile } from './policy-file.js';
import type { McpPolicy } from './policy.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const vault = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'nops-mcp-policy-'));
  dirs.push(d);
  return d;
};

const args = (over: Partial<McpPolicy> = {}): McpPolicy => ({
  root: vault(),
  write: true,
  writeFolders: ['AI'],
  maxWritesPerMinute: 30,
  maxBytes: 1_000_000,
  ...over,
});

const file = (over: Partial<PolicyFile> = {}): PolicyFile => ({ version: 1, write: true, writeFolders: ['AI'], maxWritesPerMinute: 30, ...over });

describe('정책 파일', () => {
  it('없으면 missing, 정상 파일은 정규화해서 읽는다', () => {
    const root = vault();
    expect(readPolicyFile(root)).toEqual({ kind: 'missing' });
    mkdirSync(path.dirname(policyPath(root)), { recursive: true });
    writeFileSync(policyPath(root), JSON.stringify(file({ writeFolders: ['/AI/하위/', 'AI/하위'] })));
    expect(readPolicyFile(root)).toEqual({ kind: 'ok', policy: file({ writeFolders: ['AI/하위'] }) });
  });

  it('깨진 JSON·모르는 버전·잘못된 폴더·필수 값 누락은 invalid', () => {
    const root = vault();
    mkdirSync(path.dirname(policyPath(root)), { recursive: true });
    const cases = [
      '{깨짐',
      JSON.stringify({ ...file(), version: 2 }),
      JSON.stringify({ ...file(), writeFolders: ['..'] }),
      JSON.stringify({ ...file(), write: true, writeFolders: [] }),
      JSON.stringify({ ...file(), maxWritesPerMinute: 0 }),
      JSON.stringify({ ...file(), extra: true }),
    ];
    for (const raw of cases) {
      writeFileSync(policyPath(root), raw);
      expect(readPolicyFile(root).kind, raw).toBe('invalid');
    }
  });

  it('앱이 쓰면 폴더를 정규화·중복 제거하고 원자적으로 저장한다', () => {
    const root = vault();
    const written = writePolicyFile(root, { version: 1, write: true, writeFolders: ['/AI/', 'AI', '일기'], maxWritesPerMinute: 12 });
    expect(written.writeFolders).toEqual(['AI', '일기']);
    expect(existsSync(policyPath(root))).toBe(true);
    expect(JSON.parse(readFileSync(policyPath(root), 'utf8'))).toMatchObject({ version: 1, write: true, writeFolders: ['AI', '일기'], maxWritesPerMinute: 12 });
    expect(() => writePolicyFile(root, { version: 1, write: true, writeFolders: [], maxWritesPerMinute: 30 })).toThrow(/허용 폴더/);
    expect(() => writePolicyFile(root, { version: 1, write: true, writeFolders: ['../밖'], maxWritesPerMinute: 30 })).toThrow();
  });
});

describe('인자와 정책 파일의 교집합', () => {
  it('더 좁은 폴더만 남기고 상위 폴더 중복을 정리한다', () => {
    expect(intersectWriteFolders(['AI'], ['AI', '일기'])).toEqual(['AI']);
    expect(intersectWriteFolders([''], ['AI'])).toEqual(['AI']);
    expect(intersectWriteFolders(['AI', '일기'], ['AI', '일기'])).toEqual(['AI', '일기']);
    expect(intersectWriteFolders(['Daily'], ['Daily/2026'])).toEqual(['Daily/2026']);
    expect(intersectWriteFolders(['Daily/2026'], ['Daily'])).toEqual(['Daily/2026']);
    expect(intersectWriteFolders(['AI'], ['메모'])).toEqual([]);
    expect(intersectWriteFolders([''], ['AI', 'AI/하위'])).toEqual(['AI']);
  });

  it('파일이 없으면 인자 그대로 쓴다', () => {
    const p = args({ writeFolders: ['AI', '일기'], maxWritesPerMinute: 40 });
    expect(effectivePolicy(p, { kind: 'missing' })).toMatchObject({ write: true, writeFolders: ['AI', '일기'], maxWritesPerMinute: 40, source: 'args' });
  });

  it('파일이 쓰기를 끄거나 깨졌으면 쓰기를 거부한다', () => {
    const p = args();
    const off = effectivePolicy(p, { kind: 'ok', policy: file({ write: false }) });
    expect(off).toMatchObject({ write: false, reason: 'policy-disabled', source: 'file' });
    const bad = effectivePolicy(p, { kind: 'invalid', error: '깨짐', code: 'invalidJson' });
    expect(bad).toMatchObject({ write: false, reason: 'policy-invalid', message: '깨짐', source: 'file' });
  });

  it('폴더는 교집합, 횟수는 더 작은 값을 쓴다', () => {
    const p = args({ writeFolders: ['AI', '일기'], maxWritesPerMinute: 30 });
    expect(effectivePolicy(p, { kind: 'ok', policy: file({ writeFolders: ['AI', '메모'], maxWritesPerMinute: 7 }) })).toMatchObject({
      write: true,
      writeFolders: ['AI'],
      maxWritesPerMinute: 7,
      source: 'file',
    });
    expect(effectivePolicy(p, { kind: 'ok', policy: file({ writeFolders: ['메모'] }) })).toMatchObject({
      write: false,
      writeFolders: [],
      reason: 'policy-disabled',
    });
  });

  it('인자가 읽기 전용이면 파일이 켜져 있어도 읽기 전용이다', () => {
    const p = args({ write: false, writeFolders: [] });
    expect(effectivePolicy(p, { kind: 'ok', policy: file() })).toMatchObject({ write: false, source: 'args' });
  });
});
