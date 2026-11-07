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

/** 마크다운 원문에서 **각 글자가 화면에 보이는지** 표시한 마스크. 선택 구간 계산에 쓴다. */
interface Masked {
  /** 원문과 같은 길이. true 면 보이는 글자(줄바꿈 제외) */
  keep: boolean[];
}

function emptyMask(text: string): Masked {
  return { keep: Array.from({ length: text.length }, () => true) };
}

/** 매치 구간을 보이지 않음으로 표시한다. */
function hide(mask: Masked, from: number, to: number): void {
  for (let i = Math.max(0, from); i < Math.min(mask.keep.length, to); i += 1) mask.keep[i] = false;
}

/** 정규식 매치 전체를 숨긴다(부분 숨김은 hideRange 로). */
function hideMatches(mask: Masked, source: string, re: RegExp): void {
  for (const m of source.matchAll(re)) {
    const at = m.index ?? 0;
    hide(mask, at, at + m[0].length);
  }
}

/** 한 줄의 시작/끝 위치 */
function lines(source: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  let start = 0;
  for (let i = 0; i <= source.length; i += 1) {
    if (i === source.length || source[i] === '\n') {
      out.push({ start, end: i, text: source.slice(start, i) });
      start = i + 1;
    }
  }
  return out;
}

/**
 * 보이는 글자 마스크를 만든다.
 * 숨김: frontmatter, 펜스 코드의 표식 줄, 이미지·링크의 주소, 위키링크 괄호/대상(별칭이 있으면 대상만),
 * 콜아웃·columns·toggle 표식, 수식, HTML 태그, 각주 표식, 표 구분선·파이프, 줄머리 블록 표식, 강조 기호,
 * 이스케이프 백슬래시. 코드 블록·인라인 코드 **내용**은 그대로 보이는 글자다. 줄바꿈은 항상 제외.
 */
export function visibleMask(markdown: string): Masked {
  const source = markdown.replace(/\r\n?/g, '\n');
  const mask = emptyMask(source);

  // frontmatter
  const fm = /^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(source);
  if (fm) hide(mask, 0, fm[0].length);

  // 펜스 코드: 표식 줄만 숨기고 내용은 남긴다(내용은 아래 규칙에서 보호하기 위해 구간을 기억).
  const codeRanges: { start: number; end: number }[] = [];
  const fence = /^[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm;
  for (const m of source.matchAll(fence)) {
    const at = m.index ?? 0;
    const bodyStart = at + m[0].indexOf('\n') + 1;
    const bodyEnd = at + m[0].length - m[0].split('\n').at(-1)!.length;
    codeRanges.push({ start: bodyStart, end: bodyEnd });
    hide(mask, at, bodyStart);
    hide(mask, bodyEnd, at + m[0].length);
  }
  // 인라인 코드 구간도 마크다운 해석에서 보호한다.
  const inlineRanges: { start: number; end: number }[] = [];
  for (const m of source.matchAll(/`([^`\n]*)`/g)) {
    const at = m.index ?? 0;
    inlineRanges.push({ start: at, end: at + m[0].length });
  }
  const inCode = (i: number) =>
    codeRanges.some((r) => i >= r.start && i < r.end) || inlineRanges.some((r) => i >= r.start && i < r.end);

  // 줄 단위 표식
  for (const line of lines(source)) {
    const { start, text } = line;
    // 코드 블록 안의 줄은 마크다운 규칙을 적용하지 않는다(내용 그대로).
    if (codeRanges.some((r) => start >= r.start && start < r.end)) continue;
    // columns/toggle 펜스 표식(콜론 개수 무관)
    const colonFence = /^[ \t]*:{3,}[a-zA-Z-]*[ \t]*$/.exec(text);
    if (colonFence) {
      hide(mask, start, start + text.length);
      continue;
    }
    // 표 구분선
    if (/^[ \t]*\|?[ \t:-]*-[ \t|:-]*$/.test(text) && text.includes('-')) {
      hide(mask, start, start + text.length);
      continue;
    }
    // 수평선
    if (/^[ \t]*(?:[-*_][ \t]*){3,}$/.test(text)) {
      hide(mask, start, start + text.length);
      continue;
    }
    // 줄머리 블록 표식
    const m = /^[ \t]*(?:(?:>[ \t]?)+|#{1,6}[ \t]+|(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/.exec(text);
    if (m && m[0].length > 0) {
      // 목록·인용·제목 표식만 숨긴다(들여쓰기는 그대로)
      hide(mask, start, start + m[0].length);
    }
    // 제목의 {.toggle} 같은 속성 표식
    for (const attr of text.matchAll(/\{[^{}]*\}/g)) {
      hide(mask, start + (attr.index ?? 0), start + (attr.index ?? 0) + attr[0].length);
    }
    // 콜아웃 표식
    for (const callout of text.matchAll(/\[![^\]]+\][ \t]?/g)) {
      hide(mask, start + (callout.index ?? 0), start + (callout.index ?? 0) + callout[0].length);
    }
    // 표: 파이프와 칸 정렬용 공백은 보이지 않는다(칸 사이는 한 칸으로 본다)
    if (text.includes('|')) {
      for (const pipe of text.matchAll(/\|/g)) {
        const at = start + (pipe.index ?? 0);
        hide(mask, at, at + 1);
        // 파이프 **앞** 공백을 지운다(칸 사이는 뒤 공백 한 칸으로 본다)
        for (let i = at - 1; i >= start && source[i] === ' '; i -= 1) mask.keep[i] = false;
        // 줄 맨 앞 파이프 뒤 공백은 들여쓰기일 뿐이라 지운다
        if (/^[ \t]*\|/.test(text) && at === start + (text.length - text.trimStart().length)) {
          for (let i = at + 1; i < start + text.length && source[i] === ' '; i += 1) mask.keep[i] = false;
        }
      }
      // 줄 양끝 공백
      let a = start;
      while (a < start + text.length && source[a] === ' ') mask.keep[a++] = false;
      let b = start + text.length - 1;
      while (b >= start && source[b] === ' ') mask.keep[b--] = false;
    }
  }

  // 이미지(임베드 포함) 전체
  hideMatches(mask, source, /!\[\[[^\]]*\]\]/g);
  hideMatches(mask, source, /!\[[^\]]*\]\([^)]*\)/g);
  // 위키링크: 별칭이 있으면 대상·괄호를, 없으면 괄호만 숨긴다
  for (const m of source.matchAll(/\[\[([^\]|#]*)(#[^\]|]*)?(\|([^\]]*))?\]\]/g)) {
    const at = m.index ?? 0;
    const full = m[0].length;
    if (m[4] !== undefined) {
      const aliasAt = at + m[0].indexOf('|') + 1;
      hide(mask, at, aliasAt);
      hide(mask, aliasAt + m[4].length, at + full);
    } else {
      hide(mask, at, at + 2);
      hide(mask, at + full - 2, at + full);
    }
  }
  // 마크다운 링크: 주소 부분만 숨긴다(표시 텍스트 유지)
  for (const m of source.matchAll(/\[([^\]]*)\]\(([^)]*)\)/g)) {
    const at = m.index ?? 0;
    const textEnd = at + 1 + (m[1] ?? '').length; // ']' 위치
    hide(mask, at, at + 1); // '['
    hide(mask, textEnd, at + m[0].length); // '](...)'
  }
  // 수식·HTML·각주 표식
  hideMatches(mask, source, /\$\$[\s\S]*?\$\$/g);
  hideMatches(mask, source, /\$[^$\n]+\$/g);
  hideMatches(mask, source, /<!--[\s\S]*?-->/g);
  hideMatches(mask, source, /<[^>]+>/g);
  hideMatches(mask, source, /\[\^[^\]]*\]:?/g);
  // 인라인 코드: 내용은 보이는 글자(표식만 숨긴다)
  for (const m of source.matchAll(/`([^`\n]*)`/g)) {
    const at = m.index ?? 0;
    hide(mask, at, at + 1);
    hide(mask, at + m[0].length - 1, at + m[0].length);
  }
  // 강조·취소선 표식(코드 안은 건드리지 않는다)
  for (let i = 0; i < source.length; i += 1) {
    if (!mask.keep[i] || inCode(i)) continue;
    const ch = source[i]!;
    if (ch === '*' || ch === '_' || ch === '~') {
      // 강조 기호는 보이지 않는다(코드 안 제외)
      mask.keep[i] = false;
    } else if (ch === '\\' && i + 1 < source.length) {
      mask.keep[i] = false; // 이스케이프한 기호는 기호만 보인다
    }
  }
  // 줄바꿈은 글자수에서 빠지지만(단어 구분자로는 남는다) 마스크에서는 보이는 글자로 둔다.
  return mask;
}

/** 보이는 글자만 이어 붙인 문자열 */
export function visibleText(markdown: string): string {
  const source = markdown.replace(/\r\n?/g, '\n');
  const { keep } = visibleMask(markdown);
  let out = '';
  for (let i = 0; i < source.length; i += 1) if (keep[i]) out += source[i];
  return out;
}

/** 이미 보이는 텍스트(에디터 선택 등)의 글자수 — 마크다운 해석 없이 그대로 센다. */
export function countPlain(text: string): TextStats {
  const normalized = text.normalize('NFC');
  const chars = graphemeCount(normalized.replace(/\n/g, ''));
  const charsNoSpace = graphemeCount(normalized.replace(/\s/g, ''));
  const words = normalized.split(/\s+/).filter((w) => w !== '').length;
  return { chars, charsNoSpace, words };
}

/** 마크다운 원문의 글자수(작가 모드 상태줄) */
export function countMarkdown(markdown: string): TextStats {
  return countPlain(visibleText(markdown));
}

/**
 * 마크다운 원문의 **선택 구간**(소스 모드) 글자수 — 문서 전체와 같은 마스크를 써서
 * 링크 주소·이미지 경로·표식이 선택에 들어와도 세지 않는다(항상 선택 ≤ 전체).
 */
export function countMarkdownRange(markdown: string, from: number, to: number): TextStats {
  const source = markdown.replace(/\r\n?/g, '\n');
  const { keep } = visibleMask(markdown);
  let chars = '';
  for (let i = Math.max(0, from); i < Math.min(source.length, to); i += 1) if (keep[i]) chars += source[i];
  return countPlain(chars);
}
