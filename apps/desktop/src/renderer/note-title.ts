import { t as tr } from '@nopsidian/i18n';

/** 노트 제목(첫 H1) ↔ 파일 이름 동기화 도우미 */

/** 방금 만든 노트: 처음 열 때 제목에 커서를 둔다 */
export const freshNotes = new Set<string>();
/** 제목 동기화로 이름이 바뀐 노트: 새 경로로 다시 열 때 커서를 되살린다 */
export const carrySelection = new Map<string, { anchor: number; head: number }>();

/** 날짜 이름(오늘의 노트)은 제목을 바꿔도 파일 이름을 따라 바꾸지 않는다 */
const DAILY_NAME = /^\d{4}-\d{2}-\d{2}$/;

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
const baseOf = (p: string) => p.slice(dirOf(p).length).replace(/\.md$/i, '');

/** 제목을 파일 이름으로 쓸 수 있게 다듬는다(경로·링크 문법에 쓰이는 글자는 공백으로) */
export function safeName(title: string): string {
  return title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120).trim();
}

/** 이 노트를 제목에 맞춰 이름을 바꿔도 되는가: 처음 열었을 때 제목과 파일 이름이 같았거나(또는 제목이 비었거나) */
export function titleInSync(path: string, title: string | null): boolean {
  if (title === null) return false;
  const base = baseOf(path);
  if (DAILY_NAME.test(base)) return false;
  const t = safeName(title);
  return t === '' || t === base;
}

/** 제목에 맞춘 새 경로. 바꿀 필요가 없으면 null */
export function titleRenameTarget(path: string, title: string): string | null {
  const t = safeName(title);
  if (!t || t === baseOf(path)) return null;
  return `${dirOf(path)}${t}.md`;
}

/** 같은 폴더에서 겹치지 않는 "제목 없음" 경로 */
export function untitledPath(folder: string, existing: Iterable<string>): string {
  const taken = new Set([...existing].map((p) => p.toLowerCase()));
  const dir = folder ? `${folder}/` : '';
  let name = tr('default.untitled');
  for (let n = 2; taken.has(`${dir}${name}.md`.toLowerCase()); n++) name = tr('default.untitledN', { n });
  return `${dir}${name}.md`;
}
