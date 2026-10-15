import type React from 'react';
import { endDrag, entryDropProps, startDrag } from './drag';
import type { TreeNode } from './build-tree';
import type { Entry } from './selection';

/** 사이드바 나무가 부모(App)와 주고받는 것 */
export interface TreeCtx {
  /** 폴더 펼침 상태(접힌 폴더는 안을 그리지 않는다) */
  folderOpen: { isOpen: (folder: string) => boolean; setOpen: (folder: string, open: boolean) => void };
  /** 지금 열려 있는 노트 */
  selected: string | null;
  /** 여러 개 선택한 항목과 키보드가 가리키는 항목 */
  picked: ReadonlySet<string>;
  cursor: string | null;
  onOpen: (path: string, newTab?: boolean) => void;
  /** 항목 클릭. true 면 선택만 바꾼 것(⇧/⌘/Ctrl)이라 열지 않는다 */
  onItemClick: (path: string, e: React.MouseEvent) => boolean;
  onRenameFolder: (folder: string) => void;
  onMenu: (path: string, isFolder: boolean, x: number, y: number) => void;
  /** 이 항목을 끌 때 함께 끌려갈 항목들(선택에 들어 있으면 선택 전체) */
  dragItems: (path: string, isFolder: boolean) => Entry[];
  /** 끌어서 놓기: 항목들을 toFolder(빈 문자열 = 볼트 맨 위) 안으로 */
  onMove: (items: Entry[], toFolder: string) => void;
  /** 끌어서 놓기: 항목들을 target 의 앞/뒤로(같은 폴더면 순서만 바뀐다) */
  onReorder: (items: Entry[], target: string, pos: 'before' | 'after') => void;
}

export function TreeView({ nodes, ctx, depth = 0 }: { nodes: TreeNode[]; ctx: TreeCtx; depth?: number }) {
  const { folderOpen, selected, picked, cursor } = ctx;
  const state = (path: string) => `${picked.has(path) ? ' picked' : ''}${cursor === path ? ' cursor' : ''}`;
  return (
    <ul className="tree">
      {nodes.map((n) => (
        <li key={n.path} style={{ '--d': depth } as React.CSSProperties}>
          {n.note ? (
            <button
              className={`${n.path === selected ? 'row active' : 'row'}${state(n.path)}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              data-path={n.path}
              aria-selected={picked.has(n.path) || undefined}
              onClick={(e) => {
                if (ctx.onItemClick(n.path, e)) return;
                ctx.onOpen(n.path);
              }}
              onAuxClick={(e) => {
                // 가운데 버튼: 새 탭에서 열기
                if (e.button === 1) {
                  e.preventDefault();
                  ctx.onOpen(n.path, true);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                ctx.onMenu(n.path, false, e.clientX, e.clientY);
              }}
              draggable
              onDragStart={(e) => startDrag(e, ctx.dragItems(n.path, false))}
              onDragEnd={endDrag}
              {...entryDropProps(n.path, false, false, (items, zone) => ctx.onReorder(items, n.path, zone === 'after' ? 'after' : 'before'))}
            >
              {n.note.icon ? <span className="emoji">{n.note.icon}</span> : null}
              {n.note.title}
            </button>
          ) : (
            <details open={folderOpen.isOpen(n.path)} onToggle={(e) => folderOpen.setOpen(n.path, e.currentTarget.open)}>
              <summary
                className={state(n.path).trim()}
                style={{ paddingLeft: 8 + depth * 14 }}
                data-path={n.path}
                aria-selected={picked.has(n.path) || undefined}
                onClick={(e) => {
                  // ⇧/⌘/Ctrl 클릭은 선택만 바꾸고 폴더를 접고 펴지 않는다
                  if (ctx.onItemClick(n.path, e)) e.preventDefault();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  ctx.onMenu(n.path, true, e.clientX, e.clientY);
                }}
                draggable
                onDragStart={(e) => startDrag(e, ctx.dragItems(n.path, true))}
                onDragEnd={endDrag}
                {...entryDropProps(n.path, true, folderOpen.isOpen(n.path), (items, zone) =>
                  zone === 'into' ? ctx.onMove(items, n.path) : ctx.onReorder(items, n.path, zone),
                )}
              >
                <span>{n.name}</span>
                <button
                  className="treerename"
                  title="폴더 이름 변경/이동"
                  aria-label={`${n.name} 폴더 이름 변경`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    ctx.onRenameFolder(n.path);
                  }}
                >
                  ✎
                </button>
              </summary>
              {folderOpen.isOpen(n.path) && <TreeView nodes={n.children} ctx={ctx} depth={depth + 1} />}
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
