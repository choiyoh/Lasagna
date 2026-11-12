/**
 * 작품 폴더 이름 바꾸기에서 목표 키를 옮길지 판정한다.
 * 작품은 볼트 루트 바로 아래 폴더로 인식되므로(WorkRoot), 루트 폴더 이름만 바꾸는 경우에만 옮긴다.
 * 노트(.md)·하위 폴더 이동은 작품 키(폴더 이름)에 영향이 없다.
 */
export function workGoalKeyForRename(from: string, to: string): { from: string; to: string } | null {
  const a = from.replace(/\/+$/, '');
  const b = to.replace(/\/+$/, '');
  if (!a || !b || a === b) return null;
  if (a.includes('/') || b.includes('/')) return null;
  if (/\.md$/i.test(a) || /\.md$/i.test(b)) return null;
  return { from: a, to: b };
}
