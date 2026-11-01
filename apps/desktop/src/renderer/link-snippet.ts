/**
 * 백링크 스니펫은 색인에서 원문 Markdown 조각으로 온다.
 * 오른쪽 도크는 읽기 표면이라 `[[ ]]`·`#`·백틱을 그대로 보여 주면 디버그 패널처럼 읽힌다.
 * 여기서는 링크의 보이는 글자만 남긴다(원문은 title 속성으로 보존한다).
 */
const ESC_OPEN = '\uE000';
const ESC_CLOSE = '\uE001';

function linkText(inner: string): string {
  const [rawTarget, rawLabel] = inner.split('|');
  if (rawLabel && rawLabel.trim()) return rawLabel.trim();
  const target = (rawTarget ?? '').trim();
  const hash = target.indexOf('#');
  // [[#제목]] 처럼 제목만 가리키면 #만 벗긴다
  if (hash === 0) return target.slice(1).trim();
  // [[노트#제목]] 은 노트 이름만 보인다
  if (hash > 0) return target.slice(0, hash);
  return target;
}

export function cleanSnippet(raw: string): string {
  // 이스케이프된 대괄호(\[ \])는 링크가 아니라 글자다. 링크를 처리하는 동안 표시를 바꿔 두었다가
  // 마지막에 대괄호로 되돌린다(백슬래시가 화면에 새지 않게).
  let s = raw.replace(/\\\[/g, ESC_OPEN).replace(/\\\]/g, ESC_CLOSE);
  // 링크를 지울 때 앞뒤 글자와 붙으면 한 단어가 된다(예: [[노트 000]][[노트 290]] → "노트 000노트 290").
  // 경계에 공백을 보장해 읽을 수 있게 한다.
  s = s.replace(/!?\[\[((?:[^\]]|\](?!\]))*)\]\]/gu, (match: string, inner: string, offset: number, whole: string) => {
    const label = linkText(inner);
    if (!label) return '';
    const prev = offset > 0 ? whole[offset - 1]! : '';
    const next = whole[offset + match.length] ?? '';
    // 인접한 링크끼리만 띄운다 — 조사(\"[[링크]]도\")는 원문대로 붙여 둔다
    const padLeft = prev === ']' ? ' ' : '';
    const padRight = next === '[' ? ' ' : '';
    return padLeft + label + padRight;
  });
  s = s.replace(/`([^`]*)`/g, '$1');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/~~([^~]+)~~/g, '$1');
  // 해시태그의 # 만 벗긴다. `# 제목` 은 # 뒤에 공백이 있어 그대로 둔다.
  s = s.replace(/(^|\s)#(?=\S)/g, '$1');
  s = s.replace(/\uE000/g, '[').replace(/\uE001/g, ']');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 검색 결과 스니펫 전용 정리.
 *
 * FTS 스니펫은 30자에서 잘려 `[[노트 172` 처럼 링크가 중간에 끊기고, 첫머리에 `# ` 가 붙는다.
 * 백링크 스니펫(cleanSnippet)은 온전한 블록이라 그대로 두고, 검색 표면에서만 얇게 덧씌운다.
 */
export function cleanSearchSnippet(raw: string): string {
  // FTS snippet() 의 매치 표시자는 본문에 없는 센티넬이다. 하이라이트는 <Marked> 가 하므로 먼저 지운다.
  let s = raw.replace(/[\uE000\uE001]/g, '');
  // 닫는 ]] 없이 끝나는 링크 조각을 먼저 지운다(닫힌 링크는 cleanSnippet 이 처리한다)
  s = s.replace(/!?\[\[[^\]]*$/u, '');
  s = s.replace(/(^|\n)[ \t]*[-*+][ \t]+/g, '$1 ');
  s = cleanSnippet(s);
  // 선행 헤딩 마커만 노이즈다(본문 중간의 # 은 건드리지 않는다)
  s = s.replace(/^#{1,6}\s+/, '');
  return s.replace(/\s+/g, ' ').trim();
}

/** 스니펫에서 강조할 말: 지금 열린 노트의 파일 이름(제목과 대개 같다) */
export function noteNameOf(path: string): string {
  return path.split('/').pop()!.replace(/\.md$/i, '');
}
