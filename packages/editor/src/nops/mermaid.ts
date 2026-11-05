import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView, type NodeView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { SlashItemSpec } from '@oh-new-editor/core';
import DOMPurify from 'dompurify';
import { t } from '@nopsidian/i18n';
import { lazySlashItem } from './slash-item';
import { insertMarkdown } from './commands';
import { isEffectiveDark } from './theme';

interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

/** mermaid 는 큰 라이브러리라, 다이어그램 블록이 처음 그려질 때만 동적으로 불러온다. */
let mermaidPromise: Promise<MermaidApi> | null = null;
let renderSeq = 0;
/** 마지막으로 초기화한 Mermaid 테마. 테마가 바뀔 때만 initialize 한다. */
let initializedTheme: 'default' | 'dark' | null = null;

type Purifier = { sanitize(dirty: string, config?: Record<string, unknown>): string };
const purify: Purifier = (DOMPurify as unknown as { sanitize?: unknown }).sanitize
  ? (DOMPurify as unknown as Purifier)
  : (DOMPurify as unknown as (w: Window) => Purifier)(window);

/** Mermaid 가 만든 SVG 를 SVG 프로필로 한 번 더 정화한다(심층 방어). */
export function sanitizeSvg(svg: string): string {
  return purify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    ADD_ATTR: ['style'],
    FORBID_TAGS: ['foreignObject'],
  });
}

const theme = (): 'default' | 'dark' => (isEffectiveDark() ? 'dark' : 'default');

async function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid')
      .then((mod) => {
        const api = (mod.default ?? (mod as unknown as { mermaid: MermaidApi }).mermaid) as MermaidApi;
        if (!api) throw new Error(t('editor.mermaid.missingModule'));
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
  const currentTheme = theme();
  if (initializedTheme !== currentTheme) {
    api.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: currentTheme,
      // HTML 라벨·클릭 핸들러·외부 링크를 쓰지 않는다(strict 와 함께 이중 방어).
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      suppressErrorRendering: true,
    });
    initializedTheme = currentTheme;
  }
  const { svg } = await api.render(`nops-mermaid-${++renderSeq}`, source);
  target.innerHTML = sanitizeSvg(svg);
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
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSource = '';
  const DEBOUNCE_MS = 300;

  const renderNow = (src: string) => {
    lastSource = src;
    const mine = token;
    shown.textContent = t('editor.mermaid.rendering');
    void renderMermaid(shown, src)
      .then(() => {
        if (mine !== token || view.isDestroyed) return;
        dom.classList.remove('is-error');
      })
      .catch((e: unknown) => {
        if (mine !== token || view.isDestroyed) return;
        dom.classList.add('is-error');
        shown.textContent = e instanceof Error ? e.message.replace(/^Error: /, '') : t('editor.mermaid.error');
      });
  };

  const draw = (n: PMNode, immediate = false) => {
    current = n;
    const src = n.textContent.trim();
    dom.classList.toggle('is-empty', !src);
    if (!src) {
      token++;
      if (timer) clearTimeout(timer);
      timer = null;
      lastSource = '';
      shown.textContent = t('editor.mermaid.placeholder');
      shown.classList.remove('is-error');
      return;
    }
    // 선택만 바뀌는 등 원문이 그대로면 진행 중인 렌더를 취소하지 않는다.
    if (!immediate && src === lastSource) return;
    token++;
    if (timer) clearTimeout(timer);
    if (immediate) {
      timer = null;
      renderNow(src);
      return;
    }
    // 입력 중에는 매 글자마다 그리지 않고, 300ms 조용해진 뒤 한 번만 그린다.
    timer = setTimeout(() => {
      timer = null;
      if (!view.isDestroyed) renderNow(src);
    }, DEBOUNCE_MS);
  };
  draw(node, true);

  // 테마가 바뀌면 SVG 도 즉시 다시 그린다.
  const observer = new MutationObserver(() => draw(current, true));
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  // 앱 테마가 '시스템'일 때 OS 다크/라이트 전환은 data-theme 속성이 바뀌지 않는다.
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const onScheme = () => draw(current, true);
  media?.addEventListener('change', onScheme);

  return {
    dom,
    contentDOM: code,
    update(n) {
      if (n.type !== node.type) return false;
      draw(n);
      return true;
    },
    destroy() {
      token++;
      if (timer) clearTimeout(timer);
      observer.disconnect();
      media?.removeEventListener('change', onScheme);
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

export const mermaidSlashItem = (): SlashItemSpec =>
  lazySlashItem(
    { icon: '◇', category: 'advanced', keywords: ['mermaid', 'diagram', '다이어그램', '차트', '그래프', 'flowchart'], run: (v) => insertMarkdown(v, '```mermaid\nflowchart TD\n  A --> B\n```\n') },
    'editor.mermaid.label',
    'editor.mermaid.desc',
  );
