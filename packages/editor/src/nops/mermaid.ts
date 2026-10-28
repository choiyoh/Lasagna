import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView, type NodeView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { SlashItemSpec } from '@oh-new-editor/core';
import { insertMarkdown } from './commands';

interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

/** mermaid 는 큰 라이브러리라, 다이어그램 블록이 처음 그려질 때만 동적으로 불러온다. */
let mermaidPromise: Promise<MermaidApi> | null = null;
let renderSeq = 0;

const theme = (): 'default' | 'dark' => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default');

async function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid')
      .then((mod) => {
        const api = (mod.default ?? (mod as unknown as { mermaid: MermaidApi }).mermaid) as MermaidApi;
        if (!api) throw new Error('mermaid 모듈을 찾지 못했어요');
        return api;
      })
      .catch((e: unknown) => {
        mermaidPromise = null; // 일시적인 로드 실패는 다음 블록에서 다시 시도한다
        throw e;
      });
  }
  return mermaidPromise;
}

async function renderMermaid(target: HTMLElement, source: string): Promise<void> {
  const api = await loadMermaid();
  api.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: theme(),
    // HTML 라벨·클릭 핸들러·외부 링크를 쓰지 않는다(strict 와 함께 이중 방어).
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    suppressErrorRendering: true,
  });
  const { svg } = await api.render(`nops-mermaid-${++renderSeq}`, source);
  target.innerHTML = svg;
}

/** ```mermaid 코드 블록: 평소에는 SVG, 커서가 들어오면 원문 코드도 보인다(수식 블록과 같은 방식). */
export function mermaidBlockView(node: PMNode, view: EditorView): NodeView {
  const dom = document.createElement('div');
  dom.className = 'nops-mermaid';
  const shown = document.createElement('div');
  shown.className = 'nops-mermaid__render';
  shown.contentEditable = 'false';
  const pre = document.createElement('pre');
  pre.setAttribute('data-mermaid-source', '');
  const code = document.createElement('code');
  pre.append(code);
  dom.append(shown, pre);

  let current = node;
  let token = 0;

  const draw = (n: PMNode) => {
    const src = n.textContent.trim();
    const mine = ++token;
    dom.classList.toggle('is-empty', !src);
    if (!src) {
      shown.textContent = 'Mermaid 다이어그램을 입력하세요';
      shown.classList.remove('is-error');
      return;
    }
    shown.textContent = '그리는 중…';
    void renderMermaid(shown, src)
      .then(() => {
        if (mine !== token || view.isDestroyed) return;
        dom.classList.remove('is-error');
      })
      .catch((e: unknown) => {
        if (mine !== token || view.isDestroyed) return;
        dom.classList.add('is-error');
        shown.textContent = e instanceof Error ? e.message.replace(/^Error: /, '') : '다이어그램을 그리지 못했어요';
      });
  };
  draw(node);

  // 테마가 바뀌면 SVG 도 다시 그린다.
  const observer = new MutationObserver(() => draw(current));
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  return {
    dom,
    contentDOM: code,
    update(n) {
      if (n.type !== node.type) return false;
      current = n;
      draw(n);
      return true;
    },
    destroy() {
      token++;
      observer.disconnect();
    },
    // SVG/상태 DOM 변경은 문서 변경이 아니다. 원문 코드 영역의 입력은 그대로 받는다.
    ignoreMutation: (m) => shown.contains(m.target) || m.type === 'attributes',
    stopEvent: (e) => shown.contains(e.target as Node),
  };
}

/** 커서가 들어 있는 mermaid 블록에 is-active 를 달아 원문 코드를 보이게 한다. */
export function createMermaidActivePlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const { $from } = state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d);
          if (n.type.name === 'code_block' && n.attrs.language === 'mermaid') {
            return DecorationSet.create(state.doc, [Decoration.node($from.before(d), $from.after(d), { class: 'is-active' })]);
          }
        }
        return null;
      },
    },
  });
}

export const mermaidSlashItem: SlashItemSpec = {
  icon: '◇',
  label: '다이어그램 (Mermaid)',
  description: 'Mermaid 다이어그램을 넣어요',
  category: 'advanced',
  keywords: ['mermaid', 'diagram', '다이어그램', '차트', '그래프', 'flowchart'],
  run: (v) => insertMarkdown(v, '```mermaid\nflowchart TD\n  A --> B\n```\n'),
};
