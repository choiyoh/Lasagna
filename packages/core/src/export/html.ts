import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import katex from 'katex';
import type { Html, Parent, Root, RootContent, Text } from 'mdast';
import { assetKind, parseSizeSpec } from '../assets.js';
import { splitFrontmatter } from '../markdown/frontmatter.js';
import { parseCalloutHead, parseFenceLine, parseWikiInner, slugify } from '../markdown/inline.js';

export interface HtmlExportOptions {
  /** `[[대상]]` → 링크 주소. 노트를 못 찾으면 null(밑줄 점선 글자로 남긴다) */
  resolveNote(target: string): string | null;
  /** 첨부 대상(`a.png`) → 화면에 쓸 주소(상대 경로 또는 data URI). 없으면 null */
  resolveAsset(target: string): string | null;
  /** `![[노트…]]` 임베드의 본문 HTML. 없으면 링크로 대신한다 */
  embedNote?(target: string, heading: string | null, block: string | null): string | null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const html = (value: string): Html => ({ type: 'html', value });

const TOKEN = /(!?)\[\[([^[\]\n]+?)\]\]|==([^=\n]+?)==/g;
const TRAILING_ID = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;

function math(src: string, display: boolean): string {
  try {
    return katex.renderToString(src, { displayMode: display, output: 'mathml', throwOnError: false });
  } catch {
    return `<code>${esc(src)}</code>`;
  }
}

/** 텍스트 한 덩어리를 위키링크·임베드·하이라이트가 풀린 노드들로 쪼갠다. */
function expandWikiText(value: string, opts: HtmlExportOptions): RootContent[] {
  const out: RootContent[] = [];
  let last = 0;
  for (const m of value.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: 'text', value: value.slice(last, at) });
    last = at + m[0].length;
    if (m[3] !== undefined) {
      out.push(html(`<mark>${esc(m[3])}</mark>`));
      continue;
    }
    const embed = m[1] === '!';
    const link = parseWikiInner(m[2] ?? '', embed, 0);
    const frag = link.heading ? `#${slugify(link.heading)}` : link.block ? `#blk-${link.block}` : '';
    if (embed) {
      const kind = assetKind(link.target);
      if (kind === 'note') {
        const body = opts.embedNote?.(link.target, link.heading ?? null, link.block ?? null);
        if (body) {
          out.push(html(`<div class="embed-note">${body}</div>`));
          continue;
        }
      } else {
        const src = opts.resolveAsset(link.target);
        if (!src) {
          out.push(html(`<span class="unresolved">${esc(link.target)}</span>`));
          continue;
        }
        if (kind === 'image') {
          const size = parseSizeSpec(link.alias);
          const style = size ? ` width="${size.width}"${size.height ? ` height="${size.height}"` : ''}` : '';
          out.push(html(`<img src="${esc(src)}" alt="${esc(size ? link.target : (link.alias ?? link.target))}"${style}>`));
        } else if (kind === 'audio') out.push(html(`<audio controls src="${esc(src)}"></audio>`));
        else if (kind === 'video') out.push(html(`<video controls src="${esc(src)}"></video>`));
        else out.push(html(`<a href="${esc(src)}">${esc(link.alias ?? link.target)}</a>`));
        continue;
      }
    }
    const label = link.alias ?? [link.target, link.heading ? ` › ${link.heading}` : '', link.block ? ` › ^${link.block}` : ''].join('');
    const href = link.target === '' ? '' : opts.resolveNote(link.target);
    if (href === null) out.push(html(`<span class="unresolved">${esc(label)}</span>`));
    else out.push(html(`<a class="wikilink" href="${esc(href)}${frag}">${esc(label || link.target)}</a>`));
  }
  if (last === 0) return [{ type: 'text', value }];
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

interface InlineFootnote {
  identifier: string;
  content: string;
}

/** Obsidian 인라인 각주 `^[내용]` 을 표준 각주 참조로 바꾸고, 정의는 나중에 트리 끝에 붙인다. */
function expandText(value: string, opts: HtmlExportOptions, footnotes: InlineFootnote[]): RootContent[] {
  const out: RootContent[] = [];
  const re = /(?<!\\)\^\[([^\]\n]+)\]/g;
  let last = 0;
  for (const m of value.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push(...expandWikiText(value.slice(last, at), opts));
    const identifier = `inline-${footnotes.length + 1}`;
    footnotes.push({ identifier, content: m[1] ?? '' });
    out.push({ type: 'footnoteReference', identifier, label: identifier } as RootContent);
    last = at + m[0].length;
  }
  out.push(...expandWikiText(value.slice(last), opts));
  return out;
}

function textOf(node: Parent): string {
  return node.children.map((c) => ('value' in c && typeof c.value === 'string' ? c.value : 'children' in c ? textOf(c as Parent) : '')).join('');
}

/** 트리를 제자리에서 고친다(위키링크·콜아웃·열·블록 ID·수식·하이라이트). */
function transform(node: Parent, opts: HtmlExportOptions, footnotes: InlineFootnote[]): void {
  const next: RootContent[] = [];
  for (const child of node.children as RootContent[]) {
    if (child.type === 'text') {
      next.push(...expandText((child as Text).value, opts, footnotes));
      continue;
    }
    if (child.type === 'inlineMath') {
      next.push(html(math(child.value, false)));
      continue;
    }
    if (child.type === 'math') {
      next.push(html(`<div class="math">${math(child.value, true)}</div>`));
      continue;
    }
    if (child.type === 'code' || child.type === 'inlineCode') {
      if (child.type === 'code' && child.lang === 'dbview') {
        next.push(html('<p class="placeholder">[데이터베이스 보기 — 앱에서 볼 수 있어요]</p>'));
      } else next.push(child);
      continue;
    }
    if (child.type === 'html' || child.type === 'yaml') {
      next.push(child);
      continue;
    }

    if (child.type === 'paragraph') {
      const text = textOf(child);
      const fence = parseFenceLine(text);
      if (fence && !text.includes('\n')) {
        next.push(html(fence.name ? `<div class="fence fence-${esc(fence.name)}">` : '</div>'));
        continue;
      }
      const m = TRAILING_ID.exec(text);
      if (m) {
        const last = child.children[child.children.length - 1];
        if (last?.type === 'text') {
          last.value = last.value.replace(TRAILING_ID, '');
          child.data = { ...(child.data ?? {}), hProperties: { id: `blk-${m[1]}` } };
        }
      }
    }

    if (child.type === 'heading') {
      const last = child.children[child.children.length - 1];
      let id: string | null = null;
      if (last?.type === 'text') {
        const m = TRAILING_ID.exec(last.value);
        if (m) {
          id = m[1] ?? null;
          last.value = last.value.replace(TRAILING_ID, '');
        }
        last.value = last.value.replace(/\s*\{\.toggle\}\s*$/, '');
      }
      child.data = { ...(child.data ?? {}), hProperties: { id: slugify(textOf(child)), ...(id ? { 'data-block': `blk-${id}` } : {}) } };
    }

    if (child.type === 'blockquote') {
      const first = child.children[0];
      const head = first?.type === 'paragraph' ? parseCalloutHead(textOf(first)) : undefined;
      if (head && first?.type === 'paragraph') {
        // 머리 줄을 떼고 나머지를 본문으로 남긴다
        const firstText = first.children[0];
        if (firstText?.type === 'text') {
          const nl = firstText.value.indexOf('\n');
          firstText.value = nl === -1 ? '' : firstText.value.slice(nl + 1);
          if (!firstText.value) first.children.shift();
        }
        if (first.children.length === 0) child.children.shift();
        transform(child, opts, footnotes);
        const title = esc(head.title || head.type);
        const open = head.fold
          ? `<details class="callout callout-${esc(head.type)}"${head.fold === '+' ? ' open' : ''}><summary>${title}</summary>`
          : `<div class="callout callout-${esc(head.type)}"><div class="callout-title">${title}</div>`;
        next.push(html(open), ...(child.children as RootContent[]), html(head.fold ? '</details>' : '</div>'));
        continue;
      }
    }

    if ('children' in child) {
      transform(child as Parent, opts, footnotes);
    }
    next.push(child);
  }
  node.children = next as never;
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/** 노트 본문(프런트매터 제외)을 HTML 조각으로 만든다. */
export function renderNoteBody(markdown: string, opts: HtmlExportOptions): string {
  const fm = splitFrontmatter(markdown);
  const body = fm ? markdown.slice(fm.end) : markdown;
  const tree = processor.parse(body) as Root;
  const inlineFootnotes: InlineFootnote[] = [];
  transform(tree, opts, inlineFootnotes);
  for (const fn of inlineFootnotes) {
    tree.children.push({
      type: 'footnoteDefinition',
      identifier: fn.identifier,
      label: fn.identifier,
      children: [{ type: 'paragraph', children: [{ type: 'text', value: fn.content }] }],
    } as RootContent);
  }
  const hast = unified().use(remarkRehype, { allowDangerousHtml: true }).runSync(tree);
  return unified().use(rehypeStringify, { allowDangerousHtml: true }).stringify(hast);
}

const CSS = `
:root { color-scheme: light dark; --fg: #1f2328; --bg: #fff; --muted: #656d76; --line: #d0d7de; --accent: #5b5bd6; }
@media (prefers-color-scheme: dark) { :root { --fg: #e6edf3; --bg: #0d1117; --muted: #8b949e; --line: #30363d; --accent: #8b8bd6; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.7 -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 40px 24px 80px; }
h1, h2, h3, h4 { line-height: 1.3; margin: 1.6em 0 .5em; } h1 { font-size: 2em; margin-top: 0; }
a { color: var(--accent); } a.wikilink { text-decoration: none; border-bottom: 1px solid color-mix(in srgb, var(--accent) 50%, transparent); }
.unresolved { color: var(--muted); border-bottom: 1px dotted var(--muted); }
img, video { max-width: 100%; border-radius: 6px; }
pre { background: color-mix(in srgb, var(--fg) 6%, transparent); padding: 12px 14px; border-radius: 8px; overflow: auto; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .92em; }
:not(pre) > code { background: color-mix(in srgb, var(--fg) 8%, transparent); padding: .1em .35em; border-radius: 4px; }
blockquote { margin: 1em 0; padding: .1em 1em; border-left: 3px solid var(--line); color: var(--muted); }
table { border-collapse: collapse; } th, td { border: 1px solid var(--line); padding: 6px 12px; }
mark { background: #ffe58f; color: #222; border-radius: 3px; padding: 0 .15em; }
.callout { margin: 1em 0; padding: 10px 14px; border-left: 4px solid var(--accent); border-radius: 6px; background: color-mix(in srgb, var(--accent) 9%, transparent); }
.callout-title, .callout > summary { font-weight: 600; margin-bottom: 4px; cursor: default; }
.callout-warning, .callout-caution { --accent: #d97706; } .callout-danger, .callout-error { --accent: #d1453b; } .callout-tip, .callout-success { --accent: #1f9d55; }
.fence-columns { display: flex; gap: 24px; } .fence-columns > .fence-column { flex: 1; min-width: 0; }
.embed-note { margin: 1em 0; padding: 4px 16px; border-left: 3px solid var(--accent); background: color-mix(in srgb, var(--accent) 6%, transparent); }
.placeholder { color: var(--muted); font-style: italic; }
.footnotes { margin-top: 2em; border-top: 1px solid var(--line); font-size: .9em; }
.footnotes h2 { font-size: .85em; color: var(--muted); }
.footnotes ol { padding-left: 1.5em; }
ul.contains-task-list { list-style: none; padding-left: 1.2em; }
.meta { color: var(--muted); font-size: .85em; margin-bottom: 1.5em; }
@media print { main { max-width: none; padding: 0; } a { color: inherit; } pre { white-space: pre-wrap; } }
`;

/** 스크립트를 막는 CSP 가 들어간 독립 HTML 문서. */
export function wrapHtmlDocument(opts: { title: string; body: string; /** 이미지·미디어에 data: 를 허용 */ lang?: string }): string {
  return `<!doctype html>
<html lang="${esc(opts.lang ?? 'ko')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; media-src 'self' data:; style-src 'unsafe-inline'; font-src data:">
<title>${esc(opts.title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${opts.body}
</main>
</body>
</html>
`;
}
