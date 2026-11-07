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
  // 세그먼트를 세기만 하므로 항목 값은 쓰지 않는다
  for (const segment of segmenter.segment(text.normalize('NFC'))) {
    if (segment) n += 1;
  }
  return n;
}

/** frontmatter(`---` 블록)를 떼어 낸 본문 */
function bodyOf(markdown: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
  return m ? markdown.slice(m[0].length) : markdown;
}

/**
 * 마크다운 원문에서 **화면에 보이는 글자**만 뽑는다.
 * - 이미지(`![]()`, `![[…]]`)는 경로/대체텍스트를 세지 않는다
 * - 링크는 표시 텍스트만(`[text](url)` → text, `[[target|alias]]` → alias, `[[target]]` → target)
 * - 코드 블록·인라인 코드 내용은 포함(작가는 거의 쓰지 않으므로 단순화)
 */
export function visibleText(markdown: string): string {
  let s = bodyOf(markdown.replace(/\r\n?/g, '\n'));
  // 코드 펜스 표시줄은 지우고 내용은 남긴다
  s = s.replace(/^[ \t]*(```|~~~)[^\n]*$/gm, '');
  // 이미지(임베드 포함)는 0글자
  s = s.replace(/!\[\[[^\]]*\]\]/g, '');
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // 위키링크: 별칭이 있으면 별칭, 없으면 대상
  s = s.replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?\|([^\]]*)\]\]/g, '$2');
  s = s.replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?\]\]/g, '$1');
  // 마크다운 링크: 표시 텍스트만
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // HTML 태그·주석
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<[^>]+>/g, '');
  // 각주 정의 표식
  s = s.replace(/\[\^[^\]]*\]:/g, '');
  s = s.replace(/\[\^[^\]]*\]/g, '');
  // 표 구분선·파이프
  s = s.replace(/^[ \t]*\|?[ \t:-]*-[ \t|:-]*$/gm, '');
  // 표는 칸 사이만 띄우고 칸 안쪽 정렬용 공백은 보이지 않으므로 하나로 접는다
  s = s.replace(/^.*\|.*$/gm, (line) => line.replace(/\|/g, ' ').replace(/[ \t]{2,}/g, ' ').trim());
  // 줄머리 블록 표식(제목·인용·목록·체크박스·구분선)
  s = s.replace(/^[ \t]*(?:>[ \t]?)+/gm, '');
  s = s.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  s = s.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '');
  s = s.replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, '');
  // 강조·취소선·인라인 코드 표식
  s = s.replace(/(\*\*|__|~~|`+|\*|_)/g, '');
  // 이스케이프된 기호는 글자로
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1');
  return s;
}

/** 이미 보이는 텍스트(에디터에서 뽑은 것)의 글자수 */
export function countVisible(text: string): TextStats {
  const normalized = text.normalize('NFC');
  const chars = graphemeCount(normalized.replace(/\n/g, ''));
  const charsNoSpace = graphemeCount(normalized.replace(/\s/g, ''));
  const words = normalized.split(/\s+/).filter((w) => w !== '').length;
  return { chars, charsNoSpace, words };
}

/** 마크다운 원문의 글자수(작가 모드 상태줄) */
export function countMarkdown(markdown: string): TextStats {
  return countVisible(visibleText(markdown));
}
