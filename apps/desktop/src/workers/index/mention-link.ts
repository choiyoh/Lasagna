import { NO_INLINE_SCAN, maskInlineCode, parseNote, type Block } from '@nopsidian/core';

export interface LinkMentionOptions {
  /** 변환할 위치: 파일 전체 기준 1부터 시작하는 줄 번호(그 블록 안의 첫 번째 출현만 바꾼다) */
  line: number;
  /** 글자 그대로 찾을 말들(대상 노트의 제목과 별칭) */
  terms: string[];
  /** 링크 대상으로 쓸 이름(예: 파일 이름 `클린 코드`, 또는 경로 `독서/클린 코드`) */
  target: string;
}

export interface LinkMentionResult {
  content: string;
  changed: boolean;
  /** 실제로 바꾼 글자(바꾸지 않았으면 없음) */
  replaced?: string;
}

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/** 위키링크 문법으로 안전하게 쓸 수 없는 문자: 별칭 구분자·헤딩 구분자·대괄호 */
const UNSAFE_TARGET = /[|#[\]]/;

/** 위키링크·임베드·마크다운 링크 구간을 같은 길이의 공백으로 가린다(인덱서와 같은 규칙, 오프셋 보존). */
function maskLinkedSpans(src: string): string {
  const blank = (m: string) => ' '.repeat(m.length);
  return maskInlineCode(src)
    .replace(/!?\[\[[^[\]\n]*\]\]/g, blank)
    .replace(/!?\[[^[\]\n]*\]\([^()\n]*\)/g, blank);
}

/**
 * 멘션 판정 정규식: 앞은 시작이나 글자·숫자가 아닌 문자, 뒤는 끝이나 글자·숫자가 아닌 문자 또는 한글(조사).
 * 대소문자는 구분하지 않는다(`unlinkedMentions`와 같은 규칙, 첫 출현을 찾기 위해 `g`를 쓴다).
 */
function mentionRe(term: string): RegExp {
  const escaped = term.replace(REGEX_SPECIALS, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?!(?!\\p{Script=Hangul})[\\p{L}\\p{N}])`, 'giu');
}

/** 이 줄이 속한 블록(줄 범위 안에 드는 첫 블록) */
function blockAtLine(blocks: readonly Block[], line: number): Block | undefined {
  return blocks.find((b) => b.lineStart <= line && line <= b.lineEnd);
}

/**
 * 노트 본문의 한 줄에 글자 그대로 나온 대상 이름(제목·별칭)을 위키링크로 바꾼다.
 * 그 줄이 속한 블록 안의 첫 출현 하나만 바꾸고 나머지 바이트는 그대로 둔다.
 * 코드·수식·HTML 블록, 인라인 코드, 이미 링크된 구간, 위험한 대상 이름이면 바꾸지 않는다.
 */
export function linkMention(content: string, opts: LinkMentionOptions): LinkMentionResult {
  const fail: LinkMentionResult = { content, changed: false };
  const { line, target } = opts;
  if (!target || UNSAFE_TARGET.test(target)) return fail;
  const terms = opts.terms.filter((t) => t.length > 0);
  if (terms.length === 0) return fail;

  const block = blockAtLine(parseNote(content).blocks, line);
  if (!block || NO_INLINE_SCAN.has(block.kind)) return fail;

  const masked = maskLinkedSpans(block.source);
  let best: { index: number; text: string } | null = null;
  for (const term of terms) {
    const m = mentionRe(term).exec(masked);
    if (!m) continue;
    const found = { index: m.index, text: m[0] };
    // 가장 앞 출현을 쓰고, 같은 위치면 더 긴 말을 쓴다
    if (
      !best ||
      found.index < best.index ||
      (found.index === best.index && found.text.length > best.text.length)
    ) {
      best = found;
    }
  }
  if (!best) return fail;

  const alias =
    block.kind === 'table' ? `[[${target}\\|${best.text}]]` : `[[${target}|${best.text}]]`;
  const link = best.text === target ? `[[${target}]]` : alias;
  const start = block.start + best.index;
  const end = start + best.text.length;
  return {
    content: content.slice(0, start) + link + content.slice(end),
    changed: true,
    replaced: best.text,
  };
}
