import path from 'node:path';

export interface ResolvablePage {
  id: number;
  /** 볼트 기준 상대 경로 (예: `프로젝트/노트.md`) */
  path: string;
  title: string;
}

export interface ResolvableAlias {
  pageId: number;
  alias: string;
}

export type LinkResolver = (raw: string, fromPath: string) => number | undefined;

const lower = (s: string) => s.toLowerCase();
const stripMd = (s: string) => (s.toLowerCase().endsWith('.md') ? s.slice(0, -3) : s);
const depth = (p: string) => p.split('/').length;

/**
 * 링크 대상 해석기를 만든다. 우선순위:
 *  1) 경로 정확 일치(볼트 루트 기준, 또는 링크가 있는 노트 폴더 기준)
 *  2) 파일명 일치 — 여러 개면 경로가 가장 짧은 것, 같으면 링크가 있는 폴더와 가까운 것
 *  3) 제목 일치  4) 별칭 일치
 * 이름 비교는 대소문자를 구분하지 않고 `.md` 확장자는 생략할 수 있다.
 */
export function createLinkResolver(pages: ResolvablePage[], aliases: ResolvableAlias[]): LinkResolver {
  const byPath = new Map<string, ResolvablePage>();
  const byName = new Map<string, ResolvablePage[]>();
  const byTitle = new Map<string, ResolvablePage[]>();
  const byAlias = new Map<string, number[]>();

  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
    const arr = m.get(k);
    if (arr) arr.push(v);
    else m.set(k, [v]);
  };

  for (const p of pages) {
    byPath.set(lower(stripMd(p.path)), p);
    push(byName, lower(path.posix.basename(stripMd(p.path))), p);
    if (p.title) push(byTitle, lower(p.title), p);
  }
  for (const a of aliases) push(byAlias, lower(a.alias), a.pageId);

  const best = (cands: ResolvablePage[], fromDir: string): ResolvablePage | undefined =>
    [...cands].sort(
      (a, b) =>
        depth(a.path) - depth(b.path) ||
        Number(path.posix.dirname(b.path) === fromDir) - Number(path.posix.dirname(a.path) === fromDir) ||
        a.path.localeCompare(b.path),
    )[0];

  return (raw, fromPath) => {
    const name = raw.trim().replace(/^\.?\//, '');
    if (!name) return undefined;
    const key = lower(stripMd(name));
    const fromDir = path.posix.dirname(fromPath);

    // 1) 경로 정확 일치
    const rel = lower(stripMd(path.posix.normalize(path.posix.join(fromDir === '.' ? '' : fromDir, name))));
    const exact = byPath.get(rel) ?? byPath.get(key);
    if (exact) return exact.id;

    // 2) 파일명 (경로가 포함된 링크는 접미 경로가 일치해야 한다)
    if (key.includes('/')) {
      const base = key.slice(key.lastIndexOf('/') + 1);
      const suffix = `/${key}`;
      const hit = best(
        (byName.get(base) ?? []).filter((p) => lower(stripMd(p.path)).endsWith(suffix)),
        fromDir,
      );
      if (hit) return hit.id;
    } else {
      const hit = best(byName.get(key) ?? [], fromDir);
      if (hit) return hit.id;
    }

    // 3) 제목, 4) 별칭
    const t = best(byTitle.get(lower(name)) ?? [], fromDir);
    if (t) return t.id;
    return byAlias.get(lower(name))?.[0];
  };
}
