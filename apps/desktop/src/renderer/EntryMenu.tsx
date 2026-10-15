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
              {p.pickedCount}개 삭제
            </button>
            <button role="menuitem" onClick={run(p.onClearPicked)}>
              선택 해제
            </button>
          </>
        ) : (
          <>
            {!menu.isFolder && (
              <button role="menuitem" onClick={run(() => p.onOpenInNewTab(menu.path))}>
                새 탭에서 열기
              </button>
            )}
            {menu.isFolder && menu.path !== '' && (
              <>
                <button role="menuitem" onClick={run(() => p.onNewNote(menu.path))}>
                  여기에 새 노트
                </button>
                <button role="menuitem" onClick={run(() => p.onNewFolder(menu.path))}>
                  새 하위 폴더
                </button>
              </>
            )}
            {menu.path === '' && (
              <>
                <button role="menuitem" onClick={run(() => p.onNewNote(''))}>
                  새 노트
                </button>
                <button role="menuitem" onClick={run(() => p.onNewFolder(''))}>
                  새 폴더
                </button>
              </>
            )}
            {menu.path !== '' && (
              <button role="menuitem" onClick={run(() => p.onRename(menu.path, menu.isFolder))}>
                이름 바꾸기
              </button>
            )}
            {!menu.isFolder && (
              <button role="menuitem" onClick={run(() => p.onToggleBookmark(menu.path))}>
                {p.bookmarked ? '북마크 해제' : '북마크'}
              </button>
            )}
            {menu.path !== '' && (
              <button role="menuitem" className="danger" onClick={run(() => p.onDelete(menu.path, menu.isFolder))}>
                삭제
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
