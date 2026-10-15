import { useCallback, useEffect, useState } from 'react';
import type { NoteSummary } from '@nopsidian/ipc-contract';

/** 노트가 이보다 많은 볼트는 폴더를 접은 채로 시작한다(사이드바 DOM 을 줄인다) */
export const EXPAND_ALL_LIMIT = 300;

const keyOf = (vaultId: string) => `nops.tree.${vaultId}`;

/**
 * 사이드바 폴더 펼침 상태. 사용자가 접거나 편 폴더는 볼트별로 기억하고,
 * 나머지는 기본값(작은 볼트는 펼침, 큰 볼트는 접힘)을 따른다.
 */
export function useFolderOpen(vaultId: string, defaultOpen: boolean) {
  const [state, setState] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(keyOf(vaultId)) ?? '{}') as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(keyOf(vaultId), JSON.stringify(state));
    } catch {
      // 저장할 수 없으면 이번 실행에서만 기억
    }
  }, [vaultId, state]);
  const isOpen = useCallback((folder: string) => state[folder] ?? defaultOpen, [state, defaultOpen]);
  const setOpen = useCallback((folder: string, open: boolean) => setState((s) => (s[folder] === open ? s : { ...s, [folder]: open })), []);
  /** 이 노트가 보이도록 위 폴더들을 편다 */
  const reveal = useCallback(
    (notePath: string) => {
      const parts = notePath.split('/').slice(0, -1);
      setState((s) => {
        let next = s;
        parts.forEach((_, i) => {
          const f = parts.slice(0, i + 1).join('/');
          if ((next[f] ?? defaultOpen) !== true) next = { ...next, [f]: true };
        });
        return next;
      });
    },
    [defaultOpen],
  );
  return { isOpen, setOpen, reveal };
}

/** 노트 목록이 내용상 같으면 이전 배열을 그대로 쓴다(사이드바·나무를 다시 그리지 않게) */
export function sameNotes(a: NoteSummary[], b: NoteSummary[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.path !== y.path || x.title !== y.title || x.icon !== y.icon || x.mtime !== y.mtime || x.size !== y.size || x.aliases.join('\u0000') !== y.aliases.join('\u0000')) return false;
  }
  return true;
}
