import { t } from '@nopsidian/i18n';
import { buildRowNote, csvToRows, guessColumns, newDbYaml, parseCsv, setDbProperty } from '../db/index.js';

export interface ZipEntry {
  /** 압축 안의 경로(`/` 구분) */
  path: string;
  data: Uint8Array;
}

export interface ImportFile {
  /** 가져올 폴더 안의 상대 경로 */
  path: string;
  data: string | Uint8Array;
}

export interface NotionImportResult {
  files: ImportFile[];
  stats: { notes: number; databases: number; rows: number; assets: number; links: number; unresolvedLinks: number };
  issues: string[];
}

const ID_SUFFIX = /\s[0-9a-f]{32}$/i;
const dec = new TextDecoder('utf-8');
const posix = {
  dirname: (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''),
  basename: (p: string) => p.slice(p.lastIndexOf('/') + 1),
  normalize: (p: string) => {
    const out: string[] = [];
    for (const s of p.split('/')) {
      if (s === '' || s === '.') continue;
      if (s === '..') out.pop();
      else out.push(s);
    }
    return out.join('/');
  },
};
const extOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '');
const stemOf = (name: string) => (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name);
const UNSAFE = /[\\:*?"<>|]/g;

/** 압축 안 경로를 정리한다. 위험하거나 쓸모없는 경로는 null */
export function cleanEntryPath(raw: string): string | null {
  const parts = raw.replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.');
  if (parts.length === 0 || parts.some((s) => s === '..') || /^[a-zA-Z]:$/.test(parts[0]!)) return null;
  if (parts[0] === '__MACOSX' || parts.at(-1) === '.DS_Store' || parts.at(-1)!.startsWith('._')) return null;
  return parts.join('/');
}

/** 이름 끝의 ` <32자리 hex>` 를 뗀다(확장자 앞). */
export function stripNotionId(name: string): string {
  const ext = extOf(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  // 확장자처럼 보이지만 사실은 이름의 일부일 수 있다(폴더 `v1.2 <id>`): 폴더는 호출자가 확장자 없이 넘긴다
  return stem.replace(ID_SUFFIX, '').replace(UNSAFE, ' ').trim() + ext;
}

const NOTE_TITLE = /^#\s+(.+?)\s*$/m;

/** Notion 은 행 노트의 `# 제목` 바로 뒤에 `속성: 값` 줄 묶음을 둔다. 그 묶음을 떼어 낸다. */
function splitPropertyHeader(md: string): { body: string; props: string[] } {
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === '') i++;
  if (!/^#\s/.test(lines[i] ?? '')) return { body: md, props: [] };
  let j = i + 1;
  while (j < lines.length && lines[j]!.trim() === '') j++;
  const start = j;
  while (j < lines.length && /^[^\s:][^:]*:\s?.*$/.test(lines[j]!) && lines[j]!.trim() !== '') j++;
  if (j === start) return { body: md, props: [] };
  const props = lines.slice(start, j);
  const rest = lines.slice(j).join('\n').replace(/^\n+/, '');
  return { body: rest, props };
}

/** `<aside>💡 …</aside>` → 콜아웃 */
function convertAsides(md: string): string {
  return md.replace(/<aside>\s*([\s\S]*?)\s*<\/aside>/g, (_m, inner: string) => {
    const quoted = inner
      .split('\n')
      .map((l) => (l.trim() === '' ? '>' : `> ${l}`))
      .join('\n');
    return `> [!note]\n${quoted}`;
  });
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const encodeRel = (p: string) => p.split('/').map(encodeURIComponent).join('/');

function relativeTo(fromDir: string, to: string): string {
  const a = fromDir.split('/').filter(Boolean);
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

/**
 * Notion 내보내기(Markdown & CSV)를 Lasagna 볼트 파일들로 바꾼다. 순수 함수 — 파일은 쓰지 않는다.
 *  - 이름의 32자리 ID 제거(겹치면 ` (2)`)
 *  - 페이지 링크 → 위키링크, 첨부 링크 → 새 상대 경로
 *  - 데이터베이스 CSV + 행 노트 → `_db.yaml` + 속성이 프런트매터로 간 행 노트
 *  - `<aside>` → 콜아웃
 */
export function convertNotionExport(rawEntries: ZipEntry[], opts: { rootFolder?: string } = {}): NotionImportResult {
  const root = opts.rootFolder ? opts.rootFolder.replace(/^\/+|\/+$/g, '') : '';
  const issues: string[] = [];
  const entries: ZipEntry[] = [];
  for (const e of rawEntries) {
    const p = cleanEntryPath(e.path);
    if (p && !e.path.endsWith('/')) entries.push({ path: p, data: e.data });
  }

  // 1) 새 경로 정하기(폴더 이름도 같은 규칙, 충돌은 번호)
  const newPath = new Map<string, string>(); // 옛 경로 → 새 경로(루트 폴더 제외)
  const taken = new Set<string>();
  const dirMap = new Map<string, string>(); // 옛 폴더 → 새 폴더
  const mapDir = (oldDir: string): string => {
    if (oldDir === '') return '';
    const cached = dirMap.get(oldDir);
    if (cached !== undefined) return cached;
    const parent = mapDir(posix.dirname(oldDir));
    const name = stripNotionId(posix.basename(oldDir)) || t('default.folderName');
    const mapped = parent ? `${parent}/${name}` : name;
    dirMap.set(oldDir, mapped);
    return mapped;
  };
  for (const e of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    const dir = mapDir(posix.dirname(e.path));
    const name = stripNotionId(posix.basename(e.path)) || t('default.nameless');
    const ext = extOf(name);
    const stem = ext ? name.slice(0, -ext.length) : name;
    let candidate = dir ? `${dir}/${name}` : name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${dir ? `${dir}/` : ''}${stem} (${n})${ext}`;
    taken.add(candidate.toLowerCase());
    newPath.set(e.path, candidate);
  }

  const files: ImportFile[] = [];
  const out = (p: string, data: string | Uint8Array) => files.push({ path: root ? `${root}/${p}` : p, data });
  const stats = { notes: 0, databases: 0, rows: 0, assets: 0, links: 0, unresolvedLinks: 0 };
  const byPath = new Map(entries.map((e) => [e.path, e]));

  // 2) 데이터베이스: `X <id>.csv`(또는 `_all.csv`) 와 같은 이름의 폴더
  const handled = new Set<string>();
  const rowOverrides = new Map<string, string>(); // 옛 md 경로 → 새 내용(프런트매터 포함)
  const dbFolders = new Set<string>();
  for (const e of entries) {
    if (extOf(e.path) !== '.csv') continue;
    const oldStem = e.path.slice(0, -4).replace(/_all$/, '');
    const folder = oldStem;
    const hasFolder = entries.some((x) => x.path.startsWith(`${folder}/`) && extOf(x.path) === '.md');
    // `_all.csv` 와 `.csv` 가 둘 다 있으면 `_all` 을 쓴다(보이지 않는 행 포함)
    const isAll = e.path.endsWith('_all.csv');
    if (!isAll && byPath.has(`${folder}_all.csv`)) {
      handled.add(e.path);
      continue;
    }
    if (!hasFolder && posix.basename(folder) === '') continue;
    handled.add(e.path);
    const table = parseCsv(dec.decode(e.data), { delimiter: 'auto' });
    if (table.length < 1 || (table[0]?.length ?? 0) === 0) continue;
    const newFolder = mapDir(folder);
    dbFolders.add(folder);
    stats.databases++;

    const guesses = guessColumns(table);
    let yaml = newDbYaml(posix.basename(newFolder));
    for (const g of guesses) if (g.prop && !g.isTitle) yaml = setDbProperty(yaml, g.name, g.prop);
    out(`${newFolder}/_db.yaml`, yaml);

    const rows = csvToRows(table, guesses);
    for (const r of rows) issues.push(...r.issues.map((m) => `${posix.basename(newFolder)}: ${m}`));
    // 행 노트 찾기: 폴더 안 md 중 제목(첫 H1 또는 이름)이 같은 것
    const mds = entries.filter((x) => posix.dirname(x.path) === folder && extOf(x.path) === '.md');
    const titleOf = (x: ZipEntry) => NOTE_TITLE.exec(dec.decode(x.data))?.[1]?.trim() ?? stripNotionId(posix.basename(x.path)).replace(/\.md$/i, '');
    const used = new Set<string>();
    for (const r of rows) {
      const md = mds.find((x) => !used.has(x.path) && titleOf(x) === r.title);
      let body = '';
      if (md) {
        used.add(md.path);
        const split = splitPropertyHeader(dec.decode(md.data));
        body = convertAsides(split.body.replace(/^\s*#\s+.*\n+/, ''));
        rowOverrides.set(md.path, buildRowNote(r.values, body));
      } else {
        const rel = `${newFolder}/${r.title.replace(UNSAFE, ' ').trim() || t('default.untitled')}.md`;
        let candidate = rel;
        for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = rel.replace(/\.md$/, ` (${n}).md`);
        taken.add(candidate.toLowerCase());
        newPath.set(`${folder}/__csv_${stats.rows}.md`, candidate);
        rowOverrides.set(`${folder}/__csv_${stats.rows}.md`, buildRowNote(r.values, ''));
      }
      stats.rows++;
    }
  }

  // 3) 링크 다시 쓰기에 쓸 이름 표(노트 이름이 볼트에서 유일하면 이름만, 아니면 경로)
  const noteNewPaths = [...newPath.entries()].filter(([old]) => extOf(old) === '.md').map(([, p]) => p);
  const nameCount = new Map<string, number>();
  for (const p of noteNewPaths) nameCount.set(stemOf(posix.basename(p)).toLowerCase(), (nameCount.get(stemOf(posix.basename(p)).toLowerCase()) ?? 0) + 1);
  const wikiTarget = (p: string) => {
    const stem = stemOf(posix.basename(p));
    return (nameCount.get(stem.toLowerCase()) ?? 0) === 1 ? stem : p.replace(/\.md$/i, '');
  };

  const rewriteLinks = (md: string, oldDir: string, newDir: string): string => {
    return md.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, bang: string, text: string, url: string) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('//')) return whole;
      const [pathPart = '', frag] = url.split('#');
      const decoded = safeDecode(pathPart);
      const old = posix.normalize(oldDir ? `${oldDir}/${decoded}` : decoded);
      const mapped = newPath.get(old);
      if (!mapped) {
        if (/\.(md|csv)$/i.test(decoded)) {
          stats.unresolvedLinks++;
          return text || decoded;
        }
        return whole;
      }
      if (bang === '' && extOf(mapped) === '.md') {
        stats.links++;
        const target = wikiTarget(mapped);
        const label = text && text !== stemOf(posix.basename(mapped)) ? `|${text}` : '';
        return `[[${target}${frag ? `#${safeDecode(frag)}` : ''}${label}]]`;
      }
      if (extOf(mapped) === '.csv' || dbFolders.has(old)) return text;
      return `${bang}[${text}](${encodeRel(relativeTo(newDir, mapped))}${frag ? `#${frag}` : ''})`;
    });
  };

  // 4) 모든 파일 내보내기
  for (const e of entries) {
    const mapped = newPath.get(e.path)!;
    const ext = extOf(e.path);
    if (ext === '.csv') {
      if (handled.has(e.path)) continue;
      out(mapped, e.data); // 데이터베이스가 아닌 CSV 는 첨부로 둔다
      stats.assets++;
      continue;
    }
    if (ext === '.md') {
      const oldDir = posix.dirname(e.path);
      const newDir = posix.dirname(mapped);
      const text = rowOverrides.get(e.path) ?? convertAsides(dec.decode(e.data));
      out(mapped, rewriteLinks(text, oldDir, newDir));
      stats.notes++;
      continue;
    }
    out(mapped, e.data);
    stats.assets++;
  }
  for (const [old, content] of rowOverrides) {
    if (!old.includes('/__csv_')) continue;
    out(newPath.get(old)!, content);
    stats.notes++;
  }
  return { files, stats, issues };
}
