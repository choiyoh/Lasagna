import { visibleColumns, type DbData, type View } from './types';

/** 열 머리 메뉴의 정렬: 그 열을 맨 앞 정렬 기준으로(dir null = 해제). 손으로 정한 행 순서는 버린다. */
export function sortedView(view: View, prop: string, dir: 'asc' | 'desc' | null): View {
  const rest = view.sort.filter((r) => r.prop !== prop);
  return { ...view, sort: dir ? [{ prop, dir }, ...rest] : rest, manualOrder: undefined };
}

/** 열 숨기기(제목 열은 못 숨긴다) */
export function hiddenColumnView(data: DbData, view: View, prop: string): View {
  return { ...view, columns: visibleColumns({ ...data, view }).filter((c) => c !== prop) };
}

/** `from` 열을 `to` 열 앞으로 옮긴 열 순서. 제목 열은 항상 맨 앞. */
export function movedColumns(cols: string[], from: string, to: string): string[] {
  if (from === to || from === 'title') return cols;
  const rest = cols.filter((c) => c !== from);
  const at = to === 'title' ? 1 : rest.indexOf(to);
  rest.splice(at < 0 ? rest.length : at, 0, from);
  return rest;
}

/** `from` 행을 `to` 행 앞으로 옮긴 경로 순서 */
export function movedRows(paths: string[], from: string, to: string): string[] {
  if (from === to) return paths;
  const rest = paths.filter((p) => p !== from);
  const at = rest.indexOf(to);
  rest.splice(at < 0 ? rest.length : at, 0, from);
  return rest;
}
