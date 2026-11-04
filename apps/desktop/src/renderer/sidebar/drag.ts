import { tPlural } from '@nopsidian/i18n';
import type React from 'react';
import type { Entry } from './selection';
export const DRAG_TYPE = 'application/x-nops-entry';

/** 지금 끌고 있는 항목(끌기 중에는 데이터를 읽을 수 없어서 따로 기억한다) */
let dragging: Entry[] | null = null;
const DROP_CLASSES = ['drop-before', 'drop-after', 'drop-into', 'drop'];
export const clearDropMarks = () => document.querySelectorAll(DROP_CLASSES.map((c) => `.${c}`).join(',')).forEach((el) => el.classList.remove(...DROP_CLASSES));

/** 끌기 데이터에서 항목 목록을 읽는다(한 개도 목록으로 온다). 잘못된 데이터면 null */
function parseItems(raw: string): Entry[] | null {
  try {
    const d = JSON.parse(raw) as { items?: Entry[]; path?: string; isFolder?: boolean };
    const list = d.items ?? (typeof d.path === 'string' ? [{ path: d.path, isFolder: !!d.isFolder }] : []);
    return list.length ? list : null;
  } catch {
    return null;
  }
}

/** 끌기 시작: 여러 항목이면 "N개 항목" 표시를 끌고 다닌다 */
export function startDrag(e: React.DragEvent, items: Entry[]) {
  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ items }));
  e.dataTransfer.effectAllowed = 'move';
  dragging = items;
  if (items.length > 1 && typeof e.dataTransfer.setDragImage === 'function') {
    const badge = document.createElement('div');
    badge.className = 'dragbadge';
    badge.textContent = tPlural('tree.dragCount', items.length);
    document.body.append(badge);
    e.dataTransfer.setDragImage(badge, 12, 12);
    setTimeout(() => badge.remove(), 0);
  }
}
export function endDrag() {
  dragging = null;
  clearDropMarks();
}

export type DropZone = 'before' | 'after' | 'into';

/**
 * 사이드바 항목 위에서 놓을 자리: 노트는 위쪽 절반 = 앞, 아래쪽 절반 = 뒤.
 * 폴더는 위쪽 가장자리 = 앞, 아래쪽 가장자리(접힌 폴더만) = 뒤, 가운데 = 폴더 안으로.
 */
function zoneFor(e: React.DragEvent, isFolder: boolean, open: boolean): DropZone {
  const r = e.currentTarget.getBoundingClientRect();
  const y = r.height > 0 ? (e.clientY - r.top) / r.height : 0.5;
  if (!isFolder) return y < 0.5 ? 'before' : 'after';
  if (y < 0.28) return 'before';
  if (y > 0.72 && !open) return 'after';
  return 'into';
}

/**
 * 노션처럼 사이드바 항목에 끌어 놓기. 놓을 자리에 선(앞/뒤)이나 강조(폴더 안)를 보여 주고,
 * 놓으면 `onDropAt` 으로 알린다. 자기 자신·자기 하위 폴더 위에서는 놓을 수 없다.
 */
export function entryDropProps(path: string, isFolder: boolean, open: boolean, onDropAt: (items: Entry[], zone: DropZone) => void) {
  const has = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes(DRAG_TYPE);
  const blocked = () => !!dragging && dragging.some((d) => d.path === path || (d.isFolder && path.startsWith(`${d.path}/`)));
  const mark = (e: React.DragEvent, zone: DropZone) => {
    const li = e.currentTarget.closest('li');
    clearDropMarks();
    if (zone === 'into') e.currentTarget.classList.add('drop');
    else li?.classList.add(`drop-${zone}`);
  };
  return {
    onDragOver: (e: React.DragEvent) => {
      if (!has(e) || blocked()) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      mark(e, zoneFor(e, isFolder, open));
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
      e.currentTarget.classList.remove('drop');
      e.currentTarget.closest('li')?.classList.remove('drop-before', 'drop-after');
    },
    onDrop: (e: React.DragEvent) => {
      const raw = e.dataTransfer.getData(DRAG_TYPE);
      const zone = zoneFor(e, isFolder, open);
      clearDropMarks();
      if (!raw || blocked()) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = null;
      const items = parseItems(raw);
      if (items) onDropAt(items, zone);
    },
  };
}

/** 폴더(또는 맨 위 빈 곳)에 놓을 수 있게 하는 이벤트 묶음. 놓을 수 있는 동안 `drop` 클래스를 단다. */
export function dropProps(onDropEntry: (items: Entry[]) => void, onDropFiles?: (paths: string[]) => void) {
  const has = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes(DRAG_TYPE);
  const hasFiles = (e: React.DragEvent) => !!onDropFiles && Array.from(e.dataTransfer.types).includes('Files');
  return {
    onDragOver: (e: React.DragEvent) => {
      if (!has(e) && !hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = has(e) ? 'move' : 'copy';
      e.currentTarget.classList.add('drop');
    },
    onDragLeave: (e: React.DragEvent) => e.currentTarget.classList.remove('drop'),
    onDrop: (e: React.DragEvent) => {
      e.currentTarget.classList.remove('drop');
      const raw = e.dataTransfer.getData(DRAG_TYPE);
      if (!raw) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const paths = Array.from(e.dataTransfer.files).map((f) => window.nops.pathForFile(f)).filter(Boolean);
        if (paths.length) onDropFiles?.(paths);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      dragging = null;
      const items = parseItems(raw);
      if (items) onDropEntry(items);
    },
  };
}

