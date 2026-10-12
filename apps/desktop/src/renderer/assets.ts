import { useEffect, useMemo, useRef, useState } from 'react';
import { createAssetResolver, type AssetResolver } from '@nopsidian/core/assets';

/**
 * 볼트의 첨부 목록. 에디터의 노드 뷰가 동기적으로 경로를 찾아야 하므로,
 * React 상태와 별개로 즉시 갱신되는 저장소를 둔다(`add`는 저장 직후 호출한다).
 */
export interface AssetStore {
  resolve: (target: string, fromPath: string) => string | undefined;
  add: (path: string) => void;
}

export function useAssetStore(): AssetStore {
  const paths = useRef<Set<string>>(new Set());
  const resolver = useRef<AssetResolver>(createAssetResolver([]));
  const [, bump] = useState(0);

  const store = useMemo<AssetStore>(() => {
    const rebuild = () => {
      resolver.current = createAssetResolver([...paths.current]);
    };
    return {
      resolve: (target, fromPath) => resolver.current(target, fromPath),
      add: (path) => {
        if (paths.current.has(path)) return;
        paths.current.add(path);
        rebuild();
        bump((n) => n + 1);
      },
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const list = await window.nops.asset.list();
      if (!alive) return;
      paths.current = new Set(list.map((a) => a.path));
      resolver.current = createAssetResolver([...paths.current]);
      bump((n) => n + 1);
    };
    void load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = window.nops.on('asset.changed', () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 200);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      off();
    };
  }, []);

  return store;
}
