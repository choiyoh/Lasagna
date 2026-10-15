/** 사이드바 손 정렬 순서: 폴더 경로('' = 맨 위) → 그 폴더 안 항목 이름(노트는 `.md` 포함) 순서 */
export type SidebarOrder = Record<string, string[]>;

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/**
 * `names` 를 저장된 순서대로 정렬한다. 순서에 없는 이름(새로 생긴 항목)은 원래 순서 그대로 뒤에 붙는다.
 * 순서가 없으면 그대로 돌려준다.
 */
export function sortByOrder<T>(items: T[], nameOf: (t: T) => string, order: string[] | undefined): T[] {
  if (!order || order.length === 0) return items;
  const rank = new Map(order.map((n, i) => [n, i] as const));
  const listed: T[] = [];
  const rest: T[] = [];
  for (const it of items) (rank.has(nameOf(it)) ? listed : rest).push(it);
  listed.sort((a, b) => rank.get(nameOf(a))! - rank.get(nameOf(b))!);
  return [...listed, ...rest];
}

/**
 * `moved` 를 `target` 의 앞/뒤로 옮긴 새 이름 순서. `current` 는 지금 화면에 보이는 형제 이름 순서(`moved` 가 없어도 된다).
 * `target` 이 없으면(이미 사라졌으면) 맨 뒤.
 */
export function placeInOrder(current: string[], moved: string, target: string, pos: 'before' | 'after'): string[] {
  const list = current.filter((n) => n !== moved);
  const at = list.indexOf(target);
  if (at < 0) return [...list, moved];
  list.splice(pos === 'before' ? at : at + 1, 0, moved);
  return list;
}

/**
 * 이름 바꾸기·이동에 맞춰 순서를 고친다. `from`/`to` 는 볼트 상대 경로.
 *  - 같은 폴더 안에서 이름만 바뀌면 그 자리의 이름을 바꾼다.
 *  - 다른 폴더로 가면 옛 폴더의 순서에서는 빼고(새 폴더에서는 맨 뒤에 붙는다).
 *  - 폴더 경로가 바뀌면 그 폴더(와 하위 폴더)의 순서 키도 따라간다.
 */
export function remapOrder(order: SidebarOrder, from: string, to: string): SidebarOrder {
  const out: SidebarOrder = {};
  const prefix = `${from}/`;
  for (const [k, list] of Object.entries(order)) {
    const key = k === from ? to : k.startsWith(prefix) ? `${to}${k.slice(from.length)}` : k;
    out[key] = list;
  }
  const oldDir = dirOf(from);
  const list = out[oldDir];
  if (list?.includes(baseOf(from))) {
    out[oldDir] = dirOf(to) === oldDir ? list.map((n) => (n === baseOf(from) ? baseOf(to) : n)) : list.filter((n) => n !== baseOf(from));
  }
  return out;
}
