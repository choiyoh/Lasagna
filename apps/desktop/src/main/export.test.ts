import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportVaultSite, renderNoteDocument, type ExportContext } from './export';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function vault(): ExportContext {
  const root = mkdtempSync(path.join(tmpdir(), 'nops-export-'));
  dirs.push(root);
  const w = (rel: string, data: string | Buffer) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), data);
  };
  w('인덱스.md', '# 인덱스\n\n[[폴더/하위]] 와 ![[그림.png]]\n');
  w('폴더/하위.md', '하위 내용\n\n[[인덱스]] ![[그림.png]] ![[인덱스#^q]]\n');
  w('attachments/그림.png', Buffer.from([137, 80, 78, 71]));
  return {
    root,
    notes: [
      { path: '인덱스.md', title: '인덱스', aliases: [] },
      { path: '폴더/하위.md', title: '하위', aliases: [] },
    ],
    assets: ['attachments/그림.png'],
  };
}

describe('HTML 내보내기', () => {
  it('단일 노트: 이미지를 data URI 로 넣고 제목이 없으면 붙인다', () => {
    const ctx = vault();
    const doc = renderNoteDocument(ctx, '폴더/하위.md', readFileSync(path.join(ctx.root, '폴더/하위.md'), 'utf8'), { inlineAssets: true, siteLinks: false });
    expect(doc).toContain('<h1>하위</h1>');
    expect(doc).toContain('src="data:image/png;base64,');
    expect(doc).toContain("default-src 'none'");
  });
  it('볼트 사이트: 상대 링크·첨부 복사·목록', () => {
    const ctx = vault();
    const out = path.join(ctx.root, '..', `out-${path.basename(ctx.root)}`);
    dirs.push(out);
    expect(exportVaultSite(ctx, out)).toEqual({ notes: 2, assets: 1 });
    const sub = readFileSync(path.join(out, '폴더/하위.html'), 'utf8');
    expect(sub).toContain('href="../%EC%9D%B8%EB%8D%B1%EC%8A%A4.html"');
    expect(sub).toContain('src="../assets/attachments/%EA%B7%B8%EB%A6%BC.png"');
    expect(readFileSync(path.join(out, '인덱스.html'), 'utf8')).toContain('href="%ED%8F%B4%EB%8D%94/%ED%95%98%EC%9C%84.html"');
    expect(existsSync(path.join(out, 'assets/attachments/그림.png'))).toBe(true);
    expect(readFileSync(path.join(out, 'index.html'), 'utf8')).toContain('하위');
  });
});
