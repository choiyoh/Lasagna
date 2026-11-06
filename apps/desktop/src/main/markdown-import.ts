import { t } from '@nopsidian/i18n';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { atomicWrite, extOf, resolveInVault, uniqueName } from '@nopsidian/core';

const MAX_FILES = 50_000;
const MAX_FILE_SIZE = 512 * 1024 ** 2;
const SKIP_DIRS = new Set(['node_modules']);
/** 폴더를 가져올 때 노트와 함께 따라오는 첨부 확장자 */
const ASSET_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'pdf', 'mp3', 'm4a', 'wav', 'ogg', 'flac', 'mp4', 'webm', 'mov']);

export interface MarkdownImportResult {
  notes: number;
  assets: number;
  /** 이름이 겹쳐 번호를 붙인 항목 수 */
  renamed: number;
  /** 가져온 최상위 경로(볼트 기준) */
  imported: string[];
  skipped: string[];
}

export const isMarkdownFile = (name: string) => ['md', 'markdown'].includes(extOf(name));

/**
 * 컴퓨터의 Markdown 파일·폴더를 볼트의 `into` 폴더(빈 문자열 = 볼트 루트)로 복사한다.
 * 이름이 겹치면 `이름 1.md` 처럼 번호를 붙여 기존 노트를 덮어쓰지 않는다. 폴더는 구조를 그대로 두고
 * `.md` 와 이미지·PDF 등 첨부만 가져온다(`.obsidian` 같은 점 폴더·심볼릭 링크는 건너뛴다).
 */
export function importMarkdownInto(root: string, sources: readonly string[], into = ''): MarkdownImportResult {
  const res: MarkdownImportResult = { notes: 0, assets: 0, renamed: 0, imported: [], skipped: [] };
  const destDir = resolveInVault(root, into || '.');
  mkdirSync(destDir, { recursive: true });
  const rel = (name: string) => (into ? `${into}/${name}` : name);
  const taken = (name: string) => existsSync(path.join(destDir, name));
  let count = 0;

  const copyTree = (srcDir: string, dest: string) => {
    mkdirSync(dest, { recursive: true });
    for (const ent of readdirSync(srcDir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || ent.isSymbolicLink()) continue;
      const from = path.join(srcDir, ent.name);
      const to = path.join(dest, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) copyTree(from, to);
      } else if (ent.isFile()) {
        const md = isMarkdownFile(ent.name);
        if (!md && !ASSET_EXT.has(extOf(ent.name))) continue;
        if (++count > MAX_FILES) throw new Error(t('main.err.tooManyFiles', { max: MAX_FILES }));
        if (statSync(from).size > MAX_FILE_SIZE) {
          res.skipped.push(t('main.skip.tooBig', { name: ent.name }));
          continue;
        }
        mkdirSync(dest, { recursive: true });
        copyFileSync(from, to);
        if (md) res.notes++;
        else res.assets++;
      }
    }
  };

  for (const src of sources) {
    const base = path.basename(src);
    let st;
    try {
      st = lstatSync(src);
    } catch {
      res.skipped.push(t('main.skip.notFound', { name: base }));
      continue;
    }
    if (st.isSymbolicLink()) {
      res.skipped.push(t('main.skip.link', { name: base }));
    } else if (st.isDirectory()) {
      const name = uniqueName(base, taken);
      if (name !== base) res.renamed++;
      const before = res.notes + res.assets;
      copyTree(src, path.join(destDir, name));
      if (res.notes + res.assets > before) res.imported.push(rel(name));
    } else if (st.isFile() && isMarkdownFile(base)) {
      if (st.size > MAX_FILE_SIZE) {
        res.skipped.push(t('main.skip.tooBig', { name: base }));
        continue;
      }
      if (++count > MAX_FILES) throw new Error(t('main.err.tooManyFiles', { max: MAX_FILES }));
      const name = uniqueName(base, taken);
      if (name !== base) res.renamed++;
      atomicWrite(path.join(destDir, name), readFileSync(src));
      res.notes++;
      res.imported.push(rel(name));
    } else {
      res.skipped.push(t('main.skip.notMarkdown', { name: base }));
    }
  }
  return res;
}
