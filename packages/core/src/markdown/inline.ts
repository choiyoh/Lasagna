import type { ParsedLink } from './types.js';

/** `[[노트#제목|별칭]]`, `![[노트#^id]]` 안쪽 문자열(대괄호 제외)을 분해한다. */
export function parseWikiInner(
  inner: string,
  embed: boolean,
  line: number,
): ParsedLink {
  const pipe = inner.indexOf('|');
  const left = pipe === -1 ? inner : inner.slice(0, pipe);
  const alias = pipe === -1 ? undefined : inner.slice(pipe + 1);
  const hash = left.indexOf('#');
  const target = (hash === -1 ? left : left.slice(0, hash)).trim();
  const fragment = hash === -1 ? undefined : left.slice(hash + 1).trim();
  const link: ParsedLink = { kind: embed ? 'embed' : 'wikilink', target, line };
  if (fragment) {
    if (fragment.startsWith('^')) link.block = fragment.slice(1);
    else link.heading = fragment;
  }
  if (alias !== undefined && alias !== '') link.alias = alias;
  return link;
}

const WIKI = /(!?)\[\[([^[\]\n]+?)\]\]/g;

/** 텍스트에서 위키링크/임베드를 찾는다. `baseLine`은 텍스트 시작 줄. */
export function findWikiLinks(text: string, baseLine: number): ParsedLink[] {
  const out: ParsedLink[] = [];
  for (const m of text.matchAll(WIKI)) {
    const line = baseLine + countNewlines(text, m.index ?? 0);
    out.push(parseWikiInner(m[2] ?? '', m[1] === '!', line));
  }
  return out;
}

export function countNewlines(s: string, upTo: number): number {
  let n = 0;
  for (let i = 0; i < upTo; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

// 해시 앞은 문자열 시작·공백·여는 괄호여야 하고, 태그에는 숫자가 아닌 글자가 하나 이상 있어야 한다.
const TAG = /(^|[\s(])#([\p{L}\p{N}_\-/]+)/gu;

export function findTags(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TAG)) {
    const tag = (m[2] ?? '').replace(/\/+$/, '');
    if (tag && /[\p{L}_-]/u.test(tag)) out.push(tag);
  }
  return out;
}

/** GitHub 스타일에 가까운 슬러그: 소문자, 공백→-, 구두점 제거(유니코드 글자·숫자는 유지) */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

/** 문단/제목 끝의 ` ^blockid` */
const TRAILING_BLOCK_ID = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;

export function trailingBlockId(text: string): string | undefined {
  return TRAILING_BLOCK_ID.exec(text)?.[1];
}

const CALLOUT_HEAD = /^\[!([A-Za-z][\w-]*)\]([+-])?[ \t]*([^\n]*)/;

export function parseCalloutHead(firstParagraphText: string): { type: string; fold?: '+' | '-'; title: string } | undefined {
  const m = CALLOUT_HEAD.exec(firstParagraphText);
  if (!m) return undefined;
  const callout: { type: string; fold?: '+' | '-'; title: string } = {
    type: (m[1] ?? '').toLowerCase(),
    title: (m[3] ?? '').trim(),
  };
  if (m[2] === '+' || m[2] === '-') callout.fold = m[2];
  return callout;
}

const FENCE = /^(:{3,})[ \t]*([\w-]*)[ \t]*(?:\{[^}\n]*\})?[ \t]*$/;

/** 한 줄짜리 `:::name` / `:::` */
export function parseFenceLine(line: string): { name: string; colons: number } | undefined {
  const m = FENCE.exec(line.trim());
  if (!m) return undefined;
  return { name: m[2] ?? '', colons: (m[1] ?? '').length };
}
