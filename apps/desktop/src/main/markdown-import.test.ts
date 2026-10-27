import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { importMarkdownInto } from './markdown-import';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'nops-mdimp-'));
  dirs.push(d);
  return d;
};

describe('Markdown 가져오기', () => {
  it('파일을 볼트 루트로 복사하고 이름이 겹치면 번호를 붙인다', () => {
    const vault = tmp();
    const src = tmp();
    writeFileSync(path.join(vault, '메모.md'), '기존');
    writeFileSync(path.join(src, '메모.md'), '새것');
    writeFileSync(path.join(src, '그림.png'), 'x');
    const r = importMarkdownInto(vault, [path.join(src, '메모.md'), path.join(src, '그림.png')]);
    expect(readFileSync(path.join(vault, '메모.md'), 'utf8')).toBe('기존');
    expect(readFileSync(path.join(vault, '메모 1.md'), 'utf8')).toBe('새것');
    expect(r).toMatchObject({ notes: 1, assets: 0, renamed: 1, imported: ['메모 1.md'] });
    expect(r.skipped[0]).toContain('그림.png');
  });

  it('into 폴더로 복사한다', () => {
    const vault = tmp();
    const src = tmp();
    writeFileSync(path.join(src, 'a.markdown'), 'A');
    const r = importMarkdownInto(vault, [path.join(src, 'a.markdown')], '받은 노트');
    expect(readFileSync(path.join(vault, '받은 노트/a.markdown'), 'utf8')).toBe('A');
    expect(r.imported).toEqual(['받은 노트/a.markdown']);
  });

  it('폴더는 구조·첨부를 유지하고 점 폴더·심볼릭 링크·기타 파일은 건너뛴다', () => {
    const vault = tmp();
    const src = tmp();
    const root = path.join(src, '내 볼트');
    mkdirSync(path.join(root, '하위'), { recursive: true });
    mkdirSync(path.join(root, '.obsidian'));
    writeFileSync(path.join(root, '홈.md'), '[[깊은]]');
    writeFileSync(path.join(root, '하위/깊은.md'), 'D');
    writeFileSync(path.join(root, '하위/이미지.png'), 'P');
    writeFileSync(path.join(root, '.obsidian/app.json'), '{}');
    writeFileSync(path.join(root, '코드.js'), '//');
    symlinkSync(path.join(root, '홈.md'), path.join(root, '링크.md'));
    mkdirSync(path.join(vault, '내 볼트'));
    const r = importMarkdownInto(vault, [root]);
    expect(r).toMatchObject({ notes: 2, assets: 1, renamed: 1, imported: ['내 볼트 1'] });
    expect(readdirSync(path.join(vault, '내 볼트 1')).sort()).toEqual(['하위', '홈.md']);
    expect(existsSync(path.join(vault, '내 볼트 1/하위/이미지.png'))).toBe(true);
  });

  it('없는 경로·볼트 밖 into 는 건너뛰거나 거부한다', () => {
    const vault = tmp();
    expect(importMarkdownInto(vault, ['/없는/경로.md']).skipped).toHaveLength(1);
    expect(() => importMarkdownInto(vault, [], '../밖')).toThrow();
  });
});
