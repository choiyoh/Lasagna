import { splitFrontmatter } from './markdown/frontmatter.js';
import { parseTree } from './markdown/parse.js';

/** 작가 모드 글자수 — 보이는 글자만 센다(마크다운 기호·링크 주소·frontmatter 제외). */
export interface TextStats {
  /** 공백 포함 글자수(줄바꿈 제외) */
  chars: number;
  /** 공백·줄바꿈 제외 글자수 */
  charsNoSpace: number;
  /** 단어 수(공백으로 나눔, 영어 표기에 쓴다) */
  words: number;
}

const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });

/** 자소가 아니라 사용자가 보는 글자(grapheme) 수. NFC 로 정규화해 조합형·완성형 차이를 없앤다. */
export function graphemeCount(text: string): number {
  let n = 0;
  for (const segment of segmenter.segment(text.normalize('NFC'))) {
    if (segment) n += 1;
  }
  return n;
}

/** mdast 노드(위치는 body 기준) */
interface MdNode {
  type: string;
  value?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: MdNode[];
}

const rangeOf = (node: MdNode): [number, number] | null => {
  const s = node.position?.start.offset;
  const e = node.position?.end.offset;
  return typeof s === 'number' && typeof e === 'number' && e > s ? [s, e] : null;
};

/** 본문 텍스트 안의 위키링크 표식(괄호·대상)을 뺀 구간. 임베드(`![[…]]`)는 통째로 숨긴다. */
function wikiHidden(text: string, base: number): [number, number][] {
  const hidden: [number, number][] = [];
  for (const m of text.matchAll(/!\[\[[^\]]*\]\]/g)) {
    const at = base + (m.index ?? 0);
    hidden.push([at, at + m[0].length]);
  }
  for (const m of text.matchAll(/\[\[([^\]|#]*)(#[^\]|]*)?(\|([^\]]*))?\]\]/g)) {
    const at = base + (m.index ?? 0);
    if (m[4] !== undefined) {
      const aliasAt = at + m[0].indexOf('|') + 1;
      hidden.push([at, aliasAt], [aliasAt + m[4].length, at + m[0].length]);
    } else {
      hidden.push([at, at + 2], [at + m[0].length - 2, at + m[0].length]);
    }
  }
  return hidden;
}

/** 보이는 글자 마스크(1 = 보임). 표준 마크다운 구조는 mdast 파서에 맡기고, 커스텀 표식만 줄 단위로 뺀다. */
export function visibleMask(markdown: string): Uint8Array {
  const source = markdown.replace(/\r\n?/g, '\n');
  const mask = new Uint8Array(source.length); // 0 = 숨김, 1 = 보임
  const frontmatter = splitFrontmatter(source);
  const bodyOffset = frontmatter?.end ?? 0;
  const body = source.slice(bodyOffset);
  /** 코드(펜스·인라인) 내용 구간 — 줄 단위 커스텀 표식 규칙을 적용하지 않는다 */
  const codeRanges: [number, number][] = [];
  const hide = (from: number, to: number) => {
    for (let i = Math.max(0, from); i < Math.min(mask.length, to); i += 1) mask[i] = 0;
  };
  const show = (from: number, to: number) => {
    for (let i = Math.max(0, from); i < Math.min(mask.length, to); i += 1) mask[i] = 1;
  };

  if (body !== '') {
    const tree = parseTree(body) as unknown as MdNode;
    const walk = (node: MdNode): void => {
      const range = rangeOf(node);
      if (node.type === 'text' && range) {
        const [s, e] = range;
        show(bodyOffset + s, bodyOffset + e);
        for (const [h1, h2] of wikiHidden(body.slice(s, e), bodyOffset + s)) hide(h1, h2);
        return;
      }
      if (node.type === 'inlineCode' && range) {
        const raw = body.slice(range[0], range[1]);
        const ticks = /^`+/.exec(raw)?.[0].length ?? 1;
        const from = bodyOffset + range[0] + ticks;
        const to = bodyOffset + range[1] - ticks;
        show(from, to);
        codeRanges.push([from, to]);
        return;
      }
      if (node.type === 'code' && range) {
        const raw = body.slice(range[0], range[1]);
        const value = node.value ?? '';
        const at = raw.indexOf(value);
        if (at >= 0) {
          const from = bodyOffset + range[0] + at;
          const to = from + value.length;
          show(from, to);
          codeRanges.push([from, to]);
        }
        return;
      }
      // 수식·HTML·이미지·yaml·definition·thematicBreak·break 는 보이는 글자가 아니다
      if (['math', 'inlineMath', 'html', 'image', 'yaml', 'definition', 'thematicBreak', 'break'].includes(node.type)) return;
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  }

  // 줄바꿈은 단어 구분자로 남긴다(글자수에서는 countPlain 이 뺀다).
  for (let i = 0; i < source.length; i += 1) if (source[i] === '\n') mask[i] = 1;

  const inCode = (at: number) => codeRanges.some(([a, b]) => at >= a && at < b);
  // 커스텀 표식 — 줄 단위(코드 구간은 건너뛴다)
  let lineStart = 0;
  while (lineStart <= source.length) {
    const nl = source.indexOf('\n', lineStart);
    const lineEnd = nl < 0 ? source.length : nl;
    const line = source.slice(lineStart, lineEnd);
    if (!inCode(lineStart)) {
      // columns 표식은 줄 전체가 표식일 때만
      if (/^[ \t]*:{3,}[a-zA-Z-]*[ \t]*$/.test(line)) hide(lineStart, lineEnd);
      // 인용 표식(`>`)은 구조라 보이지 않는다(lazy continuation 으로 텍스트에 섞인 경우까지)
      const quote = /^[ \t]*(?:>[ \t]?)+/.exec(line);
      if (quote) hide(lineStart, lineStart + quote[0].length);
      // 콜아웃 표식은 인용 줄 맨 앞에서만(제목·내용은 보인다)
      const callout = /^[ \t]*(?:>[ \t]?)+\[![^\]]+\][ \t]?/.exec(line);
      if (callout) {
        const at = line.indexOf('[!');
        if (at >= 0) hide(lineStart + at, lineStart + callout[0].length);
      }
      // 위키링크/임베드(인라인 코드 등으로 text 노드가 쪼개져도 줄 단위로 처리)
      for (const m of line.matchAll(/!?\[\[([^\]|#]*)(#[^\]|]*)?(\|([^\]]*))?\]\]/g)) {
        const at = lineStart + (m.index ?? 0);
        if (m[0].startsWith('!')) {
          hide(at, at + m[0].length);
        } else if (m[4] !== undefined) {
          const aliasAt = at + m[0].indexOf('|') + 1;
          hide(at, aliasAt);
          hide(aliasAt + m[4].length, at + m[0].length);
        } else {
          hide(at, at + 2);
          hide(at + m[0].length - 2, at + m[0].length);
        }
      }
      // 제목 줄 끝의 {…} 속성만
      if (/^[ \t]*#{1,6}[ \t]+/.test(line)) {
        const attr = /\{[^{}]*\}[ \t]*$/.exec(line);
        if (attr) hide(lineStart + (attr.index ?? 0), lineEnd);
      }
    }
    if (nl < 0) break;
    lineStart = nl + 1;
  }
  return mask;
}

/** 보이는 글자만 이어 붙인 문자열 */
export function visibleText(markdown: string): string {
  return textFromMask(markdown, visibleMask(markdown));
}

/** 마스크를 이용해 보이는 문자열을 만든다(파싱을 다시 하지 않는다). */
function textFromMask(markdown: string, mask: Uint8Array): string {
  const source = markdown.replace(/\r\n?/g, '\n');
  const runs: string[] = [];
  let start = -1;
  for (let i = 0; i <= source.length; i += 1) {
    const visibleHere = i < source.length && mask[i] === 1;
    if (visibleHere) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      runs.push(source.slice(start, i));
      start = -1;
    }
  }
  return runs.join('');
}

/** 이미 보이는 텍스트(에디터 선택 등)의 글자수 — 마크다운 해석 없이 그대로 센다. */
export function countPlain(text: string): TextStats {
  const normalized = text.normalize('NFC');
  const chars = graphemeCount(normalized.replace(/\n/g, ''));
  const charsNoSpace = graphemeCount(normalized.replace(/\s/g, ''));
  const words = normalized.split(/\s+/).filter((w) => w !== '').length;
  return { chars, charsNoSpace, words };
}

export interface TextCounter {
  stats: TextStats;
  /** 원문의 [from,to) 구간에 보이는 글자수(선택 구간 질의) */
  range(from: number, to: number): TextStats;
}

/** 문서 하나를 한 번만 파싱해 보이는 문자열·위치 색인을 만든다. */
export function createTextCounter(markdown: string): TextCounter {
  const source = markdown.replace(/\r\n?/g, '\n');
  const mask = visibleMask(markdown);
  // 원문 위치 → 보이는 문자열 오프셋(한 번 훑는다)
  const index = new Int32Array(source.length + 1);
  const runs: string[] = [];
  let visLen = 0;
  let runStart = -1;
  for (let i = 0; i <= source.length; i += 1) {
    const visibleHere = i < source.length && mask[i] === 1;
    index[i] = visLen;
    if (visibleHere) {
      if (runStart < 0) runStart = i;
      visLen += 1;
    } else if (runStart >= 0) {
      runs.push(source.slice(runStart, i));
      runStart = -1;
    }
  }
  const visible = runs.join('');
  return {
    stats: countPlain(visible),
    range(from, to) {
      const a = index[Math.max(0, Math.min(source.length, from))] ?? 0;
      const b = index[Math.max(0, Math.min(source.length, to))] ?? 0;
      return countPlain(visible.slice(Math.min(a, b), Math.max(a, b)));
    },
  };
}

const cache = new Map<string, TextCounter>();

function counterFor(markdown: string): TextCounter {
  const hit = cache.get(markdown);
  if (hit) {
    // LRU: 히트 시 맨 뒤로
    cache.delete(markdown);
    cache.set(markdown, hit);
    return hit;
  }
  const made = createTextCounter(markdown);
  if (cache.size >= 4) cache.delete(cache.keys().next().value as string);
  cache.set(markdown, made);
  return made;
}

/** 마크다운 원문의 글자수(작가 모드 상태줄) — 같은 원문은 한 번만 계산한다. */
export function countMarkdown(markdown: string): TextStats {
  return counterFor(markdown).stats;
}

/** 마크다운 원문의 선택 구간 글자수 — 문서 마스크를 재사용한다(O(log n)). */
export function countMarkdownRange(markdown: string, from: number, to: number): TextStats {
  return counterFor(markdown).range(from, to);
}
