import { Plugin, PluginKey } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { HighlighterCore, ThemedToken } from 'shiki/core';

/**
 * 코드 블록 구문 강조. Shiki(JavaScript 정규식 엔진 — WASM 불필요)로 토큰을 만들어 장식(decoration)으로 입힌다.
 * 문서에는 아무 것도 쓰이지 않으며, 언어 문법은 필요할 때 한 번만 불러온다.
 * 색은 `--shiki-light` / `--shiki-dark` 변수로 내보내고 CSS가 라이트·다크를 고른다.
 */

const LANGS: Record<string, () => Promise<unknown>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  latex: () => import('shiki/langs/latex.mjs'),
};

const ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  py: 'python',
  yml: 'yaml',
  md: 'markdown',
  rs: 'rust',
  golang: 'go',
  'c++': 'cpp',
  cc: 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  kt: 'kotlin',
  rb: 'ruby',
  docker: 'dockerfile',
  svg: 'xml',
  tex: 'latex',
};

export function normalizeLanguage(language: string | null | undefined): string | null {
  const key = (language ?? '').trim().toLowerCase();
  const name = ALIASES[key] ?? key;
  return name in LANGS ? name : null;
}

const MAX_CODE_LENGTH = 30_000;
const THEMES = { light: 'github-light', dark: 'github-dark' } as const;

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('shiki/themes/github-light.mjs'),
      import('shiki/themes/github-dark.mjs'),
    ]);
    return createHighlighterCore({ themes: [light.default, dark.default], langs: [], engine: createJavaScriptRegexEngine() });
  })();
  return highlighterPromise;
}

/** 코드를 토큰으로 나눈다. 언어를 모르면 null. */
export async function tokenize(code: string, language: string | null | undefined): Promise<ThemedToken[][] | null> {
  const name = normalizeLanguage(language);
  if (!name || code.length > MAX_CODE_LENGTH) return null;
  const hl = await getHighlighter();
  if (!loadedLangs.has(name)) {
    const mod = (await LANGS[name]!()) as { default: Parameters<HighlighterCore['loadLanguage']>[0] };
    await hl.loadLanguage(mod.default);
    loadedLangs.add(name);
  }
  return hl.codeToTokens(code, { lang: name, themes: THEMES, defaultColor: false }).tokens;
}

const key = new PluginKey<DecorationSet>('nopsCodeHighlight');
const CACHE_LIMIT = 300;

function decorationsFor(node: PMNode, pos: number, lines: ThemedToken[][]): Decoration[] {
  const out: Decoration[] = [];
  const start = pos + 1;
  const textLength = node.content.size;
  for (const line of lines) {
    for (const token of line) {
      const from = start + token.offset;
      const to = from + token.content.length;
      if (token.content.trim() === '' || to > start + textLength) continue;
      const style = Object.entries(token.htmlStyle ?? {})
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
      out.push(Decoration.inline(from, to, { class: 'nops-tok', style }));
    }
  }
  return out;
}

export function createCodeHighlightPlugin(): Plugin {
  const cache = new Map<string, ThemedToken[][]>();
  const cacheKey = (lang: string, code: string) => `${lang}\0${code}`;

  return new Plugin<DecorationSet>({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const next = tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
        const meta = tr.getMeta(key) as { doc: PMNode; decos: Map<number, Decoration[]> } | undefined;
        if (!meta || meta.doc !== tr.doc) return next;
        let result = next;
        for (const [pos, decos] of meta.decos) {
          const node = tr.doc.nodeAt(pos);
          if (!node) continue;
          result = result.remove(result.find(pos + 1, pos + node.nodeSize - 1));
          result = result.add(tr.doc, decos);
        }
        return result;
      },
    },
    props: {
      decorations: (state) => key.getState(state),
    },
    view(view) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let alive = true;
      let lastDoc: PMNode | null = null;

      const run = async () => {
        const doc = view.state.doc;
        const blocks: { pos: number; node: PMNode; lang: string }[] = [];
        doc.descendants((node, pos) => {
          if (node.type.name === 'code_block') {
            const lang = normalizeLanguage(node.attrs.language);
            if (lang && node.content.size > 0) blocks.push({ pos, node, lang });
            return false;
          }
          return true;
        });
        const decos = new Map<number, Decoration[]>();
        for (const b of blocks) {
          const code = b.node.textContent;
          const k = cacheKey(b.lang, code);
          let lines = cache.get(k);
          if (!lines) {
            try {
              lines = (await tokenize(code, b.lang)) ?? undefined;
            } catch {
              lines = undefined; // 문법을 불러오지 못하면 강조 없이 둔다
            }
            if (!lines) continue;
            if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
            cache.set(k, lines);
          }
          decos.set(b.pos, decorationsFor(b.node, b.pos, lines));
          if (!alive) return;
        }
        if (!alive || view.isDestroyed) return;
        // 계산하는 사이 문서가 바뀌었으면 결과를 버리고 다시 계산한다
        if (view.state.doc !== doc) return schedule();
        if (decos.size > 0) view.dispatch(view.state.tr.setMeta(key, { doc, decos }).setMeta('addToHistory', false));
      };

      const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(() => void run(), 120);
      };

      schedule();
      return {
        update(v) {
          if (v.state.doc !== lastDoc) {
            lastDoc = v.state.doc;
            schedule();
          }
        },
        destroy() {
          alive = false;
          clearTimeout(timer);
        },
      };
    },
  });
}
