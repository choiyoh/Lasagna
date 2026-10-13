import { Schema } from 'prosemirror-model';
import type { MarkSpec, NodeSpec } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';

import { marks as baseMarks, nodes as baseNodes } from '@oh-new-editor/core';

/**
 * Nopsidian 스키마 = 업스트림 기본 노드 + 콜아웃·토글·열·위키링크·임베드·수식·원문 보존 노드 + 표.
 * 업스트림 파일(`schema/*`)은 건드리지 않고 이 파일에서 확장한다.
 */

const div = (name: string, attrs?: (node: import('prosemirror-model').Node) => Record<string, string>) =>
  (node: import('prosemirror-model').Node) => ['div', { [`data-${name}`]: '', ...(attrs?.(node) ?? {}) }, 0] as const;

const blockIdAttr = { blockId: { default: null } };

const callout: NodeSpec = {
  group: 'block',
  content: 'callout_title block*',
  defining: true,
  attrs: { type: { default: 'note' }, fold: { default: null } },
  parseDOM: [
    {
      tag: 'div[data-callout]',
      getAttrs: (dom) => ({
        type: (dom as HTMLElement).getAttribute('data-callout') || 'note',
        fold: (dom as HTMLElement).getAttribute('data-fold') || null
      })
    }
  ],
  toDOM: (node) => [
    'div',
    { 'data-callout': node.attrs.type, ...(node.attrs.fold ? { 'data-fold': node.attrs.fold } : {}) },
    0
  ]
};

const calloutTitle: NodeSpec = {
  content: 'inline*',
  defining: true,
  parseDOM: [{ tag: 'div[data-callout-title]' }],
  toDOM: div('callout-title')
};

const toggle: NodeSpec = {
  group: 'block',
  content: 'toggle_summary block*',
  defining: true,
  attrs: { fold: { default: '+' } },
  parseDOM: [{ tag: 'div[data-toggle]', getAttrs: (dom) => ({ fold: (dom as HTMLElement).getAttribute('data-toggle') || '+' }) }],
  toDOM: (node) => ['div', { 'data-toggle': node.attrs.fold }, 0]
};

const toggleSummary: NodeSpec = {
  content: 'inline*',
  defining: true,
  parseDOM: [{ tag: 'div[data-toggle-summary]' }],
  toDOM: div('toggle-summary')
};

const columns: NodeSpec = {
  group: 'block',
  content: 'column{2,5}',
  isolating: true,
  parseDOM: [{ tag: 'div[data-columns]' }],
  toDOM: div('columns')
};

const column: NodeSpec = {
  content: 'block+',
  isolating: true,
  parseDOM: [{ tag: 'div[data-column]' }],
  toDOM: div('column')
};

const linkAttrs = { target: { default: '' }, heading: { default: null }, block: { default: null }, alias: { default: null } };

const wikilink: NodeSpec = {
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  attrs: linkAttrs,
  parseDOM: [
    {
      tag: 'span[data-wikilink]',
      getAttrs: (dom) => {
        const el = dom as HTMLElement;
        return {
          target: el.getAttribute('data-wikilink') ?? '',
          heading: el.getAttribute('data-heading'),
          block: el.getAttribute('data-block'),
          alias: el.getAttribute('data-alias')
        };
      }
    }
  ],
  toDOM: (node) => {
    const { target, heading, block, alias } = node.attrs;
    const label = alias ?? [target, heading ? `#${heading}` : '', block ? `#^${block}` : ''].join('');
    return [
      'span',
      {
        class: 'nops-wikilink',
        'data-wikilink': target,
        ...(heading ? { 'data-heading': heading } : {}),
        ...(block ? { 'data-block': block } : {}),
        ...(alias ? { 'data-alias': alias } : {})
      },
      label || '[[ ]]'
    ];
  }
};

const embed: NodeSpec = {
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  attrs: linkAttrs,
  parseDOM: [
    {
      tag: 'span[data-embed]',
      getAttrs: (dom) => {
        const el = dom as HTMLElement;
        return {
          target: el.getAttribute('data-embed') ?? '',
          heading: el.getAttribute('data-heading'),
          block: el.getAttribute('data-block'),
          alias: el.getAttribute('data-alias')
        };
      }
    }
  ],
  toDOM: (node) => {
    const { target, heading, block, alias } = node.attrs;
    return [
      'span',
      {
        class: 'nops-embed',
        'data-embed': target,
        ...(heading ? { 'data-heading': heading } : {}),
        ...(block ? { 'data-block': block } : {}),
        ...(alias ? { 'data-alias': alias } : {})
      },
      `![[${target}]]`
    ];
  }
};

const mathInline: NodeSpec = {
  group: 'inline',
  inline: true,
  atom: true,
  attrs: { value: { default: '' } },
  parseDOM: [{ tag: 'span[data-math-inline]', getAttrs: (d) => ({ value: (d as HTMLElement).getAttribute('data-math-inline') ?? '' }) }],
  toDOM: (node) => ['span', { class: 'nops-math', 'data-math-inline': node.attrs.value }, `$${node.attrs.value}$`]
};

const mathBlock: NodeSpec = {
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  parseDOM: [{ tag: 'pre[data-math-block]', preserveWhitespace: 'full' }],
  toDOM: () => ['pre', { 'data-math-block': '' }, ['code', 0]]
};

const inlineImage: NodeSpec = {
  group: 'inline',
  inline: true,
  atom: true,
  attrs: { src: { default: '' }, alt: { default: null }, title: { default: null } },
  parseDOM: [
    {
      tag: 'img[data-inline]',
      getAttrs: (d) => {
        const el = d as HTMLElement;
        return { src: el.getAttribute('src') ?? '', alt: el.getAttribute('alt'), title: el.getAttribute('title') };
      }
    }
  ],
  toDOM: (node) => ['img', { 'data-inline': '', src: node.attrs.src, alt: node.attrs.alt ?? '', title: node.attrs.title }]
};

/** 에디터가 이해하지 못하는 문법은 원문 그대로 보존한다(편집 불가). */
const rawBlock: NodeSpec = {
  group: 'block',
  atom: true,
  selectable: true,
  attrs: { source: { default: '' } },
  parseDOM: [{ tag: 'pre[data-raw-block]', getAttrs: (d) => ({ source: (d as HTMLElement).textContent ?? '' }) }],
  toDOM: (node) => ['pre', { class: 'nops-raw', 'data-raw-block': '' }, node.attrs.source]
};

const rawInline: NodeSpec = {
  group: 'inline',
  inline: true,
  atom: true,
  attrs: { source: { default: '' } },
  parseDOM: [{ tag: 'span[data-raw-inline]', getAttrs: (d) => ({ source: (d as HTMLElement).textContent ?? '' }) }],
  toDOM: (node) => ['span', { class: 'nops-raw-inline', 'data-raw-inline': '' }, node.attrs.source]
};

const highlight: MarkSpec = {
  parseDOM: [{ tag: 'mark' }],
  toDOM: () => ['mark', 0]
};

function withAttrs(spec: NodeSpec | undefined, attrs: NonNullable<NodeSpec['attrs']>): NodeSpec {
  if (!spec) throw new Error('업스트림 노드를 찾지 못함');
  return { ...spec, attrs: { ...(spec.attrs ?? {}), ...attrs } };
}

function buildNodes() {
  let nodes = baseNodes as import('orderedmap').default<NodeSpec>;

  // 블록 ID(`^id`)와 목록 속성
  nodes = nodes
    .update('paragraph', withAttrs(nodes.get('paragraph'), blockIdAttr))
    .update('heading', withAttrs(nodes.get('heading'), blockIdAttr))
    .update('bullet_list', withAttrs(nodes.get('bullet_list'), { tight: { default: true } }))
    .update('ordered_list', withAttrs(nodes.get('ordered_list'), { tight: { default: true } }))
    .update('list_item', {
      ...withAttrs(nodes.get('list_item'), { checked: { default: null } }),
      parseDOM: [
        {
          tag: 'li',
          getAttrs: (dom) => {
            const v = (dom as HTMLElement).getAttribute('data-checked');
            return { checked: v === null ? null : v === 'true' };
          }
        }
      ],
      toDOM: (node) =>
        node.attrs.checked === null ? ['li', 0] : ['li', { 'data-checked': String(node.attrs.checked) }, 0]
    })
    .update('code_block', withAttrs(nodes.get('code_block'), { meta: { default: null } }));

  nodes = nodes.append({
    callout,
    callout_title: calloutTitle,
    toggle,
    toggle_summary: toggleSummary,
    columns,
    column,
    wikilink,
    embed,
    math_inline: mathInline,
    math_block: mathBlock,
    inline_image: inlineImage,
    raw_block: rawBlock,
    raw_inline: rawInline
  });

  const tables = tableNodes({ tableGroup: 'block', cellContent: 'block+', cellAttributes: {} });
  return nodes.append({
    ...tables,
    table: { ...tables.table, attrs: { align: { default: null } } }
  });
}

export const nopsNodes = buildNodes();
export const nopsMarks = (baseMarks as import('orderedmap').default<MarkSpec>).addToEnd('highlight', highlight);

export function createNopsSchema(): Schema {
  return new Schema({ nodes: nopsNodes, marks: nopsMarks });
}

export const nopsSchema: Schema = createNopsSchema();
