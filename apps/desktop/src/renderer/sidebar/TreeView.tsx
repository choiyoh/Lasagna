import { t } from '@nopsidian/i18n';
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
  /** 이 폴더(''=맨 위)에서 지금 보여 줄 항목 수와 "더 보기" */
  limitOf: (folder: string) => number;
  /** 작가 모드 회차 행 글자수 배지(없으면 그리지 않는다) */
  badgeOf?: (path: string) => string | undefined;
  showMore: (folder: string) => void;
}

export function TreeView({ nodes: all, ctx, depth = 0, parent = '' }: { nodes: TreeNode[]; ctx: TreeCtx; depth?: number; parent?: string }) {
  const { folderOpen, selected, picked, cursor } = ctx;
  // 항목이 아주 많으면 처음 몇백 개만 그린다. 지금 열린 노트·키보드 커서는 항상 보이게 한다.
  const need = Math.max(all.findIndex((n) => n.path === selected), all.findIndex((n) => n.path === cursor)) + 1;
  const shown = Math.max(ctx.limitOf(parent), need);
  const nodes = all.length > shown ? all.slice(0, shown) : all;
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
              {ctx.badgeOf?.(n.path) ? (
                <span className="tree__badge" data-testid="tree-badge">
                  {ctx.badgeOf(n.path)}
                </span>
              ) : null}
            </button>
          ) : (
            <details
              open={folderOpen.isOpen(n.path)}
              onToggle={(e) => {
                // 처음 그릴 때 `open` 속성 때문에도 toggle 이 오므로, 화면 상태와 다를 때(= 사용자가 눌렀을 때)만 기억한다.
                // 안 그러면 노트를 불러오는 도중에 열려 있던 폴더가 "사용자가 연 것"으로 저장돼 큰 볼트에서도 전부 펼쳐진다.
                if (e.currentTarget.open !== folderOpen.isOpen(n.path)) folderOpen.setOpen(n.path, e.currentTarget.open);
              }}
            >
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
                  title={t('tree.renameFolderTitle')}
                  aria-label={t('tree.renameFolderAria', { name: n.name })}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    ctx.onRenameFolder(n.path);
                  }}
                >
                  ✎
                </button>
              </summary>
              {folderOpen.isOpen(n.path) && <TreeView nodes={n.children} ctx={ctx} depth={depth + 1} parent={n.path} />}
            </details>
          )}
        </li>
      ))}
      {all.length > nodes.length && (
        <li className="tree__more" style={{ paddingLeft: 8 + depth * 14 }}>
          <button onClick={() => ctx.showMore(parent)} data-testid="tree-more">
            {t('tree.more', { count: all.length - nodes.length })}
          </button>
        </li>
      )}
    </ul>
  );
}
