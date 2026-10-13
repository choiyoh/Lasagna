import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { importNotionInto, readZipEntries } from './notion-import';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const ID = '0123456789abcdef0123456789abcdef';

describe('Notion ZIP 가져오기', () => {
  it('ZIP → 볼트 새 폴더, 안쪽 ZIP 도 푼다', () => {
    const inner = zipSync({ [`페이지 ${ID}.md`]: strToU8('# 페이지\n\n내용\n'), [`페이지 ${ID}/그림.png`]: new Uint8Array([9, 9]) });
    const outer = zipSync({ 'Export-1/Part-1.zip': inner });
    const root = mkdtempSync(path.join(tmpdir(), 'nops-notion-'));
    dirs.push(root);
    const res = importNotionInto(root, readZipEntries(outer), new Date('2026-10-13T00:00:00Z'));
    expect(res.folder).toBe('Notion 가져오기 2026-10-13');
    expect(readFileSync(path.join(root, res.folder, '페이지.md'), 'utf8')).toContain('내용');
    expect(readdirSync(path.join(root, res.folder, '페이지'))).toEqual(['그림.png']);
    // 다시 가져오면 폴더가 겹치지 않는다
    expect(importNotionInto(root, readZipEntries(outer), new Date('2026-10-13T00:00:00Z')).folder).toBe('Notion 가져오기 2026-10-13 2');
  });
  it('경로 탈출 항목은 버린다', () => {
    const zip = zipSync({ '../evil.md': strToU8('x'), 'ok.md': strToU8('# ok') });
    const root = mkdtempSync(path.join(tmpdir(), 'nops-notion-'));
    dirs.push(root);
    const res = importNotionInto(root, readZipEntries(zip));
    expect(res.files.map((f) => f.path.split('/').pop())).toEqual(['ok.md']);
  });
});
