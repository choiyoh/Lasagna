import { useEffect, useRef } from 'react';

export interface ShortcutActions {
  /** 그래프나 데이터베이스 화면이 떠 있는가(Esc 로 닫는다) */
  overlayOpen: boolean;
  /** 그래프·DB 입력창에서 누른 Esc 는 닫지 않는다 */
  closeOverlay: () => void;
  selected: string | null;
  openSwitcher: () => void;
  toggleGraph: () => void;
  newNote: () => void;
  openSettings: () => void;
  openShortcuts: () => void;
  rename: () => void;
  closeTab: (path: string) => void;
  openPalette: () => void;
  toggleBookmark: (path: string) => void;
  openDaily: () => void;
  /** 오른쪽 링크 도크 열기·닫기(⌘⇧\) */
  togglePanel: () => void;
  /** 사이드바 본문 검색으로 초점(⌘⇧F) */
  focusSearch: () => void;
  /** 열린 DB 화면의 입력창에서 누른 Esc 인가를 가리는 데 쓴다 */
  dbOpen: boolean;
}

const OPEN_LAYERS = '.dialog-backdrop, .dbpop, .dbscreen__menu, .ctxmenu, .datepicker, .nops-prompt, .switcher-backdrop';

/** 앱 전체 단축키: ⌘O 전환기 · ⌘P 팔레트 · ⌘N 새 노트 · ⌘, 설정 · F1 단축키 · F2 이름 · ⌘W 탭 닫기 · ⌘⇧G 그래프 · ⌘⇧B 북마크 · ⌘⌥D 오늘 · ⌘⇧\ 도크 · ⌘⇧F 본문 검색 */
export function useAppShortcuts(actions: ShortcutActions) {
  // 매 렌더 새로 만들어지는 콜백을 그때그때 ref 에 담아 두고, 리스너는 처음 한 번만 단다
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = latest.current;
      const mod = e.metaKey || e.ctrlKey;
      const plain = mod && !e.shiftKey && !e.altKey;
      if (plain && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        a.openSwitcher();
      } else if (mod && e.shiftKey && !e.altKey && e.code === 'KeyG') {
        e.preventDefault();
        a.toggleGraph();
      } else if (e.key === 'Escape') {
        // 하위 팝오버·모달이 자체 Escape 를 처리했거나, 아직 DOM 에 열려 있으면 상위 화면은 닫지 않는다.
        if (e.defaultPrevented || document.querySelector(OPEN_LAYERS)) return;
        if (a.overlayOpen || (a.dbOpen && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement))) {
          a.closeOverlay();
        }
      } else if (plain && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        a.newNote();
      } else if (plain && e.key === ',') {
        e.preventDefault();
        a.openSettings();
      } else if (e.key === 'F1') {
        e.preventDefault();
        a.openShortcuts();
      } else if (e.key === 'F2') {
        e.preventDefault();
        a.rename();
      } else if (plain && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (a.selected) a.closeTab(a.selected);
      } else if (plain && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        a.openPalette();
      } else if (mod && e.shiftKey && !e.altKey && e.code === 'KeyB') {
        e.preventDefault();
        if (a.selected) a.toggleBookmark(a.selected);
      } else if (mod && e.shiftKey && !e.altKey && e.code === 'KeyF') {
        e.preventDefault();
        a.focusSearch();
      } else if (mod && e.shiftKey && !e.altKey && e.code === 'Backslash') {
        // ⇧\\ 는 글자로는 | 가 되므로 자리(code)로 본다
        e.preventDefault();
        a.togglePanel();
      } else if (mod && e.altKey && e.code === 'KeyD') {
        e.preventDefault();
        a.openDaily();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
