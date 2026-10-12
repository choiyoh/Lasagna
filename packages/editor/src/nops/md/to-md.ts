import type { Mark, Node as PMNode } from 'prosemirror-model';
import { toMarkdown } from 'mdast-util-to-markdown';
import type { Handle, Options, State } from 'mdast-util-to-markdown';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { mathToMarkdown } from 'mdast-util-math';

// mdast에 없는 노드는 느슨한 타입으로 다룬다(핸들러가 직접 출력한다).
type Any = { type: string; [key: string]: unknown };

const raw = (value: string): Any => ({ type: 'nopsRaw', value });

// ───────────────────────── 인라인 ─────────────────────────

/** 바깥쪽부터 감싸는 순서. code는 가장 안쪽이다. */
const MARK_ORDER = ['link', 'strong', 'em', 'strike', 'highlight', 'underline', 'code'];

function markRank(m: Mark): number {
  const i = MARK_ORDER.indexOf(m.type.name);
  return i < 0 ? MARK_ORDER.length : i;
}

function wrapMark(m: Mark, children: Any[]): Any[] {
  switch (m.type.name) {
    case 'link':
      return [{ type: 'link', url: m.attrs.href, title: m.attrs.title ?? null, children }];
    case 'strong':
      return [{ type: 'strong', children }];
    case 'em':
      return [{ type: 'emphasis', children }];
    case 'strike':
      return [{ type: 'delete', children }];
    case 'highlight':
      return [{ type: 'nopsHighlight', children }];
    case 'underline':
      return [{ type: 'html', value: '<u>' }, ...children, { type: 'html', value: '</u>' }];
    default:
      return children;
  }
}

function leafOf(node: PMNode): Any | null {
  const a = node.attrs;
  switch (node.type.name) {
    case 'text':
      return node.marks.some((m) => m.type.name === 'code')
        ? { type: 'inlineCode', value: node.text ?? '' }
        : { type: 'text', value: node.text ?? '' };
    case 'hard_break':
      return { type: 'break' };
    case 'wikilink':
    case 'embed': {
      const frag = a.heading ? `#${a.heading}` : a.block ? `#^${a.block}` : '';
      const alias = a.alias ? `|${a.alias}` : '';
      return raw(`${node.type.name === 'embed' ? '!' : ''}[[${a.target}${frag}${alias}]]`);
    }
    case 'math_inline':
      return { type: 'inlineMath', value: a.value };
    case 'inline_image':
      return { type: 'image', url: a.src, alt: a.alt ?? '', title: a.title ?? null };
    case 'raw_inline':
      return raw(a.source);
    default:
      return null;
  }
}

/** 마크가 겹치는 구간을 공유하면서 중첩 mdast를 만든다. */
export function inlineToMdast(parent: PMNode): Any[] {
  type Frame = { mark: Mark | null; children: Any[] };
  const stack: Frame[] = [{ mark: null, children: [] }];

  const close = () => {
    const f = stack.pop()!;
    stack[stack.length - 1]!.children.push(...wrapMark(f.mark!, f.children));
  };

  parent.forEach((child) => {
    // 코드 마크는 inlineCode가 직접 처리하므로 스택에서 제외한다
    const marks = child.marks.filter((m) => m.type.name !== 'code').sort((a, b) => markRank(a) - markRank(b));
    let common = 0;
    while (common < marks.length && common + 1 < stack.length && stack[common + 1]!.mark!.eq(marks[common]!)) common++;
    while (stack.length - 1 > common) close();
    for (let i = common; i < marks.length; i++) stack.push({ mark: marks[i]!, children: [] });
    const leaf = leafOf(child);
    if (leaf) stack[stack.length - 1]!.children.push(leaf);
  });
  while (stack.length > 1) close();
  return stack[0]!.children;
}

// ───────────────────────── 블록 ─────────────────────────

function withBlockId(children: Any[], blockId: string | null | undefined): Any[] {
  return blockId ? [...children, raw(` ^${blockId}`)] : children;
}

function isEmptyParagraph(n: PMNode): boolean {
  return n.type.name === 'paragraph' && n.childCount === 0 && !n.attrs.blockId;
}

/** 열 중첩 깊이: 안쪽 `columns`가 있으면 바깥 펜스의 콜론을 더 길게 한다. */
function columnsDepth(node: PMNode): number {
  let max = 0;
  node.descendants((n) => {
    if (n.type.name === 'columns') max = Math.max(max, 1 + columnsDepth(n));
    return n.type.name !== 'columns';
  });
  return max;
}

/** 표 셀 안에서 `|`는 셀 구분자이므로 원문 토큰(위키링크 별칭 등)의 `|`를 `\\|`로 쓴다. */
function escapePipes(nodes: Any[]): Any[] {
  return nodes.map((n) => {
    if (n.type === 'nopsRaw') return { ...n, value: String(n.value).replace(/\|/g, '\\|') };
    if (Array.isArray(n.children)) return { ...n, children: escapePipes(n.children as Any[]) };
    return n;
  });
}

function cellInline(cell: PMNode): Any[] {
  const out: Any[] = [];
  cell.forEach((block, _o, i) => {
    if (i > 0) out.push(raw('<br>'));
    if (block.isTextblock) out.push(...escapePipes(inlineToMdast(block)));
    else out.push({ type: 'text', value: block.textContent });
  });
  return out;
}

export function blockToMdast(node: PMNode): Any | null {
  const a = node.attrs;
  const kids = () => blocksToMdast(node);
  switch (node.type.name) {
    case 'paragraph':
      return isEmptyParagraph(node) ? null : { type: 'paragraph', children: withBlockId(inlineToMdast(node), a.blockId) };
    case 'heading':
      return { type: 'heading', depth: a.level, children: withBlockId(inlineToMdast(node), a.blockId) };
    case 'blockquote':
      return { type: 'blockquote', children: kids() };
    case 'horizontal_rule':
      return { type: 'thematicBreak' };
    case 'code_block':
      return { type: 'code', lang: a.language ?? null, meta: a.meta ?? null, value: node.textContent };
    case 'math_block':
      return { type: 'math', value: node.textContent };
    case 'image':
      return { type: 'paragraph', children: [{ type: 'image', url: a.src, alt: a.alt ?? '', title: a.title ?? null }] };
    case 'bullet_list':
    case 'ordered_list': {
      const items: Any[] = [];
      node.forEach((li) => {
        items.push({ type: 'listItem', checked: li.attrs.checked ?? null, spread: !a.tight, children: blocksToMdast(li, true) });
      });
      return {
        type: 'list',
        ordered: node.type.name === 'ordered_list',
        start: node.type.name === 'ordered_list' ? a.order : null,
        spread: !a.tight,
        children: items,
      };
    }
    case 'callout':
    case 'toggle': {
      const [title, ...rest] = (() => {
        const arr: PMNode[] = [];
        node.forEach((c) => arr.push(c));
        return arr;
      })();
      const body: Any[] = [];
      for (const c of rest) {
        const m = blockToMdast(c);
        if (m) body.push(m);
      }
      return {
        type: 'nopsCallout',
        calloutType: node.type.name === 'toggle' ? 'toggle' : a.type,
        fold: a.fold ?? null,
        title: title ? inlineToMdast(title) : [],
        children: body,
      };
    }
    case 'columns': {
      const inner = 3 + Math.max(0, ...Array.from({ length: node.childCount }, (_, i) => columnsDepth(node.child(i))));
      const cols: Any[] = [];
      node.forEach((c) => cols.push({ type: 'nopsFence', name: 'column', colons: inner, children: blocksToMdast(c) }));
      return { type: 'nopsFence', name: 'columns', colons: inner + 1, children: cols };
    }
    case 'table': {
      const rows: Any[] = [];
      node.forEach((row) => {
        const cells: Any[] = [];
        row.forEach((cell) => cells.push({ type: 'tableCell', children: cellInline(cell) }));
        rows.push({ type: 'tableRow', children: cells });
      });
      return { type: 'table', align: a.align ?? null, children: rows };
    }
    case 'raw_block':
      return raw(a.source);
    default:
      return node.textContent ? { type: 'paragraph', children: [{ type: 'text', value: node.textContent }] } : null;
  }
}

function blocksToMdast(parent: PMNode, keepEmptyFirst = false): Any[] {
  const out: Any[] = [];
  parent.forEach((child, _o, i) => {
    const m = blockToMdast(child);
    if (m) out.push(m);
    else if (keepEmptyFirst && i === 0) out.push({ type: 'paragraph', children: [] });
  });
  return out;
}

// ───────────────────────── 핸들러 ─────────────────────────

const quoteMap = (line: string, _index: number, blank: boolean) => `>${blank ? '' : ' '}${line}`;

const nopsCallout: Handle = (node, _parent, state: State, info) => {
  const n = node as unknown as Any & { calloutType: string; fold: string | null; title: Any[]; children: Any[] };
  const exit = state.enter('blockquote');
  const tracker = state.createTracker(info);
  tracker.move('> ');
  tracker.shift(2);
  const exitParagraph = state.enter('paragraph');
  const exitPhrasing = state.enter('phrasing');
  const title = state.containerPhrasing({ type: 'paragraph', children: n.title } as never, {
    before: ' ',
    after: '\n',
    ...tracker.current(),
  });
  exitPhrasing();
  exitParagraph();
  const head = `[!${n.calloutType}]${n.fold ?? ''}${title ? ` ${title}` : ''}`;
  const body = n.children.length ? state.containerFlow({ type: 'blockquote', children: n.children } as never, tracker.current()) : '';
  // 본문이 문단이면 제목 바로 아랫줄에, 아니면 빈 줄 하나를 두고 시작한다
  const sep = n.children[0]?.type === 'paragraph' ? '\n' : '\n\n';
  const value = state.indentLines(body ? `${head}${sep}${body}` : head, quoteMap);
  exit();
  return value;
};

const nopsFence: Handle = (node, _parent, state: State, info) => {
  const n = node as unknown as Any & { name: string; colons: number; children: Any[] };
  const fence = ':'.repeat(n.colons);
  const body = state.containerFlow({ type: 'root', children: n.children } as never, info);
  return `${fence}${n.name}\n\n${body}\n\n${fence}`;
};

const OPTIONS: Options = {
  bullet: '-',
  bulletOther: '*',
  emphasis: '*',
  strong: '*',
  fence: '`',
  rule: '-',
  listItemIndent: 'one',
  incrementListMarker: true,
  resourceLink: false,
  extensions: [
    gfmToMarkdown({ tablePipeAlign: false }),
    mathToMarkdown(),
    {
      handlers: ({
        nopsRaw: ((node: unknown) => (node as Any).value as string) as Handle,
        nopsHighlight: ((node: unknown, _p: unknown, state: State, info: Parameters<Handle>[3]) =>
          `==${state.containerPhrasing(node as never, info)}==`) as Handle,
        nopsCallout,
        nopsFence,
      } as unknown) as Options['handlers'],
    },
  ],
};

/** 최상위 PM 블록 하나를 Markdown 원문으로 직렬화한다(끝 줄바꿈 없음). */
export function blockToMarkdown(node: PMNode): string {
  const m = blockToMdast(node);
  if (!m) return '';
  return toMarkdown({ type: 'root', children: [m] } as never, OPTIONS).replace(/\n+$/, '');
}
