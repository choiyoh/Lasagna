import { assetKind, createAssetResolver } from './assets.js';
import { createLinkResolver } from './link-resolve.js';
import { applyEdits, findLinkSpans, parseNote, type LinkSpan, type TextEdit } from './markdown/index.js';

export interface VaultNote {
  /** 볼트 기준 경로 (예: `프로젝트/노트.md`) */
  path: string;
  content: string;
}

export interface Move {
  from: string;
  to: string;
}

export interface PlannedEdit {
  /** 이동 전 경로 */
  path: string;
  /** 이동 후 경로(이동하지 않으면 같다) */
  newPath: string;
  content: string;
  /** 고쳐 쓴 링크 수 */
  changes: number;
}

export interface MovePlan {
  /** 내용이 바뀌는 노트만 */
  edits: PlannedEdit[];
  /** 고쳐 쓴 링크의 총 개수 */
  totalChanges: number;
}

const posix = {
  dirname: (p: string) => {
    const i = p.lastIndexOf('/');
    return i < 0 ? '' : p.slice(0, i);
  },
  basename: (p: string) => p.slice(p.lastIndexOf('/') + 1),
  normalize: (p: string) => {
    const out: string[] = [];
    for (const seg of p.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') out.pop();
      else out.push(seg);
    }
    return out.join('/');
  },
  relative: (fromDir: string, to: string) => {
    const from = fromDir.split('/').filter(Boolean);
    const dest = to.split('/').filter(Boolean);
    let i = 0;
    while (i < from.length && i < dest.length - 1 && from[i] === dest[i]) i++;
    return [...Array(from.length - i).fill('..'), ...dest.slice(i)].join('/');
  },
};

const stripMd = (p: string) => (p.toLowerCase().endsWith('.md') ? p.slice(0, -3) : p);

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** 마크다운 링크 경로를 쓸 수 있는 형태로: 인코딩을 쓰던 링크는 구간별 인코딩, 아니면 공백·괄호만 안전하게 바꾼다. */
function formatMdPath(path: string, span: LinkSpan): string {
  if (span.angle) return path;
  if (span.encoded) return path.split('/').map(encodeURIComponent).join('/');
  return path.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/**
 * 노트(또는 첨부)를 옮기거나 이름을 바꿀 때 볼트 전체의 링크를 고쳐 쓸 계획을 만든다. 파일은 건드리지 않는다.
 *
 * 규칙
 *  - 위키링크·임베드·relation은 "이름이 같은 노트로 계속 해석되는 한" 그대로 둔다(폴더만 옮긴 경우 대부분 변경 없음).
 *    해석이 달라지면 새 이름 → 경로(확장자 규칙 유지) 순으로 같은 노트로 해석되는 가장 짧은 표기를 쓴다.
 *  - 마크다운 링크·이미지는 링크가 있는 노트 폴더 기준 상대 경로를 다시 계산한다(옮긴 노트 자신의 링크 포함).
 *  - `#제목`·`|별칭`·`^블록`·코드 블록 안의 글자는 건드리지 않는다.
 */
export function planMoves(input: { notes: readonly VaultNote[]; assets?: readonly string[]; moves: readonly Move[] }): MovePlan {
  const moveMap = new Map(input.moves.map((m) => [m.from, m.to]));
  const after = (p: string) => moveMap.get(p) ?? p;
  const assetsBefore = [...(input.assets ?? [])];

  const parsed = input.notes.map((n) => ({ ...n, meta: parseNote(n.content).meta }));
  const pagesBefore = parsed.map((n, id) => ({ id, path: n.path, title: n.meta.title }));
  const pagesAfter = parsed.map((n, id) => ({ id, path: after(n.path), title: n.meta.title }));
  const aliases = parsed.flatMap((n, id) => n.meta.aliases.map((alias) => ({ pageId: id, alias })));
  const pageBefore = createLinkResolver(pagesBefore, aliases);
  const pageAfter = createLinkResolver(pagesAfter, aliases);
  // 파일 이름·경로로만 해석하는 해석기(제목·별칭 제외): 파일 이름이 바뀌면 제목으로 계속 해석되더라도 링크는 새 파일 이름으로 고친다
  const fileBefore = createLinkResolver(pagesBefore.map((p) => ({ ...p, title: '' })), []);
  const fileAfter = createLinkResolver(pagesAfter.map((p) => ({ ...p, title: '' })), []);
  const assetBefore = createAssetResolver(assetsBefore);
  const assetAfter = createAssetResolver(assetsBefore.map(after));
  const pathToId = new Map(pagesBefore.map((p) => [p.path.toLowerCase(), p.id]));
  const assetSet = new Set(assetsBefore.map((a) => a.toLowerCase()));

  const edits: PlannedEdit[] = [];
  let totalChanges = 0;

  parsed.forEach((note) => {
    const src = note.path;
    const srcAfter = after(src);
    const textEdits: TextEdit[] = [];

    for (const span of findLinkSpans(note.content)) {
      if (span.markdown) {
        const edit = mdEdit(span, src, srcAfter, { pathToId, assetSet, after, parsed });
        if (edit) textEdits.push(edit);
        continue;
      }
      const raw = span.rawTarget;
      const name = raw.trim();
      if (!name) continue;
      const isNote = span.kind !== 'embed' || assetKind(name) === 'note';

      if (isNote) {
        const before = pageBefore(name, src);
        if (before === undefined) continue;
        const byFile = fileBefore(name, src) === before; // 파일 이름·경로로 가리키던 링크인가(제목·별칭이 아니라)
        if (byFile ? fileAfter(name, srcAfter) === before : pageAfter(name, srcAfter) === before) continue;
        const target = pagesAfter[before]!.path;
        const text = shortestNoteName(name, target, srcAfter, before, fileAfter);
        textEdits.push({ start: span.targetStart, end: span.targetEnd, text: wrapSpaces(raw, text) });
      } else {
        const before = assetBefore(name, src);
        if (before === undefined) continue;
        if (assetAfter(name, srcAfter) === after(before)) continue;
        const target = after(before);
        const base = posix.basename(target);
        // 원래 경로로 썼으면 경로를, 이름만 썼으면 (유일할 때) 이름만 쓴다
        const text = !name.includes('/') && assetAfter(base, srcAfter) === target ? base : target;
        textEdits.push({ start: span.targetStart, end: span.targetEnd, text: wrapSpaces(raw, text) });
      }
    }

    if (textEdits.length === 0) return;
    const content = applyEdits(note.content, textEdits);
    if (content === note.content) return;
    edits.push({ path: src, newPath: srcAfter, content, changes: textEdits.length });
    totalChanges += textEdits.length;
  });

  return { edits, totalChanges };
}

function wrapSpaces(raw: string, text: string): string {
  const lead = raw.match(/^\s*/)?.[0] ?? '';
  const trail = raw.match(/\s*$/)?.[0] ?? '';
  return lead + text + trail;
}

/** 같은 노트로 해석되는 가장 짧은 위키링크 표기. 원래 경로 스타일(`/` 포함)·`.md` 확장자 표기를 유지한다. */
function shortestNoteName(
  original: string,
  newPath: string,
  fromPath: string,
  id: number,
  resolve: (raw: string, from: string) => number | undefined,
): string {
  const hadExt = original.toLowerCase().endsWith('.md');
  const hadPath = original.includes('/');
  const withExt = (s: string) => (hadExt ? `${s}.md` : s);
  const base = withExt(stripMd(posix.basename(newPath)));
  const full = withExt(stripMd(newPath));
  const candidates = hadPath ? [full, base] : [base, full];
  for (const c of candidates) if (resolve(c, fromPath) === id) return c;
  return withExt(stripMd(newPath)) === full ? `${stripMd(newPath)}${hadExt ? '.md' : ''}` : full;
}

function mdEdit(
  span: LinkSpan,
  src: string,
  srcAfter: string,
  ctx: {
    pathToId: Map<string, number>;
    assetSet: Set<string>;
    after: (p: string) => string;
    parsed: { path: string }[];
  },
): TextEdit | null {
  const rel = decode(span.rawTarget);
  const absOld = posix.normalize(posix.dirname(src) ? `${posix.dirname(src)}/${rel}` : rel);
  const key = absOld.toLowerCase();
  const exists = ctx.pathToId.has(key) || ctx.assetSet.has(key);
  if (!exists) return null;
  const real = ctx.pathToId.has(key) ? ctx.parsed[ctx.pathToId.get(key)!]!.path : absOld;
  const target = ctx.after(real);
  const newRel = posix.relative(posix.dirname(srcAfter), target);
  if (newRel === rel) return null;
  return { start: span.targetStart, end: span.targetEnd, text: formatMdPath(newRel, span) };
}
