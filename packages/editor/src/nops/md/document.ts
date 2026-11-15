import type { Node as PMNode, Schema } from 'prosemirror-model';
import { parseForEditor } from '@nopsidian/core/markdown';
import { nopsSchema } from '../schema';
import { convertParsed, type Segment } from './to-pm';
import { blockToMarkdown } from './to-md';

/**
 * 파싱 직후의 원문 정보. 저장할 때 "바뀌지 않은 블록"의 원문 바이트를 그대로 되살리는 데 쓴다.
 * (파일이 진실이므로, 열었다가 저장만 해도 diff가 생기지 않아야 한다.)
 */
export interface Baseline {
  source: string;
  segments: Segment[];
  /** 첫 블록 앞의 모든 것(프런트매터 + 빈 줄) */
  leading: string;
  /** 마지막 블록 뒤의 모든 것(끝 줄바꿈 등) */
  tail: string;
  /** 프런트매터 원문(없으면 null) */
  frontmatter: string | null;
  eol: '\n' | '\r\n';
}

export interface ParsedDocument {
  doc: PMNode;
  baseline: Baseline;
}

export function parseDocument(source: string, schema: Schema = nopsSchema): ParsedDocument {
  const ep = parseForEditor(source);
  const { doc, segments } = convertParsed(schema, ep);
  const first = segments[0];
  const last = segments[segments.length - 1];
  return {
    doc,
    baseline: {
      source,
      segments,
      leading: first ? source.slice(0, first.start) : source,
      tail: last ? source.slice(last.end) : '',
      frontmatter: ep.note.frontmatter?.raw ?? null,
      eol: source.includes('\r\n') ? '\r\n' : '\n',
    },
  };
}

const hashOf = (n: PMNode) => JSON.stringify(n.toJSON());

/**
 * 현재 문서의 각 최상위 블록을 원래 블록과 대응시킨다.
 * 내용이 완전히 같은 블록은 원문 바이트 그대로, 나머지만 새로 직렬화한다.
 */
function matchBaseline(children: PMNode[], segments: Segment[]): number[] {
  const byHash = new Map<string, number[]>();
  segments.forEach((s, j) => {
    const h = hashOf(s.node);
    const list = byHash.get(h);
    if (list) list.push(j);
    else byHash.set(h, [j]);
  });
  const used = new Set<number>();
  let lastJ = -1;
  return children.map((child) => {
    const list = byHash.get(hashOf(child));
    if (!list) return -1;
    // 직전 대응 바로 다음 블록을 우선하고, 없으면 이후의 가장 가까운 것, 그것도 없으면 아무거나
    const pick =
      list.find((j) => !used.has(j) && j === lastJ + 1) ??
      list.find((j) => !used.has(j) && j > lastJ) ??
      list.find((j) => !used.has(j));
    if (pick === undefined) return -1;
    used.add(pick);
    lastJ = pick;
    return pick;
  });
}

export function serializeDocument(doc: PMNode, baseline: Baseline | null): string {
  const eol = baseline?.eol ?? '\n';
  const children: PMNode[] = [];
  doc.forEach((c) => children.push(c));
  const segments = baseline?.segments ?? [];

  // 빈 문서를 열기만 한 경우
  if (baseline && segments.length === 0 && children.every((c) => c.type.name === 'paragraph' && c.childCount === 0)) {
    return baseline.source;
  }

  const matched = baseline ? matchBaseline(children, segments) : children.map(() => -1);
  const fresh = (n: PMNode) => {
    const md = blockToMarkdown(n);
    return eol === '\r\n' ? md.replace(/\r?\n/g, '\r\n') : md;
  };

  const newlines = (text: string) => (text.match(/\r?\n/g) ?? []).length;
  let out = '';
  let emitted = 0;
  let prevJ = -1;
  let lastEmittedJ = -1;
  /** 저장 대기 중인 빈 문단 수 — 블록 사이에만 여분 빈 줄로 쓴다(맨 앞·맨 뒤는 버린다). */
  let pendingEmpty = 0;
  children.forEach((node, i) => {
    // 빈 문단은 그 자체로는 아무것도 쓰지 않고, 다음 블록과의 간격을 한 줄 늘린다.
    if (node.type.name === 'paragraph' && node.childCount === 0 && !node.attrs.blockId) {
      if (emitted > 0) pendingEmpty++;
      return;
    }
    const j = matched[i]!;
    const text = j >= 0 ? baseline!.source.slice(segments[j]!.start, segments[j]!.end) : fresh(node);
    if (text === '') return;

    if (emitted === 0) {
      out += j === 0 && baseline ? baseline.leading : baseline?.frontmatter ? baseline.frontmatter + eol : '';
    } else {
      const adjacent = j >= 0 && prevJ >= 0 && j === prevJ + 1;
      const sourceGap = adjacent ? baseline!.source.slice(segments[prevJ]!.end, segments[j]!.start) : '';
      // 원문 간격의 빈 문단 수와 지금 문서의 빈 문단 수가 같으면 원문 바이트 그대로 둔다.
      const sourceEmpties = adjacent ? Math.max(0, newlines(sourceGap) - 2) : -1;
      out += adjacent && pendingEmpty === sourceEmpties ? sourceGap : eol.repeat(2 + pendingEmpty);
    }
    out += text;
    emitted++;
    prevJ = j;
    lastEmittedJ = j;
    pendingEmpty = 0;
  });

  if (emitted === 0) return baseline?.frontmatter ?? '';
  const keepTail = baseline && lastEmittedJ >= 0 && lastEmittedJ === segments.length - 1;
  out += keepTail ? baseline.tail : eol;

  // 프런트매터가 없는 문서가 구분선(`---`)으로 시작하면 다음 `---`와 짝지어 프런트매터로 오인된다.
  // 같은 뜻의 `***`로 바꿔 쓴다.
  if (!baseline?.frontmatter && /^---[ \t]*\r?\n/.test(out) && /\r?\n---[ \t]*(\r?\n|$)/.test(out.slice(3))) {
    out = '***' + out.slice(3);
  }
  return out;
}
