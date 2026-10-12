import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { CONFLICT_START } from './merge3.js';
import { atomicWrite, saveNote, sha256, snapshot } from './save.js';

let root: string;
const file = (rel: string) => path.join(root, rel);
const base = '# 제목\n\n첫 문단\n\n둘째 문단\n';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'nops-save-'));
});

describe('atomicWrite', () => {
  it('내용을 쓰고 임시 파일을 남기지 않는다', () => {
    mkdirSync(file('a'));
    atomicWrite(file('a/x.md'), '내용');
    expect(readFileSync(file('a/x.md'), 'utf8')).toBe('내용');
    expect(readdirSync(file('a'))).toEqual(['x.md']);
  });

  it('없는 폴더도 만들어서 쓴다', () => {
    atomicWrite(file('새/폴더/x.md'), 'ok');
    expect(readFileSync(file('새/폴더/x.md'), 'utf8')).toBe('ok');
  });
});

describe('snapshot', () => {
  it('같은 내용은 중복 저장하지 않는다', () => {
    snapshot(root, 'a.md', '내용');
    snapshot(root, 'a.md', '내용');
    snapshot(root, 'a.md', '다른 내용');
    const dirs = readdirSync(file('.nopsidian/history'));
    expect(dirs).toHaveLength(1);
    expect(readdirSync(file(`.nopsidian/history/${dirs[0]}`))).toHaveLength(2);
  });
});

describe('saveNote', () => {
  it('새 파일을 만든다', () => {
    const r = saveNote({ root, rel: 'new.md', content: '# 새 노트\n', baseHash: null });
    expect(r.status).toBe('saved');
    expect(readFileSync(file('new.md'), 'utf8')).toBe('# 새 노트\n');
  });

  it('디스크가 앱이 읽은 상태 그대로면 덮어쓰고 이전 내용을 스냅샷으로 남긴다', () => {
    writeFileSync(file('a.md'), base);
    const r = saveNote({ root, rel: 'a.md', content: base + '추가\n', baseHash: sha256(base) });
    expect(r.status).toBe('saved');
    expect(r.hash).toBe(sha256(base + '추가\n'));
    expect(readFileSync(file('a.md'), 'utf8')).toBe(base + '추가\n');
    const snaps = readdirSync(file('.nopsidian/history'));
    expect(snaps).toHaveLength(1);
  });

  it('외부에서 다른 블록을 고쳤으면 자동 병합한다', () => {
    writeFileSync(file('a.md'), base);
    const external = base.replace('둘째 문단', '둘째(외부)');
    writeFileSync(file('a.md'), external);
    const ours = base.replace('첫 문단', '첫(앱)');
    const r = saveNote({ root, rel: 'a.md', content: ours, baseHash: sha256(base), baseContent: base });
    expect(r.status).toBe('merged');
    expect(readFileSync(file('a.md'), 'utf8')).toBe('# 제목\n\n첫(앱)\n\n둘째(외부)\n');
  });

  it('같은 블록을 고쳤으면 conflict + 양쪽 보존', () => {
    writeFileSync(file('a.md'), base.replace('첫 문단', '외부'));
    const r = saveNote({
      root,
      rel: 'a.md',
      content: base.replace('첫 문단', '앱'),
      baseHash: sha256(base),
      baseContent: base,
    });
    expect(r.status).toBe('conflict');
    const text = readFileSync(file('a.md'), 'utf8');
    expect(text).toContain(CONFLICT_START);
    expect(text).toContain('앱');
    expect(text).toContain('외부');
  });

  it('공통 조상이 없으면 디스크는 그대로 두고 충돌 사본에 앱 내용을 저장한다', () => {
    writeFileSync(file('a.md'), '외부 내용\n');
    const r = saveNote({
      root,
      rel: 'a.md',
      content: '앱 내용\n',
      baseHash: sha256(base),
      now: new Date('2026-10-12T00:00:00Z'),
    });
    expect(r.status).toBe('copy');
    expect(r.copyPath).toBe('a (충돌 2026-10-12).md');
    expect(readFileSync(file('a.md'), 'utf8')).toBe('외부 내용\n');
    expect(readFileSync(file('a (충돌 2026-10-12).md'), 'utf8')).toBe('앱 내용\n');
    expect(r.content).toBe('외부 내용\n');
  });

  it('새 파일을 만들려는데 같은 이름이 이미 있으면 사본을 만든다', () => {
    writeFileSync(file('a.md'), '기존\n');
    const r = saveNote({ root, rel: 'a.md', content: '신규\n', baseHash: null, now: new Date('2026-10-12T00:00:00Z') });
    expect(r.status).toBe('copy');
    expect(readFileSync(file('a.md'), 'utf8')).toBe('기존\n');
  });

  it('볼트 밖 경로는 거부한다', () => {
    expect(() => saveNote({ root, rel: '../x.md', content: 'x', baseHash: null })).toThrow();
    expect(existsSync(path.join(root, '..', 'x.md'))).toBe(false);
  });
});
