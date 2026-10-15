import type { NoteSummary } from '@nopsidian/ipc-contract';
import { sortByOrder, type SidebarOrder } from '../sidebar-order';

export interface TreeNode {
  name: string;
  path: string;
  note?: NoteSummary;
  children: TreeNode[];
}

export function buildTree(notes: NoteSummary[], folders: string[] = [], order: SidebarOrder = {}): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] };
  // 빈 폴더도 나무에 넣는다(노트가 있는 폴더는 아래에서 다시 만나도 그대로 쓴다)
  for (const f of folders) {
    let cur = root;
    const parts = f.split('/');
    parts.forEach((part, i) => {
      const p = parts.slice(0, i + 1).join('/');
      let child = cur.children.find((c) => c.path === p && !c.note);
      if (!child) {
        child = { name: part, path: p, children: [] };
        cur.children.push(child);
      }
      cur = child;
    });
  }
  for (const n of notes) {
    let cur = root;
    const parts = n.path.split('/');
    parts.forEach((part, i) => {
      const p = parts.slice(0, i + 1).join('/');
      let child = cur.children.find((c) => c.path === p);
      if (!child) {
        child = { name: part, path: p, children: [] };
        cur.children.push(child);
      }
      if (i === parts.length - 1) child.note = n;
      cur = child;
    });
  }
  const sort = (nodes: TreeNode[], parent: string): TreeNode[] => {
    nodes.sort((a, b) => Number(!!a.note) - Number(!!b.note) || a.name.localeCompare(b.name, 'ko'));
    // 손으로 정한 순서가 있으면 그 순서가 먼저, 없는(새) 항목은 기본 순서로 뒤에 붙는다
    const sorted = sortByOrder(nodes, (n) => n.name, order[parent]);
    sorted.forEach((n) => (n.children = sort(n.children, n.path)));
    return sorted;
  };
  return sort(root.children, '');
}
