import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TreeNode } from './build-tree';

export interface Entry {
  path: string;
  isFolder: boolean;
}
export interface VisibleItem extends Entry {
  depth: number;
  /** 상위 폴더 경로('' = 맨 위) */
  parent: string;
}

/** 화면에 보이는 순서(접힌 폴더의 안쪽은 빠진다)로 펼친 목록 */
export function flattenVisible(
  nodes: TreeNode[],
  isOpen: (folder: string) => boolean,
  limitOf: (folder: string) => number = () => Infinity,
  depth = 0,
  parent = '',
): VisibleItem[] {
  const out: VisibleItem[] = [];
  // 한 폴더에서는 `limitOf` 개까지만 그린다(나머지는 "더 보기")
  for (const n of nodes.slice(0, limitOf(parent))) {
    const isFolder = !n.note;
    out.push({ path: n.path, isFolder, depth, parent });
    if (isFolder && isOpen(n.path)) out.push(...flattenVisible(n.children, isOpen, limitOf, depth + 1, n.path));
  }
  return out;
}

/** `a` 부터 `b` 까지(양끝 포함, 순서 무관)의 항목 */
export function rangeBetween(list: VisibleItem[], a: string, b: string): VisibleItem[] {
  const i = list.findIndex((v) => v.path === a);
  const j = list.findIndex((v) => v.path === b);
  if (i < 0 || j < 0) return j < 0 ? [] : [list[j]!];
  const [lo, hi] = i < j ? [i, j] : [j, i];
  return list.slice(lo, hi + 1);
}

/** 선택한 폴더 안에 이미 들어 있는 항목은 뺀다(폴더를 옮기면 안의 것도 같이 가므로) */
export function topLevel(items: Entry[]): Entry[] {
  const folders = items.filter((i) => i.isFolder).map((i) => `${i.path}/`);
  return items.filter((i) => !folders.some((f) => i.path.startsWith(f)));
}

export interface SelectionActions {
  isOpen: (folder: string) => boolean;
  setOpen: (folder: string, open: boolean) => void;
  /** 선택한(없으면 키보드가 가리키는) 항목 삭제 */
  remove: (items: Entry[]) => void;
  /** 키보드가 가리키는 항목 이름 바꾸기 */
  rename: (item: Entry) => void;
}

const itemEl = (path: string) => document.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`);

/**
 * 사이드바 항목 선택: 클릭(⇧ 범위, ⌘/Ctrl 토글)·키보드 이동·여러 개 선택.
 * `picked` 는 여러 개 선택(강조 표시)이고, 일반 클릭은 선택을 비우고 노트를 연다.
 */
export function useTreeSelection(visible: VisibleItem[]) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const byPath = useMemo(() => new Map(visible.map((v) => [v.path, v] as const)), [visible]);

  // 사라진 항목(삭제·이동)은 선택에서 뺀다
  useEffect(() => {
    setPicked((cur) => {
      const next = new Set([...cur].filter((p) => byPath.has(p)));
      return next.size === cur.size ? cur : next;
    });
  }, [byPath]);

  const clear = useCallback(() => setPicked((cur) => (cur.size ? new Set() : cur)), []);

  /** 선택된 항목(화면 순서). 선택이 없으면 `fallback` 하나 */
  const entries = useCallback(
    (fallback?: string | null): Entry[] => {
      const list = visible.filter((v) => picked.has(v.path)).map(({ path, isFolder }) => ({ path, isFolder }));
      if (list.length) return list;
      const f = fallback ? byPath.get(fallback) : undefined;
      return f ? [{ path: f.path, isFolder: f.isFolder }] : [];
    },
    [visible, picked, byPath],
  );

  /** 항목을 눌렀을 때. ⇧/⌘/Ctrl 이면 선택만 바꾸고 true(= 열지 않음), 아니면 선택을 비우고 false. */
  const click = useCallback(
    (path: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): boolean => {
      if (e.shiftKey && anchor.current) {
        setPicked(new Set(rangeBetween(visible, anchor.current, path).map((v) => v.path)));
        setCursor(path);
        return true;
      }
      if (e.metaKey || e.ctrlKey || e.shiftKey) {
        setPicked((cur) => {
          const next = new Set(cur);
          // 처음 ⌘ 클릭이면 이미 열려 있던 쪽(커서)도 함께 선택한다
          if (!next.size && cursor && cursor !== path) next.add(cursor);
          if (next.has(path)) next.delete(path);
          else next.add(path);
          return next;
        });
        anchor.current = path;
        setCursor(path);
        return true;
      }
      setPicked((cur) => (cur.size ? new Set() : cur));
      anchor.current = path;
      setCursor(path);
      return false;
    },
    [visible, cursor],
  );

  /** 우클릭: 이미 선택에 들어 있으면 그대로, 아니면 그 항목만 선택(강조 없이 커서만) */
  const contextOn = useCallback(
    (path: string): boolean => {
      if (picked.has(path) && picked.size > 1) return true;
      setPicked((cur) => (cur.size ? new Set() : cur));
      anchor.current = path;
      setCursor(path);
      return false;
    },
    [picked],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, actions: SelectionActions) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-path]');
      if (!el || (e.target as HTMLElement).closest('input, textarea')) return;
      const path = el.dataset.path!;
      const idx = visible.findIndex((v) => v.path === path);
      if (idx < 0) return;
      const item = visible[idx]!;
      const mod = e.metaKey || e.ctrlKey;
      const go = (next: VisibleItem | undefined, extend: boolean) => {
        if (!next) return;
        e.preventDefault();
        if (extend) {
          const a = anchor.current ?? path;
          anchor.current = a;
          setPicked(new Set(rangeBetween(visible, a, next.path).map((v) => v.path)));
        } else {
          anchor.current = next.path;
          setPicked((cur) => (cur.size ? new Set() : cur));
        }
        setCursor(next.path);
        itemEl(next.path)?.focus();
      };
      switch (e.key) {
        case 'ArrowDown':
          return go(visible[idx + 1], e.shiftKey);
        case 'ArrowUp':
          return go(visible[idx - 1], e.shiftKey);
        case 'Home':
          return go(visible[0], e.shiftKey);
        case 'End':
          return go(visible[visible.length - 1], e.shiftKey);
        case 'ArrowRight':
          if (!item.isFolder) return;
          e.preventDefault();
          if (!actions.isOpen(item.path)) actions.setOpen(item.path, true);
          else go(visible[idx + 1]?.parent === item.path ? visible[idx + 1] : undefined, false);
          return;
        case 'ArrowLeft':
          if (item.isFolder && actions.isOpen(item.path)) {
            e.preventDefault();
            actions.setOpen(item.path, false);
          } else if (item.parent) go(byPath.get(item.parent), false);
          return;
        case 'Delete':
        case 'Backspace': {
          e.preventDefault();
          const list = picked.has(path) ? entries(path) : [{ path, isFolder: item.isFolder }];
          if (list.length) actions.remove(list);
          return;
        }
        case 'F2':
          e.preventDefault();
          e.stopPropagation();
          actions.rename({ path, isFolder: item.isFolder });
          return;
        case 'Escape':
          if (picked.size) {
            e.preventDefault();
            setPicked(new Set());
          }
          return;
        case 'a':
        case 'A':
          if (!mod) return;
          e.preventDefault();
          setPicked(new Set(visible.map((v) => v.path)));
          return;
      }
    },
    [visible, byPath, picked, entries],
  );

  return { picked, cursor, click, contextOn, clear, entries, onKeyDown };
}
