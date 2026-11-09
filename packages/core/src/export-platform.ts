import { splitFrontmatter } from './markdown/frontmatter.js';

/**
 * 플랫폼 붙여넣기용 텍스트 — frontmatter 와 **첫 H1(제목)을 빼고**, 마크다운 기호를 걷어 낸다.
 * 링크는 표시 글자만, 이미지는 대체 텍스트, 표는 탭 구분, 코드 블록은 내용만, 빈 줄은 한 줄로.
 */
export function platformText(markdown: string): string {
  const fm = splitFrontmatter(markdown);
  let body = fm ? markdown.slice(fm.end) : markdown;
  body = body.replace(/\r\n/g, '\n');

  const lines = body.split('\n');
  const out: string[] = [];
  let titled = false;
  let inFence = false;
  let fence: string[] = [];
  /** 표 블록 안에서 몇 번째 줄인지(헤더=1, 구분행=2). */
  let tableLine = 0;

  const inline = (text: string): string =>
    text
      .replace(/!\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target)
      .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/(^|[^\w])\*([^*\n]+)\*(?!\w)/g, '$1$2')
      .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1$2')
      .replace(/~~([^~]+)~~/g, '$1');

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fence = [];
      } else {
        inFence = false;
        out.push(...fence);
        fence = [];
      }
      continue;
    }
    if (inFence) {
      fence.push(line);
      continue;
    }
    // 첫 H1(제목)만 제외한다(플랫폼 제목 칸에 따로 넣는다).
    if (!titled && /^#\s+/.test(line)) {
      titled = true;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      tableLine += 1;
      const rawCells = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      // GFM 구분행은 대시 1개부터 인정하지만, **헤더 바로 다음 줄**에서만 구분행으로 본다.
      // (본문 데이터 행의 셀 값이 우연히 '-' 인 경우를 지우지 않기 위해)
      if (tableLine === 2 && rawCells.every((c) => /^:?-+:?$/.test(c))) continue;
      out.push(rawCells.map((c) => inline(c)).join('\t'));
      continue;
    }
    tableLine = 0;
    const stripped = line.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*>\s?/, '').replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');
    out.push(inline(stripped));
  }
  if (inFence) out.push(...fence);

  const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text;
}
