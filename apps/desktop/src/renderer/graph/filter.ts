/**
 * 그래프 뷰의 검색 질의 파서와 필터·색 그룹 판정.
 *
 * 검색창 질의 문자열을 항(term) 목록으로 해석해 노드를 걸러 내고, "질의 → 색" 그룹 목록으로
 * 노드 색을 정한다. DOM/React/Electron 없이 돌아가는 순수 함수만 둔다.
 *
 * 문법: 공백으로 구분한 항들은 AND. 따옴표로 묶으면 공백 포함 한 항(`"클린 코드"`), 항 앞 `-` 는 부정.
 * 접두어 `tag:` `path:` `folder:` `file:` `kind:` 를 지원하고, 그 외 접두어/접두어 없는 항은
 * 통째로 label 부분 일치다. 빈 값 항(`tag:`)·빈 질의는 무시(빈 질의는 모두 일치).
 */

export interface FilterNode {
  /** 노트: 상대 경로, 태그: "#태그", 미해결: "?텍스트" */
  id: string;
  kind: 'note' | 'tag' | 'unresolved';
  /** 표시 이름(제목) */
  label: string;
  /** 노트의 폴더(루트면 '') */
  folder: string;
  /** "프로젝트/알파" 처럼 # 없이, 중첩 태그는 슬래시 */
  tags: string[];
}

export interface ColorGroup {
  query: string;
  color: string;
}

export interface ParsedTerm {
  negate: boolean;
  /** `tag|path|folder|file|kind` 중 하나, 접두어 없는 항(label)이면 null */
  field: string | null;
  value: string;
}

export interface ParsedQuery {
  terms: ParsedTerm[];
}

/** 접두어로 인정하는 필드. 이 외의 `foo:` 는 통째로 label 항이 된다. */
const FIELDS = new Set(['tag', 'path', 'folder', 'file', 'kind']);

/** 공백 판정(공백·탭·개행 모두) */
const SPACE = /\s/;

/**
 * 질의를 항 목록으로 파싱한다.
 *
 * 따옴표는 공백을 포함시키는 용도이고, 닫히지 않은 따옴표는 끝까지를 한 항으로 본다.
 * 빈 항(`-`, `""`)과 빈 값 항(`tag:`)은 결과에서 빠진다.
 */
export function parseGraphQuery(q: string): ParsedQuery {
  const terms: ParsedTerm[] = [];
  const n = q.length;
  let i = 0;

  while (i < n) {
    while (i < n && SPACE.test(q[i]!)) i++;
    if (i >= n) break;

    let negate = false;
    if (q[i] === '-') {
      negate = true;
      i++;
    }

    // 항 하나를 읽는다. 따옴표 안의 공백은 항에 포함한다.
    let raw = '';
    while (i < n) {
      const c = q[i]!;
      if (c === '"') {
        i++;
        while (i < n && q[i] !== '"') raw += q[i++];
        if (i < n) i++; // 닫는 따옴표 소비
      } else if (SPACE.test(c)) {
        break;
      } else {
        raw += c;
        i++;
      }
    }

    if (raw === '') continue;

    const colon = raw.indexOf(':');
    const field = colon >= 0 ? raw.slice(0, colon) : '';
    if (colon >= 0 && FIELDS.has(field)) {
      const value = raw.slice(colon + 1);
      if (value === '') continue; // `tag:` 같은 빈 값 항은 무시
      terms.push({ negate, field, value });
    } else {
      terms.push({ negate, field: null, value: raw });
    }
  }

  return { terms };
}

/** `x` 이거나 `x/` 로 시작하면 하위 태그까지 포함해 일치. */
function tagEquals(tag: string, value: string): boolean {
  const t = tag.toLowerCase();
  return t === value || t.startsWith(value + '/');
}

function matchesTag(node: FilterNode, value: string): boolean {
  if (node.kind === 'tag') return tagEquals(node.id.replace(/^#/, ''), value);
  if (node.kind === 'note') return node.tags.some((tag) => tagEquals(tag, value));
  return false;
}

/** 폴더는 같은 폴더이거나 하위 폴더(`x/`)일 때 일치. */
function matchesFolder(folder: string, value: string): boolean {
  const f = folder.toLowerCase();
  return f === value || f.startsWith(value + '/');
}

/** 경로의 마지막 부분에서 확장자 `.md` 를 뗀 이름에 부분 일치. */
function matchesFile(id: string, value: string): boolean {
  const slash = id.lastIndexOf('/');
  const base = slash >= 0 ? id.slice(slash + 1) : id;
  return base.toLowerCase().replace(/\.md$/, '').includes(value);
}

function termMatches(node: FilterNode, term: ParsedTerm): boolean {
  const value = term.value.toLowerCase();
  switch (term.field) {
    case 'tag':
      return matchesTag(node, value.replace(/^#/, ''));
    case 'path':
      return node.kind === 'note' && node.id.toLowerCase().includes(value);
    case 'folder':
      return node.kind === 'note' && matchesFolder(node.folder, value);
    case 'file':
      return node.kind === 'note' && matchesFile(node.id, value);
    case 'kind':
      return node.kind.toLowerCase() === value;
    default:
      return node.label.toLowerCase().includes(value);
  }
}

/** 항 목록(또는 질의 문자열)이 노드에 맞는지. 부정 항은 일치하지 않아야 통과한다. */
export function matchesQuery(node: FilterNode, q: string | ParsedQuery): boolean {
  const parsed = typeof q === 'string' ? parseGraphQuery(q) : q;
  for (const term of parsed.terms) {
    if (termMatches(node, term) === term.negate) return false;
  }
  return true;
}

/** 위에서부터 처음 일치하는 그룹의 색, 없으면 fallback. */
export function colorForNode(node: FilterNode, groups: ColorGroup[], fallback: string): string {
  for (const group of groups) {
    if (matchesQuery(node, group.query)) return group.color;
  }
  return fallback;
}

/** 질의에 맞는 노드만 순서를 유지해 돌려준다(질의는 한 번만 파싱). */
export function filterNodes<T extends FilterNode>(nodes: T[], q: string): T[] {
  const parsed = parseGraphQuery(q);
  return nodes.filter((node) => matchesQuery(node, parsed));
}
