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
  s = s.replace(/!\[\[([^\]]*)\]\]/g, (_m, inner: string) => linkText(inner));
  s = s.replace(/\[\[([^\]]*)\]\]/g, (_m, inner: string) => linkText(inner));
  s = s.replace(/`([^`]*)`/g, '$1');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/~~([^~]+)~~/g, '$1');
  // 해시태그의 # 만 벗긴다. `# 제목` 은 # 뒤에 공백이 있어 그대로 둔다.
  s = s.replace(/(^|\s)#(?=\S)/g, '$1');
  s = s.replace(/\uE000/g, '[').replace(/\uE001/g, ']');
  return s.replace(/\s+/g, ' ').trim();
}

/** 스니펫에서 강조할 말: 지금 열린 노트의 파일 이름(제목과 대개 같다) */
export function noteNameOf(path: string): string {
  return path.split('/').pop()!.replace(/\.md$/i, '');
}
