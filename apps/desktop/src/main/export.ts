import { t } from '@nopsidian/i18n';
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  atomicWrite,
  createAssetResolver,
  createLinkResolver,
  extractExcerpt,
  mimeFromName,
  relativePath,
  resolveInVault,
} from '@nopsidian/core';
import { renderNoteBody, wrapHtmlDocument } from '@nopsidian/core/export';

export interface ExportNote {
  path: string;
  title: string;
  aliases: string[];
}

export interface ExportContext {
  root: string;
  notes: ExportNote[];
  /** 볼트 안 모든 첨부(노트가 아닌 파일)의 상대 경로 */
  assets: string[];
}

const htmlPathOf = (notePath: string) => notePath.replace(/\.md$/i, '.html');
const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** data URI 로 넣을 첨부 합계 상한(너무 큰 HTML 방지) */
const INLINE_LIMIT = 24 * 1024 * 1024;

/**
 * 노트 하나를 HTML 문서로 만든다.
 *  - `inlineAssets`: 이미지·미디어를 data URI 로 넣어 파일 하나로 완결(단일 노트 내보내기, PDF)
 *  - 아니면 `assetUrl` 로 상대 경로를 만든다(볼트 내보내기: 첨부는 따로 복사)
 */
export function renderNoteDocument(
  ctx: ExportContext,
  notePath: string,
  content: string,
  mode: { inlineAssets: boolean; /** 다른 노트로 가는 링크를 상대 .html 로 만든다 */ siteLinks: boolean },
): string {
  const resolve = createLinkResolver(
    ctx.notes.map((n, i) => ({ id: i, path: n.path, title: n.title })),
    ctx.notes.flatMap((n, i) => n.aliases.map((alias) => ({ pageId: i, alias }))),
  );
  const resolveAsset = createAssetResolver(ctx.assets);
  const fromDir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : '';
  let inlined = 0;

  const body = renderNoteBody(content, {
    resolveNote: (target) => {
      const id = resolve(target, notePath);
      const note = id === undefined ? undefined : ctx.notes[id];
      if (!note) return null;
      return mode.siteLinks ? encodePath(relativePath(fromDir, htmlPathOf(note.path))) : '';
    },
    resolveAsset: (target) => {
      const hit = resolveAsset(target, notePath);
      if (!hit) return null;
      if (!mode.inlineAssets) return encodePath(relativePath(fromDir, `assets/${hit}`));
      const full = resolveInVault(ctx.root, hit);
      const size = statSync(full).size;
      if (inlined + size > INLINE_LIMIT) return null;
      inlined += size;
      return `data:${mimeFromName(hit)};base64,${readFileSync(full).toString('base64')}`;
    },
    embedNote: (target, heading, block) => {
      const id = resolve(target, notePath);
      const note = id === undefined ? undefined : ctx.notes[id];
      if (!note) return null;
      const ex = extractExcerpt(readFileSync(resolveInVault(ctx.root, note.path), 'utf8'), { heading, block, maxChars: 1500 });
      return `<p><strong>${esc(note.title)}</strong></p>` + ex.text.split('\n').map((l) => `<p>${esc(l)}</p>`).join('');
    },
  });

  const title = ctx.notes.find((n) => n.path === notePath)?.title ?? notePath;
  // 본문이 제목으로 시작하지 않으면 제목을 붙인다
  const hasH1 = /^\s*<h1[ >]/.test(body);
  return wrapHtmlDocument({ title, body: hasH1 ? body : `<h1>${esc(title)}</h1>\n${body}` });
}

/** 볼트 전체를 정적 사이트로 쓴다(`<out>/<노트경로>.html`, 첨부는 `<out>/assets/…`, 목록은 `index.html`). */
export function exportVaultSite(ctx: ExportContext, outDir: string): { notes: number; assets: number } {
  mkdirSync(outDir, { recursive: true });
  const used = new Set<string>();
  for (const n of ctx.notes) {
    const content = readFileSync(resolveInVault(ctx.root, n.path), 'utf8');
    const doc = renderNoteDocument(ctx, n.path, content, { inlineAssets: false, siteLinks: true });
    atomicWrite(path.join(outDir, ...htmlPathOf(n.path).split('/')), doc);
    for (const m of doc.matchAll(/(?:src|href)="((?:\.\.\/)*assets\/[^"#]+)"/g)) used.add(decodeURIComponent(m[1]!).replace(/^(\.\.\/)*assets\//, ''));
  }
  let assets = 0;
  for (const a of used) {
    if (!ctx.assets.includes(a)) continue;
    const dest = path.join(outDir, 'assets', ...a.split('/'));
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(resolveInVault(ctx.root, a), dest);
    assets++;
  }
  const items = [...ctx.notes]
    .sort((a, b) => a.path.localeCompare(b.path, 'ko'))
    .map((n) => `<li><a href="${encodePath(htmlPathOf(n.path))}">${esc(n.title)}</a> <span class="meta">${esc(n.path)}</span></li>`)
    .join('\n');
  const listTitle = t('main.export.noteList');
  atomicWrite(path.join(outDir, 'index.html'), wrapHtmlDocument({ title: listTitle, body: `<h1>${listTitle}</h1>\n<ul>\n${items}\n</ul>` }));
  return { notes: ctx.notes.length, assets };
}
