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


/**
 * 원문을 **구간**으로 나눈다: 숨김(frontmatter·표식), 코드(내용 그대로 보이는 글자), 본문(마크다운 규칙 적용).
 * 코드 구간에는 어떤 마크다운 규칙도 적용하지 않는다(규칙들이 서로의 범위를 침범하지 않게 하는 기본 구조).
 */
type SegKind = 'hidden' | 'code' | 'body';

interface Segment {
  kind: SegKind;
  start: number;
  end: number;
}

/** 한 줄의 위치 정보 */
interface Line {
  start: number;
  end: number; // 개행 제외 끝
  text: string;
}

function splitLines(source: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (let i = 0; i <= source.length; i += 1) {
    if (i === source.length || source[i] === '\n') {
      out.push({ start, end: i, text: source.slice(start, i) });
      start = i + 1;
    }
  }
  return out;
}

/** 펜스 코드 블록: 표식 줄은 숨김, 내용은 코드 구간(그대로 보이는 글자). */
function fenceSegments(source: string, lines: Line[]): { segments: Segment[]; inFence: boolean[] } {
  const segments: Segment[] = [];
  const inFence: boolean[] = lines.map(() => false);
  let open: { char: string; length: number } | null = null;
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const trimmed = line.text.trimStart();
    if (!open) {
      const m = /^(`{3,}|~{3,})/.exec(trimmed);
      if (m) {
        open = { char: m[1]![0]!, length: m[1]!.length };
        segments.push({ kind: 'hidden', start: line.start, end: line.end });
        bodyStart = Math.min(source.length, line.end + 1);
        inFence[i] = true;
      }
      continue;
    }
    inFence[i] = true;
    const m = new RegExp(`^\\${open.char}{${open.length},}\\s*$`).exec(trimmed);
    if (m) {
      if (bodyStart < line.start) segments.push({ kind: 'code', start: bodyStart, end: line.start - 1 });
      segments.push({ kind: 'hidden', start: line.start, end: line.end });
      open = null;
    }
  }
  if (open) {
    // 닫히지 않은 펜스는 끝까지 코드 내용
    if (bodyStart < source.length) segments.push({ kind: 'code', start: bodyStart, end: source.length });
  }
  return { segments, inFence };
}

/** 마크다운 원문을 숨김/코드/본문 구간으로 분해한다. */
function segmentsOf(markdown: string): { source: string; segments: Segment[]; inFence: boolean[]; lines: Line[] } {
  const source = markdown.replace(/\r\n?/g, '\n');
  const lines = splitLines(source);
  const segments: Segment[] = [];

  // frontmatter 는 통째로 숨김
  const fm = /^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(source);
  let bodyFrom = 0;
  if (fm) {
    const end = fm[0].length;
    segments.push({ kind: 'hidden', start: 0, end });
    bodyFrom = end;
  }

  // 펜스 코드
  const fence = fenceSegments(source, lines);
  segments.push(...fence.segments);

  // 나머지는 본문(위 구간에 포함되지 않은 곳만)
  const covered = (start: number) => segments.some((s) => start >= s.start && start < s.end);
  let runStart: number | null = null;
  for (let i = bodyFrom; i <= source.length; i += 1) {
    const isCovered = i < source.length && covered(i);
    if (!isCovered && runStart === null) runStart = i;
    if (isCovered && runStart !== null) {
      segments.push({ kind: 'body', start: runStart, end: i });
      runStart = null;
    }
  }
  if (runStart !== null) segments.push({ kind: 'body', start: runStart, end: source.length });

  // 인라인 코드는 본문 안에서 코드 구간으로 쪼갠다(내용 그대로).
  const inline: Segment[] = [];
  const bodySegs = segments.filter((s) => s.kind === 'body');
  const others = segments.filter((s) => s.kind !== 'body');
  for (const seg of bodySegs) {
    const text = source.slice(seg.start, seg.end);
    let cursor = 0;
    for (const m of text.matchAll(/`([^`\n]*)`/g)) {
      const at = seg.start + (m.index ?? 0);
      if (at > seg.start + cursor) inline.push({ kind: 'body', start: seg.start + cursor, end: at });
      inline.push({ kind: 'hidden', start: at, end: at + 1 });
      inline.push({ kind: 'code', start: at + 1, end: at + m[0].length - 1 });
      inline.push({ kind: 'hidden', start: at + m[0].length - 1, end: at + m[0].length });
      cursor = (m.index ?? 0) + m[0].length;
    }
    if (seg.start + cursor < seg.end) inline.push({ kind: 'body', start: seg.start + cursor, end: seg.end });
  }
  const all = [...others, ...inline].sort((a, b) => a.start - b.start);
  return { source, segments: all, inFence: fence.inFence, lines };
}

/** 본문 구간에만 적용하는 숨김 규칙. 각 규칙은 자기 범위(줄·위치)에서만 동작한다. */
function markBody(source: string, mask: Uint8Array, seg: Segment, lines: Line[]): void {
  const hide = (from: number, to: number) => {
    for (let i = Math.max(seg.start, from); i < Math.min(seg.end, to); i += 1) mask[i] = 0;
  };
  const text = source.slice(seg.start, seg.end);

  // 블록 단위(줄) 규칙 — 이 구간에 걸친 줄만 본다
  for (const line of lines) {
    if (line.end <= seg.start || line.start >= seg.end) continue;
    const t = line.text;
    // 줄 전체가 ::: 표식일 때만(콜론 개수 무관)
    if (/^[ \t]*:{3,}[a-zA-Z-]*[ \t]*$/.test(t)) {
      hide(line.start, line.end);
      continue;
    }
    // 표 구분선
    if (t.includes('-') && /^[ \t]*\|?[ \t:-]*-[ \t|:-]*$/.test(t)) {
      hide(line.start, line.end);
      continue;
    }
    // 수평선
    if (/^[ \t]*(?:[-*_][ \t]*){3,}$/.test(t)) {
      hide(line.start, line.end);
      continue;
    }
    // 줄머리 표식(인용·제목·목록·체크박스)
    const lead = /^[ \t]*(?:(?:>[ \t]?)+|#{1,6}[ \t]+|(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)/.exec(t);
    if (lead) hide(line.start, line.start + lead[0].length);
    // 콜아웃 표식은 인용 블록 첫 줄 맨 앞에서만
    const callout = /^[ \t]*>[ \t]*\[![^\]]+\][ \t]?/.exec(t);
    if (callout) hide(line.start + callout[0].length - 1 - (/\[![^\]]+\][ \t]?/.exec(callout[0])?.[0].length ?? 0), line.start + callout[0].length);
    // 제목 줄 끝의 {…} 속성(예: {.toggle})만
    if (/^[ \t]*#{1,6}[ \t]+/.test(t)) {
      const attr = /\{[^{}]*\}[ \t]*$/.exec(t);
      if (attr) hide(line.start + (attr.index ?? 0), line.end);
    }
    // 표 파이프: 파이프와 그 앞 공백을 숨기고, 줄 맨 앞 파이프 뒤 공백도 숨긴다(칸 사이는 한 칸)
    if (t.includes('|')) {
      const firstNonSpace = line.start + (t.length - t.trimStart().length);
      for (const pipe of t.matchAll(/\|/g)) {
        const at = line.start + (pipe.index ?? 0);
        hide(at, at + 1);
        for (let i = at - 1; i >= line.start && source[i] === ' '; i -= 1) hide(i, i + 1);
        if (at === firstNonSpace) {
          for (let i = at + 1; i < line.end && source[i] === ' '; i += 1) hide(i, i + 1);
        }
      }
      let a = line.start;
      while (a < line.end && source[a] === ' ') hide(a++, a);
      let b = line.end - 1;
      while (b >= line.start && source[b] === ' ') hide(b--, b + 1);
    }
  }

  // 인라인 규칙(본문 구간 안에서만)
  const inSeg = (i: number) => i >= seg.start && i < seg.end;
  const hideMatches = (re: RegExp) => {
    for (const m of text.matchAll(re)) {
      const at = seg.start + (m.index ?? 0);
      if (inSeg(at)) hide(at, at + m[0].length);
    }
  };
  // 이미지(임베드 포함)는 통째로 숨김
  hideMatches(/!\[\[[^\]]*\]\]/g);
  hideMatches(/!\[[^\]]*\]\([^)]*\)/g);
  // 위키링크: 별칭이 있으면 대상·괄호를, 없으면 괄호만
  for (const m of text.matchAll(/\[\[([^\]|#]*)(#[^\]|]*)?(\|([^\]]*))?\]\]/g)) {
    const at = seg.start + (m.index ?? 0);
    if (m[4] !== undefined) {
      const aliasAt = at + m[0].indexOf('|') + 1;
      hide(at, aliasAt);
      hide(aliasAt + m[4].length, at + m[0].length);
    } else {
      hide(at, at + 2);
      hide(at + m[0].length - 2, at + m[0].length);
    }
  }
  // 마크다운 링크: 표시 텍스트만 남기고 괄호·주소를 숨긴다
  for (const m of text.matchAll(/\[([^\]]*)\]\(([^)]*)\)/g)) {
    const at = seg.start + (m.index ?? 0);
    const textEnd = at + 1 + (m[1] ?? '').length;
    hide(at, at + 1);
    hide(textEnd, at + m[0].length);
  }
  // 수식·HTML·각주 표식
  hideMatches(/\$\$[\s\S]*?\$\$/g);
  hideMatches(/\$[^$\n]+\$/g);
  hideMatches(/<!--[\s\S]*?-->/g);
  hideMatches(/<[^>]+>/g);
  hideMatches(/\[\^[^\]]*\]:?/g);
  // 강조·취소선 표식과 이스케이프 백슬래시(본문 구간에서만)
  for (let i = seg.start; i < seg.end; i += 1) {
    const ch = source[i]!;
    if (ch === '*' || ch === '_' || ch === '~' || ch === '\\') mask[i] = 0;
  }
}

/** 보이는 글자 마스크(1 = 보임) */
export function visibleMask(markdown: string): Uint8Array {
  const { source, segments, lines } = segmentsOf(markdown);
  const mask = new Uint8Array(source.length).fill(1);
  for (const seg of segments) {
    if (seg.kind === 'hidden') {
      for (let i = seg.start; i < seg.end; i += 1) mask[i] = 0;
    } else if (seg.kind === 'body') {
      markBody(source, mask, seg, lines);
    }
    // code 구간은 그대로 1 (어떤 규칙도 적용하지 않는다)
  }
  return mask;
}

/** 보이는 글자만 이어 붙인 문자열 */
export function visibleText(markdown: string): string {
  const source = markdown.replace(/\r\n?/g, '\n');
  const mask = visibleMask(markdown);
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

/** 문서 하나를 한 번만 훑어 보이는 문자열과 위치 색인을 만든다. */
export function createTextCounter(markdown: string): TextCounter {
  const source = markdown.replace(/\r\n?/g, '\n');
  const mask = visibleMask(markdown);
  // 원문 위치 → 보이는 문자열에서의 오프셋(한 번 훑고, 문자열은 구간 slice 로 만든다)
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
      const a = index[Math.max(0, Math.min(source.length, from))]!;
      const b = index[Math.max(0, Math.min(source.length, to))]!;
      return countPlain(visible.slice(Math.min(a, b), Math.max(a, b)));
    },
  };
}

const cache = new Map<string, TextCounter>();

/** 마크다운 원문의 글자수(작가 모드 상태줄) — 같은 원문은 한 번만 계산한다. */
export function countMarkdown(markdown: string): TextStats {
  return counterFor(markdown).stats;
}

/** 마크다운 원문의 선택 구간 글자수 — 문서 마스크를 재사용한다. */
export function countMarkdownRange(markdown: string, from: number, to: number): TextStats {
  return counterFor(markdown).range(from, to);
}

function counterFor(markdown: string): TextCounter {
  const hit = cache.get(markdown);
  if (hit) return hit;
  const made = createTextCounter(markdown);
  if (cache.size >= 4) cache.delete(cache.keys().next().value as string);
  cache.set(markdown, made);
  return made;
}
