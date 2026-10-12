/**
 * 그래프 뷰(전역·로컬)용 인덱스 질의 — SQLite 인덱스(`pages`/`links`/`tags`)에서 노트 그래프를 계산한다.
 *
 * `links.dst_page` 는 `Indexer.resolveLinks()` 가 채우므로 **호출하는 쪽이 먼저 불러야 한다**
 * (여기서는 부르지 않는다 — 읽기만 하는 순수 질의 함수 모음).
 */

import type Database from 'better-sqlite3';

export interface GraphNode {
  /** 노트: 상대 경로("폴더/노트.md"), 태그: "#태그", 미해결: "?대상텍스트" */
  id: string;
  kind: 'note' | 'tag' | 'unresolved';
  /** 노트: title, 태그: "#태그", 미해결: 대상 텍스트 */
  label: string;
  /** 노트만 `pages.folder`, 나머지 '' */
  folder: string;
  /** 노트만(정렬·중복 제거), 나머지 [] */
  tags: string[];
  /** 결과 그래프 안에서의 엣지 수(들어오는+나가는) */
  degree: number;
  /** 로컬 그래프에서만: 중심 노트로부터의 거리(중심=0) */
  depth?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: 'link' | 'tag';
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GlobalGraphOptions {
  /** 기본 false. true면 태그 노드와 노트→태그 엣지(kind 'tag') */
  includeTags?: boolean;
  /** 기본 false. true면 미해결 위키링크 대상 노드와 엣지 */
  includeUnresolved?: boolean;
  /** 기본 true. false면 degree 0인 노트 제외 */
  includeOrphans?: boolean;
}

export interface LocalGraphOptions extends GlobalGraphOptions {
  /** 1~5로 클램프, 기본 1 */
  depth?: number;
  /** 기본 'both' */
  direction?: 'both' | 'out' | 'in';
}

/** 노트 사이 엣지로 인정하는 링크 종류(프런트매터 relation·임베드·마크다운 링크 포함) */
const NOTE_LINK_KINDS = `('wikilink','embed','md','relation')`;
/** 미해결 노드로 만들 링크 종류(임베드·md는 노트가 아니라 첨부·URL을 가리키므로 뺀다) */
const UNRESOLVED_LINK_KINDS = `('wikilink','relation')`;
const MIN_DEPTH = 1;
const MAX_DEPTH = 5;

interface PageRow {
  id: number;
  path: string;
  title: string;
  folder: string;
}

/** 그래프에 넣을 노드의 원본 — degree(와 depth)는 엣지·탐색 결과로 나중에 채운다. */
interface RawNode {
  id: string;
  kind: GraphNode['kind'];
  label: string;
  folder: string;
  tags: string[];
}

/** 경로·id 문자열의 결정적 비교(코드포인트 순서) */
const cmpText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function readPages(db: Database.Database): PageRow[] {
  return db.prepare(`SELECT id, path, title, folder FROM pages`).all() as PageRow[];
}

/** page_id → 태그 목록(정렬·중복 제거). 같은 태그가 인라인·프런트매터 양쪽에 있어도 한 번만 센다. */
function readTags(db: Database.Database): Map<number, string[]> {
  const rows = db
    .prepare(`SELECT DISTINCT page_id AS pageId, tag AS tag FROM tags ORDER BY pageId, tag`)
    .all() as { pageId: number; tag: string }[];
  const out = new Map<number, string[]>();
  for (const r of rows) {
    const list = out.get(r.pageId);
    if (list) list.push(r.tag);
    else out.set(r.pageId, [r.tag]);
  }
  return out;
}

/** 노트 사이 엣지의 (src_page, dst_page) 쌍 — 자기 자신·미해결·중복 링크는 뺀다. */
function readNoteEdges(db: Database.Database): { src: number; dst: number }[] {
  return db
    .prepare(
      `SELECT DISTINCT src_page AS src, dst_page AS dst FROM links
       WHERE dst_page IS NOT NULL AND src_page != dst_page AND kind IN ${NOTE_LINK_KINDS}`,
    )
    .all() as { src: number; dst: number }[];
}

/** 미해결 위키링크의 (src_page, 대상 텍스트) 쌍 — 대상이 빈 링크(`[[#제목]]`)는 뺀다. */
function readUnresolved(db: Database.Database): { src: number; raw: string }[] {
  return db
    .prepare(
      `SELECT DISTINCT src_page AS src, dst_raw AS raw FROM links
       WHERE dst_page IS NULL AND is_resolved = 0 AND dst_raw != '' AND kind IN ${UNRESOLVED_LINK_KINDS}`,
    )
    .all() as { src: number; raw: string }[];
}

function noteNode(page: PageRow, tags: Map<number, string[]>): RawNode {
  return {
    id: page.path,
    kind: 'note',
    label: page.title,
    folder: page.folder,
    tags: tags.get(page.id) ?? [],
  };
}

/** 노트 쌍을 경로 기준 엣지로 바꾼다. */
function linkEdges(pairs: { src: number; dst: number }[], byId: Map<number, PageRow>): GraphEdge[] {
  const out: GraphEdge[] = [];
  for (const p of pairs) {
    const src = byId.get(p.src);
    const dst = byId.get(p.dst);
    // resolveLinks() 뒤라면 둘 다 있지만, 노트 삭제가 섞인 인덱스에서도 경로를 지어내지 않도록 확인한다
    if (src && dst) out.push({ source: src.path, target: dst.path, kind: 'link' });
  }
  return out;
}

/** `pages` 각각의 태그마다 태그 노드 1개와 노트→태그 엣지를 붙인다(중복 태그는 한 번만). */
function addTagNodes(
  nodes: Map<string, RawNode>,
  edges: GraphEdge[],
  pages: readonly PageRow[],
  tags: Map<number, string[]>,
): void {
  for (const page of pages) {
    for (const tag of tags.get(page.id) ?? []) {
      const id = `#${tag}`;
      if (!nodes.has(id)) nodes.set(id, { id, kind: 'tag', label: id, folder: '', tags: [] });
      edges.push({ source: page.path, target: id, kind: 'tag' });
    }
  }
}

/** 미해결 링크마다 대상 텍스트 노드 1개(같은 텍스트는 한 노드로 합침)와 엣지를 붙인다. */
function addUnresolvedNodes(
  nodes: Map<string, RawNode>,
  edges: GraphEdge[],
  rows: readonly { src: number; raw: string }[],
  byId: Map<number, PageRow>,
): void {
  for (const row of rows) {
    const src = byId.get(row.src);
    if (!src) continue;
    const id = `?${row.raw}`;
    if (!nodes.has(id))
      nodes.set(id, { id, kind: 'unresolved', label: row.raw, folder: '', tags: [] });
    edges.push({ source: src.path, target: id, kind: 'link' });
  }
}

/**
 * 노드·엣지에 degree(그리고 로컬이면 depth)를 채우고 정렬한다.
 * `includeOrphans` 가 false면 엣지가 없는 **노트**를 뺀다(태그·미해결 노드는 엣지에서만 생기므로 해당 없음).
 */
function build(
  nodes: Map<string, RawNode>,
  edges: GraphEdge[],
  includeOrphans: boolean,
  depths?: Map<string, number>,
): GraphData {
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  const out: GraphNode[] = [];
  for (const n of nodes.values()) {
    const d = degree.get(n.id) ?? 0;
    if (!includeOrphans && n.kind === 'note' && d === 0) continue;
    const node: GraphNode = { ...n, degree: d };
    const depth = depths?.get(n.id);
    if (depth !== undefined) node.depth = depth;
    out.push(node);
  }
  out.sort((a, b) => cmpText(a.id, b.id));

  const sorted = [...edges].sort(
    (a, b) => cmpText(a.source, b.source) || cmpText(a.target, b.target) || cmpText(a.kind, b.kind),
  );
  return { nodes: out, edges: sorted };
}

/** 전역 그래프: 볼트의 모든 노트와 그 사이 링크(+옵션에 따라 태그·미해결 노드). */
export function globalGraph(db: Database.Database, opts: GlobalGraphOptions = {}): GraphData {
  const pages = readPages(db);
  const byId = new Map(pages.map((p) => [p.id, p]));
  const tags = readTags(db);

  const nodes = new Map<string, RawNode>();
  for (const page of pages) nodes.set(page.path, noteNode(page, tags));

  const edges = linkEdges(readNoteEdges(db), byId);
  if (opts.includeTags) addTagNodes(nodes, edges, pages, tags);
  if (opts.includeUnresolved) addUnresolvedNodes(nodes, edges, readUnresolved(db), byId);

  return build(nodes, edges, opts.includeOrphans ?? true);
}

/** 로컬 그래프 깊이 — 내림한 뒤 1~5로 가둔다(기본 1). */
function clampDepth(depth: number | undefined): number {
  if (depth === undefined || !Number.isFinite(depth)) return MIN_DEPTH;
  return Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, Math.trunc(depth)));
}

/** 중심에서 `direction` 방향으로만 따라가며 `depth` 단계까지 닿는 page_id → 거리. */
function reachableNotes(
  centerId: number,
  pairs: readonly { src: number; dst: number }[],
  depth: number,
  direction: NonNullable<LocalGraphOptions['direction']>,
): Map<number, number> {
  const outgoing = new Map<number, number[]>();
  const incoming = new Map<number, number[]>();
  const push = (m: Map<number, number[]>, key: number, value: number) => {
    const list = m.get(key);
    if (list) list.push(value);
    else m.set(key, [value]);
  };
  for (const p of pairs) {
    push(outgoing, p.src, p.dst);
    push(incoming, p.dst, p.src);
  }

  const dist = new Map<number, number>([[centerId, 0]]);
  const queue: number[] = [centerId];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const d = dist.get(cur)!;
    if (d >= depth) continue;
    const next = [
      ...(direction === 'in' ? [] : (outgoing.get(cur) ?? [])),
      ...(direction === 'out' ? [] : (incoming.get(cur) ?? [])),
    ];
    for (const id of next) {
      if (dist.has(id)) continue;
      dist.set(id, d + 1);
      queue.push(id);
    }
  }
  return dist;
}

/**
 * 로컬 그래프: `centerPath` 노트를 중심으로 `direction` 방향으로 `depth` 단계까지의 노트.
 *
 * 엣지는 **포함된 노트들 사이의 모든 링크**를 넣는다(탐색 방향과 반대 방향 링크도 포함 노트끼리면 넣는다).
 * 태그·미해결 노드는 포함된 노트에 붙은 것만 넣고, depth는 노트에만 채운다.
 * `includeOrphans` 는 무시한다(중심 노트는 항상 포함). `centerPath` 가 없으면 빈 그래프.
 */
export function localGraph(
  db: Database.Database,
  centerPath: string,
  opts: LocalGraphOptions = {},
): GraphData {
  const pages = readPages(db);
  const center = pages.find((p) => p.path === centerPath);
  if (!center) return { nodes: [], edges: [] };

  const pairs = readNoteEdges(db);
  const dist = reachableNotes(center.id, pairs, clampDepth(opts.depth), opts.direction ?? 'both');
  const included = pages.filter((p) => dist.has(p.id));
  const byId = new Map(pages.map((p) => [p.id, p]));

  const tags = readTags(db);
  const nodes = new Map<string, RawNode>();
  const depths = new Map<string, number>();
  for (const page of included) {
    nodes.set(page.path, noteNode(page, tags));
    depths.set(page.path, dist.get(page.id)!);
  }

  const edges = linkEdges(
    pairs.filter((p) => dist.has(p.src) && dist.has(p.dst)),
    byId,
  );
  if (opts.includeTags) addTagNodes(nodes, edges, included, tags);
  if (opts.includeUnresolved)
    addUnresolvedNodes(
      nodes,
      edges,
      readUnresolved(db).filter((row) => dist.has(row.src)),
      byId,
    );

  return build(nodes, edges, true, depths);
}
