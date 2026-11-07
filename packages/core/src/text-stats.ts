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
 * - 코드 블록·인라인 코드는 마크다운 해석 없이 내용 그대로 센다(계획: 코드 포함)
 * - 이미지(`![]()`, `![[…]]`)는 경로/대체텍스트를 세지 않는다
 * - 링크는 표시 텍스트만(`[text](url)` → text, `[[target|alias]]` → alias, `[[target]]` → target)
 * - 콜아웃 표식(`> [!note]`)은 보이지 않으므로 빼고 제목·내용만 센다
 * - 수식(`$…$`, `$$…$$`)은 렌더된 모양이 아니라 원문이라 글자수에서 제외한다
 */
export function visibleText(markdown: string): string {
  let s = bodyOf(markdown.replace(/\r\n?/g, '\n'));
  /** 코드 내용은 마크다운 규칙에서 보호한다(나중에 그대로 되돌린다). */
  const kept: string[] = [];
  const protect = (text: string) => `\uE000${kept.push(text) - 1}\uE000`;
  // 펜스 코드: 표식 줄은 지우고 내용은 원문 그대로 보호
  s = s.replace(/^[ \t]*(```|~~~)[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm, (_m, _fence, body: string) => protect(body));
  // 인라인 코드도 원문 그대로
  s = s.replace(/`([^`\n]*)`/g, (_m, code: string) => protect(code));
  // 수식은 제외(원문 LaTeX 을 글자로 세지 않는다)
  s = s.replace(/\$\$[\s\S]*?\$\$/g, '');
  s = s.replace(/\$[^$\n]+\$/g, '');
  // 이미지(임베드 포함)는 0글자
  s = s.replace(/!\[\[[^\]]*\]\]/g, '');
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // 위키링크: 별칭이 있으면 별칭, 없으면 대상
  s = s.replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?\|([^\]]*)\]\]/g, '$2');
  s = s.replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?\]\]/g, '$1');
  // 마크다운 링크: 표시 텍스트만
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // 콜아웃 표식은 보이지 않는다 — 같은 줄의 제목/내용만 남긴다
  s = s.replace(/^[ \t]*(?:>[ \t]?)*\[![^\]]+\][ \t]?/gm, '');
  // HTML 태그·주석
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<[^>]+>/g, '');
  // 각주 정의 표식은 빼고 본문은 센다
  s = s.replace(/\[\^[^\]]*\]:/g, '');
  s = s.replace(/\[\^[^\]]*\]/g, '');
  // 표: 칸 사이만 띄우고 칸 안쪽 정렬용 공백은 보이지 않으므로 하나로 접는다
  s = s.replace(/^.*\|.*$/gm, (line) => line.replace(/\|/g, ' ').replace(/[ \t]{2,}/g, ' ').trim());
  s = s.replace(/^[ \t]*\|?[ \t:-]*-[ \t|:-]*$/gm, '');
  // 줄머리 블록 표식(제목·인용·목록·체크박스·구분선)
  s = s.replace(/^[ \t]*(?:>[ \t]?)+/gm, '');
  s = s.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  s = s.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '');
  s = s.replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, '');
  // 강조·취소선 표식(인라인 코드는 위에서 보호됨)
  s = s.replace(/(\*\*|__|~~|\*|_)/g, '');
  // 이스케이프된 기호는 글자로
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1');
  // 보호해 둔 코드 내용을 그대로 되돌린다
  // 보호 표식은 NUL 대신 사설 영역 문자를 쓴다(정규식 제어문자 경고 회피).
  return s.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => kept[Number(i)] ?? '');
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
