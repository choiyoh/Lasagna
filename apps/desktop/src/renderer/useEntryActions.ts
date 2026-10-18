import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { showTextPrompt } from '@nopsidian/editor/nops';
import type { NoteSummary } from '@nopsidian/ipc-contract';
import type { ConfirmState, Toast } from './app-types';
import { flushAll } from './flush';
import { withNoteCover, withNoteIcon } from './note-icon';
import { freshNotes, untitledPath } from './note-title';
import { placeGroupInOrder, remapOrder, type SidebarOrder } from './sidebar-order';
import type { TreeNode } from './sidebar/build-tree';
import { topLevel, type Entry } from './sidebar/selection';
import type { TabsAction } from './tabs';

/** 노트·폴더를 만들고, 이름을 바꾸고, 옮기고, 지우는 동작들. 앱 상태는 인자로 받는다. */
export interface EntryActionDeps {
  refresh: () => void;
  selected: string | null;
  setSelected: (path: string) => void;
  dispatchTabs: Dispatch<TabsAction>;
  setDbOpen: Dispatch<SetStateAction<string | null>>;
  setBookmarks: Dispatch<SetStateAction<string[]>>;
  setToast: Dispatch<SetStateAction<Toast | null>>;
  setConfirm: Dispatch<SetStateAction<ConfirmState | null>>;
  /** 최신 노트 목록(콜백 안에서 읽는다) */
  live: MutableRefObject<{ notes: NoteSummary[] }>;
  order: MutableRefObject<SidebarOrder>;
  commitOrder: (next: SidebarOrder) => void;
  tree: MutableRefObject<TreeNode[]>;
}

export function useEntryActions(deps: EntryActionDeps) {
  const { refresh, selected, setSelected, dispatchTabs, setDbOpen, setBookmarks, setToast, setConfirm, live, commitOrder } = deps;
  const orderRef = deps.order;
  const treeRef = deps.tree;

  const createNote = useCallback(
    async (rawName: string) => {
      const name = rawName.trim().replace(/[\\:*?"<>|]/g, '').replace(/\.md$/i, '');
      if (!name) return;
      const path = `${name}.md`;
      const r = await window.nops.note.save({ path, content: `# ${name.slice(name.lastIndexOf('/') + 1)}\n`, baseHash: null });
      setSelected(r.status === 'copy' && r.copyPath ? r.copyPath : path);
      refresh();
    },
    [refresh],
  );

  /** 노션처럼 이름을 묻지 않고 "제목 없음" 노트를 바로 만들어 연다. 제목을 쓰면 파일 이름이 따라간다. */
  const quickNote = useCallback(
    async (folder = '') => {
      const path = untitledPath(folder, live.current.notes.map((n) => n.path));
      const r = await window.nops.note.save({ path, content: '# \n', baseHash: null });
      const opened = r.status === 'copy' && r.copyPath ? r.copyPath : path;
      freshNotes.add(opened);
      setSelected(opened);
      refresh();
    },
    [refresh],
  );

  /** 새 폴더: 이름을 묻고 `parent` 안에 만든다 */
  const newFolder = useCallback(
    async (parent: string) => {
      const name = (await showTextPrompt(parent ? `“${parent}” 안에 만들 폴더 이름` : '새 폴더 이름', '새 폴더'))?.trim().replace(/[\\/:*?"<>|]/g, ' ').trim();
      if (!name) return;
      try {
        await window.nops.folder.create({ path: parent ? `${parent}/${name}` : name });
        refresh();
      } catch (e) {
        setToast({ message: `폴더를 만들지 못했어요: ${e instanceof Error ? e.message : String(e)}` });
      }
    },
    [refresh],
  );

  const openDaily = useCallback(async () => {
    const r = await window.nops.daily.open({});
    setSelected(r.path);
    refresh();
  }, [refresh]);

  /** 이름을 바꾼 노트의 첫 H1 이 예전 이름과 같으면 새 이름으로 고친다 */
  const syncHeadingToName = async (from: string, to: string) => {
    const oldName = from.slice(from.lastIndexOf('/') + 1).replace(/\.md$/i, '');
    const newName = to.slice(to.lastIndexOf('/') + 1).replace(/\.md$/i, '');
    if (oldName === newName) return;
    try {
      const cur = await window.nops.note.read({ path: to });
      const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const next = cur.content.replace(new RegExp(`^((?:---\\r?\\n[\\s\\S]*?\\r?\\n---\\r?\\n)?\\s*)# ${esc}[ \\t]*(\\r?\\n|$)`), `$1# ${newName}$2`);
      if (next === cur.content) return;
      await window.nops.note.save({ path: to, content: next, baseHash: cur.hash });
      window.dispatchEvent(new CustomEvent('nops:reload-note', { detail: to }));
    } catch {
      // 제목을 못 고쳐도 이름 변경은 끝났다
    }
  };

  /** 항목이 옮겨진 뒤 앱 안의 경로(탭·열린 DB·북마크·사이드바 순서)를 따라가게 하고, 필요하면 노트 제목(H1)도 맞춘다 */
  const applyMovedState = useCallback(
    async (from: string, target: string, isFolder: boolean, syncHeading: boolean) => {
      const remap = (p: string, a: string, b: string) => (p === a ? b : p.startsWith(`${a}/`) ? `${b}${p.slice(a.length)}` : p);
      dispatchTabs({ type: 'remap', from, to: target });
      setDbOpen((cur) => (cur === null ? cur : remap(cur, from, target)));
      setBookmarks((cur) => {
        const next = cur.map((p) => remap(p, from, target));
        if (next.some((p, i) => p !== cur[i])) void window.nops.bookmarks.set(next);
        return next;
      });
      if (syncHeading && !isFolder) await syncHeadingToName(from, target);
      commitOrder(remapOrder(orderRef.current, from, target));
    },
    [commitOrder],
  );

  /** 이름 변경/이동(노트 또는 폴더): 미리보기(바뀌는 링크 수) → 확인 → 실행 → 되돌리기 */
  const renameEntry = useCallback(async (from: string, isFolder: boolean, preset?: string, opts: { auto?: boolean; afterMove?: (target: string) => void } = {}) => {
    // 노션처럼 이름만 바꾼다: 입력창에는 이름만 보이고, 폴더는 그대로 유지한다. `폴더/이름` 으로 쓰면 이동도 한다.
    const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
    const currentName = (isFolder ? from : from.replace(/\.md$/i, '')).slice(dir ? dir.length + 1 : 0);
    const answer = preset ?? await showTextPrompt(
      isFolder ? '폴더 이름 (다른 곳으로 옮기려면 ‘상위폴더/이름’으로 입력하세요)' : '새 이름 (다른 폴더로 옮기려면 ‘폴더/이름’으로 입력하세요)',
      currentName,
    );
    const typed = answer?.trim().replace(/^\/+|\/+$/g, '');
    const to = typed && !typed.includes('/') && dir ? `${dir}/${typed}` : typed;
    if (!to || to === from || `${to}.md` === from) return;
    const target = isFolder || /\.md$/i.test(to) ? to : `${to}.md`;
    await flushAll();
    try {
      const plan = await window.nops.note.renamePlan({ from, to: target });
      const apply = async () => {
        const done = await window.nops.note.rename({ from, to: target });
        // 노트 이름을 직접 바꾸면 제목(첫 H1)도 따라 바꾼다(제목이 원래 이름과 같았을 때만)
        await applyMovedState(from, target, isFolder, !opts.auto);
        opts.afterMove?.(target);
        refresh();
        if (opts.auto && done.totalChanges === 0) return;
        setToast({
          message: done.totalChanges > 0 ? `이름을 바꾸고 링크 ${done.totalChanges}개를 고쳤어요.` : '이름을 바꿨어요.',
          undo: async () => {
            await flushAll();
            await window.nops.note.undoRename({ undoId: done.undoId });
            await applyMovedState(target, from, isFolder, true);
            refresh();
            setToast({ message: '되돌렸어요.' });
          },
        });
      };
      if (plan.totalChanges === 0 || opts.auto) return await apply();
      setConfirm({
        title: '이름을 바꾸고 링크도 함께 고칠까요?',
        lines: [
          `${from} → ${target}`,
          `${plan.edits.length}개 노트의 링크 ${plan.totalChanges}개를 고쳐요.`,
          ...plan.edits.slice(0, 8).map((e) => `· ${e.newPath} (${e.changes})`),
          ...(plan.edits.length > 8 ? [`… 외 ${plan.edits.length - 8}개`] : []),
        ],
        confirmLabel: '바꾸기',
        onConfirm: () => {
          setConfirm(null);
          void apply().catch((e) => setToast({ message: `실패: ${e instanceof Error ? e.message : String(e)}` }));
        },
      });
    } catch (e) {
      setToast({
        message: opts.auto
          ? `같은 이름의 노트가 있거나 바꿀 수 없어서 파일 이름은 그대로 두었어요.`
          : `이름을 바꿀 수 없어요: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }, [refresh, applyMovedState]);
  const renameCurrent = useCallback(async () => {
    if (selected) await renameEntry(selected, false);
  }, [selected, renameEntry]);


  /** 문서 아이콘(이모지)을 프런트매터 `icon` 에 쓰거나 지운다. 열려 있는 에디터는 다시 불러온다. */
  const setNoteIcon = useCallback(
    async (p: string, icon: string | null) => {
      try {
        await flushAll();
        const cur = await window.nops.note.read({ path: p });
        const next = withNoteIcon(cur.content, icon);
        if (next !== cur.content) await window.nops.note.save({ path: p, content: next, baseHash: cur.hash });
        window.dispatchEvent(new CustomEvent('nops:reload-note', { detail: p }));
        refresh();
      } catch (e) {
        setToast({ message: `아이콘을 바꾸지 못했어요: ${e instanceof Error ? e.message : String(e)}` });
      }
    },
    [refresh],
  );

  /** 노트 커버를 프런트매터 `cover` 에 쓰거나 지운다. 열려 있는 에디터는 다시 불러온다. */
  const setNoteCover = useCallback(
    async (p: string, cover: string | null) => {
      try {
        await flushAll();
        const cur = await window.nops.note.read({ path: p });
        const next = withNoteCover(cur.content, cover);
        if (next !== cur.content) await window.nops.note.save({ path: p, content: next, baseHash: cur.hash });
        window.dispatchEvent(new CustomEvent('nops:reload-note', { detail: p }));
        refresh();
      } catch (e) {
        setToast({ message: `커버를 바꾸지 못했어요: ${e instanceof Error ? e.message : String(e)}` });
      }
    },
    [refresh],
  );

  /** 표·카드의 제목을 직접 고칠 때: 파일 이름을 바꾼다(폴더는 그대로) */
  const renameNoteTitle = useCallback(
    (p: string, title: string) => {
      const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
      void renameEntry(p, false, `${dir}${title.replace(/[\\/:*?"<>|]/g, ' ').trim()}`);
    },
    [renameEntry],
  );

  /** 여러 항목을 `toFolder` 안으로 옮긴다. 한 개면 이름 바꾸기와 같은 흐름(링크 갱신 확인·되돌리기), 여러 개면 확인 없이 차례로 옮기고 한 번에 되돌린다. */
  const moveMany = useCallback(
    async (raw: Entry[], toFolder: string, after?: (names: string[]) => void) => {
      const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
      const items = topLevel(raw).filter((it) => !(it.isFolder && (toFolder === it.path || toFolder.startsWith(`${it.path}/`))));
      if (items.length < topLevel(raw).length) setToast({ message: '폴더를 자기 자신 안으로는 옮길 수 없어요.' });
      if (!items.length) return;
      const dest = (it: Entry) => (toFolder ? `${toFolder}/${baseOf(it.path)}` : baseOf(it.path));
      if (items.length === 1) {
        const it = items[0]!;
        if (dest(it) === it.path) return after?.([baseOf(it.path)]);
        return void (await renameEntry(it.path, it.isFolder, dest(it), { afterMove: (t) => after?.([baseOf(t)]) }));
      }
      await flushAll();
      const done: { from: string; target: string; isFolder: boolean; undoId: string }[] = [];
      let failed = 0;
      let links = 0;
      for (const it of items) {
        const target = dest(it);
        if (target === it.path) continue;
        try {
          const r = await window.nops.note.rename({ from: it.path, to: target });
          await applyMovedState(it.path, target, it.isFolder, false);
          links += r.totalChanges;
          done.push({ from: it.path, target, isFolder: it.isFolder, undoId: r.undoId });
        } catch {
          failed++; // 같은 이름이 이미 있는 경우 등
        }
      }
      after?.(items.map((it) => baseOf(it.path)));
      refresh();
      if (!done.length && !failed) return;
      setToast({
        message: `${done.length}개를 옮겼어요${links > 0 ? ` (링크 ${links}개 갱신)` : ''}${failed ? ` · ${failed}개는 같은 이름이 있어 옮기지 못했어요` : ''}`,
        undo: done.length
          ? async () => {
              await flushAll();
              for (const d of [...done].reverse()) {
                await window.nops.note.undoRename({ undoId: d.undoId });
                await applyMovedState(d.target, d.from, d.isFolder, false);
              }
              refresh();
              setToast({ message: '되돌렸어요.' });
            }
          : undefined,
      });
    },
    [renameEntry, applyMovedState, refresh],
  );

  /** 사이드바에서 끌어다 놓기: `toFolder` 안으로 */
  const moveEntries = useCallback((items: Entry[], toFolder: string) => void moveMany(items, toFolder), [moveMany]);

  /** 사이드바 안에서 `target` 의 앞/뒤로 끌어 놓기: 같은 폴더면 순서만 바꾸고, 다른 폴더면 옮긴 뒤 그 자리에 끼운다 */
  const moveRelative = useCallback(
    (raw: Entry[], target: string, pos: 'before' | 'after') => {
      const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
      const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
      const items = topLevel(raw).filter((it) => it.path !== target && !(it.isFolder && target.startsWith(`${it.path}/`)));
      if (!items.length) {
        if (raw.some((it) => it.isFolder && target.startsWith(`${it.path}/`))) setToast({ message: '폴더를 자기 자신 안으로는 옮길 수 없어요.' });
        return;
      }
      const parent = dirOf(target);
      const place = (names: string[]) => {
        let siblings: TreeNode[] = treeRef.current;
        for (const part of parent ? parent.split('/') : []) siblings = siblings.find((n) => !n.note && n.name === part)?.children ?? [];
        commitOrder({ ...orderRef.current, [parent]: placeGroupInOrder(siblings.map((n) => n.name), names, baseOf(target), pos) });
      };
      if (items.every((it) => dirOf(it.path) === parent)) return place(items.map((it) => baseOf(it.path)));
      void moveMany(items, parent, place);
    },
    [moveMany, commitOrder],
  );

  /** 노트·폴더를 휴지통으로: 확인 → 이동 → 열린 탭·북마크 정리 → "되돌리기" 토스트 */
  const deleteEntry = useCallback(
    (target: string, isFolder: boolean) => {
      const name = target.slice(target.lastIndexOf('/') + 1).replace(/\.md$/i, '');
      setConfirm({
        title: isFolder ? `폴더를 삭제할까요? “${name}”` : `노트를 삭제할까요? “${name}”`,
        lines: [
          isFolder ? '폴더 안의 모든 노트와 첨부가 함께 휴지통(.nopsidian/trash)으로 옮겨져요.' : '휴지통(.nopsidian/trash)으로 옮겨져요. 바로 되돌릴 수 있어요.',
          '이 노트를 가리키던 [[링크]]는 그대로 남고 ‘없는 노트’로 표시돼요.',
        ],
        confirmLabel: '삭제',
        onConfirm: () => {
          setConfirm(null);
          void (async () => {
            try {
              await flushAll();
              const r = await window.nops.note.trash({ path: target });
              dispatchTabs({ type: 'closePath', path: target });
              setBookmarks((cur) => {
                const next = cur.filter((p) => p !== target && !p.startsWith(`${target}/`));
                if (next.length !== cur.length) void window.nops.bookmarks.set(next);
                return next;
              });
              refresh();
              setToast({
                message: `휴지통으로 옮겼어요: ${name}`,
                undo: async () => {
                  const back = await window.nops.note.restore({ trashId: r.trashId });
                  refresh();
                  if (!r.isFolder) setSelected(back.path);
                  setToast({ message: '되돌렸어요.' });
                },
              });
            } catch (e) {
              setToast({ message: `삭제하지 못했어요: ${e instanceof Error ? e.message : String(e)}` });
            }
          })();
        },
      });
    },
    [refresh, setSelected],
  );

  /** 여러 항목을 휴지통으로(한 개면 `deleteEntry` 의 확인창) */
  const deleteEntries = useCallback(
    (raw: Entry[]) => {
      const items = topLevel(raw);
      if (items.length === 1) return deleteEntry(items[0]!.path, items[0]!.isFolder);
      if (!items.length) return;
      const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/i, '');
      setConfirm({
        title: `${items.length}개 항목을 삭제할까요?`,
        lines: [
          ...items.slice(0, 6).map((it) => `· ${it.isFolder ? '📁 ' : ''}${nameOf(it.path)}`),
          ...(items.length > 6 ? [`… 외 ${items.length - 6}개`] : []),
          '휴지통(.nopsidian/trash)으로 옮겨져요. 바로 되돌릴 수 있어요.',
        ],
        confirmLabel: '삭제',
        onConfirm: () => {
          setConfirm(null);
          void (async () => {
            const trashed: string[] = [];
            try {
              await flushAll();
              for (const it of items) {
                const r = await window.nops.note.trash({ path: it.path });
                trashed.push(r.trashId);
                dispatchTabs({ type: 'closePath', path: it.path });
              }
              setBookmarks((cur) => {
                const next = cur.filter((p) => !items.some((it) => p === it.path || p.startsWith(`${it.path}/`)));
                if (next.length !== cur.length) void window.nops.bookmarks.set(next);
                return next;
              });
              refresh();
              setToast({
                message: `${items.length}개를 휴지통으로 옮겼어요`,
                undo: async () => {
                  for (const id of trashed) await window.nops.note.restore({ trashId: id });
                  refresh();
                  setToast({ message: '되돌렸어요.' });
                },
              });
            } catch (e) {
              refresh();
              setToast({ message: `삭제하지 못했어요: ${e instanceof Error ? e.message : String(e)}` });
            }
          })();
        },
      });
    },
    [refresh, deleteEntry],
  );


  return { createNote, quickNote, newFolder, openDaily, renameEntry, renameCurrent, setNoteIcon, setNoteCover, renameNoteTitle, moveMany, moveEntries, moveRelative, deleteEntry, deleteEntries };
}
