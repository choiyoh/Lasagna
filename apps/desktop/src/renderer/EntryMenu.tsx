import { t } from '@nopsidian/i18n';
import { useEffect } from 'react';

export interface EntryMenuState {
  /** 항목 경로('' = 사이드바의 빈 곳) */
  path: string;
  isFolder: boolean;
  x: number;
  y: number;
  /** 여러 개를 고른 상태에서 연 메뉴 */
  multi?: boolean;
}

interface Props {
  menu: EntryMenuState;
  bookmarked: boolean;
  pickedCount: number;
  onClose: () => void;
  onOpenInNewTab: (path: string) => void;
  onNewNote: (folder: string) => void;
  onNewFolder: (parent: string) => void;
  onRename: (path: string, isFolder: boolean) => void;
  onToggleBookmark: (path: string) => void;
  onDelete: (path: string, isFolder: boolean) => void;
  onDeletePicked: () => void;
  onClearPicked: () => void;
}

/** 사이드바 항목(또는 빈 곳)을 우클릭했을 때의 메뉴 */
export function EntryMenu(p: Props) {
  const { menu } = p;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      p.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p.onClose]);
  /** 메뉴를 닫고 동작을 실행한다 */
  const run = (fn: () => void) => () => {
    p.onClose();
    fn();
  };
  return (
    <div className="ctxmask" onMouseDown={p.onClose} onContextMenu={(e) => (e.preventDefault(), p.onClose())}>
      <div
        className="ctxmenu"
        role="menu"
        style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 140) }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {menu.multi ? (
          <>
            <button role="menuitem" className="danger" onClick={run(p.onDeletePicked)}>
              {t('entry.deleteCount', { count: p.pickedCount })}
            </button>
            <button role="menuitem" onClick={run(p.onClearPicked)}>
              {t('entry.clearSelection')}
            </button>
          </>
        ) : (
          <>
            {!menu.isFolder && (
              <button role="menuitem" onClick={run(() => p.onOpenInNewTab(menu.path))}>
                {t('entry.openNewTab')}
              </button>
            )}
            {menu.isFolder && menu.path !== '' && (
              <>
                <button role="menuitem" onClick={run(() => p.onNewNote(menu.path))}>
                  {t('entry.newNoteHere')}
                </button>
                <button role="menuitem" onClick={run(() => p.onNewFolder(menu.path))}>
                  {t('entry.newSubfolder')}
                </button>
              </>
            )}
            {menu.path === '' && (
              <>
                <button role="menuitem" onClick={run(() => p.onNewNote(''))}>
                  {t('entry.newNote')}
                </button>
                <button role="menuitem" onClick={run(() => p.onNewFolder(''))}>
                  {t('entry.newFolder')}
                </button>
              </>
            )}
            {menu.path !== '' && (
              <button role="menuitem" onClick={run(() => p.onRename(menu.path, menu.isFolder))}>
                {t('entry.rename')}
              </button>
            )}
            {!menu.isFolder && (
              <button role="menuitem" onClick={run(() => p.onToggleBookmark(menu.path))}>
                {p.bookmarked ? t('app.bookmarkRemove') : t('nav.marks')}
              </button>
            )}
            {menu.path !== '' && (
              <button role="menuitem" className="danger" onClick={run(() => p.onDelete(menu.path, menu.isFolder))}>
                {t('common.delete')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
