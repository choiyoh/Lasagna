/* global process */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkAllowlist, countHangulLines, formatAllowlist, scanRepo, scanTree } from './check-hangul-literals.mjs';

const dirs = [];
const tempRepo = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nops-hangul-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('countHangulLines', () => {
  it('counts strings, template literals, and JSX text', () => {
    const source = [
      "const a = '한국어';",
      'const b = "English only";',
      'const c = `여러 줄',
      '템플릿 ${x} 도 센다`;',
      'const view = <h2>설정</h2>;',
      "const d = 'no hangul here'; // 주석의 한글은 세지 않는다",
    ].join('\n');
    expect(countHangulLines(source)).toBe(4);
  });

  it('skips line and block comments', () => {
    const source = [
      '// 한글 주석',
      '/* 한글 블록',
      '   계속 한글 */',
      'const x = 1; // 뒤에 붙은 한글 주석',
      'const y = 2;',
    ].join('\n');
    expect(countHangulLines(source)).toBe(0);
  });
});

describe('scanRepo', () => {
  it('walks app and package sources but not tests, messages, or fixtures', () => {
    const root = tempRepo();
    mkdirSync(path.join(root, 'apps/desktop/src/main'), { recursive: true });
    mkdirSync(path.join(root, 'packages/core/src'), { recursive: true });
    mkdirSync(path.join(root, 'packages/i18n/src/messages'), { recursive: true });
    mkdirSync(path.join(root, 'packages/core/src/fixtures'), { recursive: true });
    mkdirSync(path.join(root, 'apps/desktop/src/e2e'), { recursive: true });
    writeFileSync(path.join(root, 'apps/desktop/src/main/a.ts'), "const a = '한글';\nconst b = '한글';\n");
    writeFileSync(path.join(root, 'packages/core/src/b.ts'), "export const b = '두 줄';\n");
    writeFileSync(path.join(root, 'packages/core/src/b.test.ts'), "expect('한글').toBe('한글');\n");
    writeFileSync(path.join(root, 'packages/i18n/src/messages/ko.ts'), "export const ko = { a: '한글' };\n");
    writeFileSync(path.join(root, 'packages/core/src/fixtures/c.ts'), "const c = '한글';\n");
    writeFileSync(path.join(root, 'apps/desktop/src/e2e/d.ts'), "const d = '한글';\n");

    const counts = scanRepo(root);
    expect(Object.fromEntries(counts)).toEqual({
      'apps/desktop/src/main/a.ts': 2,
      'packages/core/src/b.ts': 1,
    });
  });

  it('scanTree reports only files with literals left', () => {
    const root = tempRepo();
    mkdirSync(path.join(root, 'src'), { recursive: true });
    writeFileSync(path.join(root, 'src/empty.ts'), 'export const x = 1;\n');
    writeFileSync(path.join(root, 'src/keep.ts'), "export const x = '남음';\n");
    expect([...scanTree(path.join(root, 'src')).entries()]).toEqual([['keep.ts', 1]]);
  });
});

describe('checkAllowlist', () => {
  const current = new Map([
    ['a.ts', 2],
    ['b.ts', 1],
  ]);
  const allowlist = { 'a.ts': 2, 'b.ts': 1 };

  it('passes when every file matches its baseline', () => {
    expect(checkAllowlist(current, allowlist)).toEqual([]);
  });

  it('fails on growth, a new file, and an allowance above the real count', () => {
    expect(checkAllowlist(new Map([['a.ts', 3]]), { 'a.ts': 2 })).toEqual(['a.ts: 3줄 > 허용 2줄']);
    expect(checkAllowlist(new Map([['c.ts', 1]]), {})).toEqual(['c.ts: 1줄 (목록에 없는 파일)']);
    expect(checkAllowlist(new Map([['a.ts', 1]]), { 'a.ts': 2 })).toEqual(['a.ts: 허용 2줄 > 실제 1줄 (허용치를 줄이세요)']);
  });

  it('writes a stable, sorted allowlist', () => {
    const text = formatAllowlist(new Map([['z.ts', 1], ['a.ts', 2]]));
    expect(text).toBe(`${JSON.stringify({ 'a.ts': 2, 'z.ts': 1 }, null, 2)}\n`);
  });
});
