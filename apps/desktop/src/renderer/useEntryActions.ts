import { useCallback } from 'react';
import { t, tPlural } from '@nopsidian/i18n';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { showTextPrompt } from '@nopsidian/editor/nops';
import { getLanguage } from './language';
import type { NoteSummary } from '@nopsidian/ipc-contract';
import type { ConfirmState, Toast } from './app-types';
import { flushAll } from './flush';
import { withNoteCover, withNoteIcon } from './note-icon';
import { characterNoteMarkdown, characterTemplateCandidates, episodeNoteMarkdown, episodeTemplateCandidates, validateWorkName, workPlan, withGoalChars } from '@nopsidian/core';
import { freshNotes, untitledPath } from './note-title';
import { placeGroupInOrder, remapOrder, type SidebarOrder } from './sidebar-order';
import type { TreeNode } from './sidebar/build-tree';
import { topLevel, type Entry } from './sidebar/selection';
import type { TabsAction } from './tabs';
import { userMessage } from './user-message';
import { renameFailureText } from './rename-error';

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
      const name = (await showTextPrompt(parent ? t('entry.folderNameIn', { parent }) : t('entry.newFolderName'), t('entry.newFolder')))?.trim().replace(/[\\/:*?"<>|]/g, ' ').trim();
      if (!name) return;
      try {
        await window.nops.folder.create({ path: parent ? `${parent}/${name}` : name });
        refresh();
      } catch (e) {
        setToast({ message: t('entry.folderCreateFailed', { message: userMessage(e) }) });
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
      isFolder ? t('entry.renameFolderPrompt') : t('entry.renameNotePrompt'),
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
          message: done.totalChanges > 0 ? t('entry.renamedWithLinks', { links: tPlural('count.links', done.totalChanges) }) : t('entry.renamed'),
          undo: async () => {
            await flushAll();
            await window.nops.note.undoRename({ undoId: done.undoId });
            await applyMovedState(target, from, isFolder, true);
            refresh();
            setToast({ message: t('entry.undone') });
          },
        });
      };
      if (plan.totalChanges === 0 || opts.auto) return await apply();
      setConfirm({
        title: t('entry.renameConfirmTitle'),
        lines: [
          `${from} → ${target}`,
          t('entry.renameConfirmBody', { notes: plan.edits.length, links: plan.totalChanges }),
          ...plan.edits.slice(0, 8).map((e) => `· ${e.newPath} (${e.changes})`),
          ...(plan.edits.length > 8 ? [t('entry.moreCount', { count: plan.edits.length - 8 })] : []),
        ],
        confirmLabel: t('entry.renameConfirm'),
        onConfirm: () => {
          setConfirm(null);
          void apply().catch((e) => setToast({ message: t('entry.failed', { message: userMessage(e) }) }));
        },
      });
    } catch (e) {
      // 이미 있는 이름이면 그 사실을 분명히 알려 준다(확인창만 닫히고 조용히 끝나지 않게).
      setToast({ message: renameFailureText(e, !!opts.auto, target) });
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
        setToast({ message: t('entry.iconFailed', { message: userMessage(e) }) });
      }
    },
    [refresh],
  );

  /**
   * 새 회차 노트 — 작품의 회차 폴더에 만들고 연다. 내용은 작품 회차 템플릿을 복사하고 첫 H1 만 이름으로 바꾼다.
   * `goal_chars` 는 넣지 않는다(사용자가 목표를 정할 때만 기록).
   */
  const createEpisode = useCallback(
    async (work: string, episodeFolder: string, rawName: string) => {
      const problem = validateWorkName(rawName);
      if (problem) {
        setToast({ message: t(`episode.err.${problem}`) });
        return;
      }
      const name = rawName.trim();
      const path = `${episodeFolder}/${name}.md`;
      if (live.current.notes.some((n) => n.path === path)) {
        setToast({ message: t('episode.err.exists', { name }) });
        return;
      }
      try {
        let template: string | null = null;
        for (const candidate of episodeTemplateCandidates(work)) {
          try {
            template = (await window.nops.note.read({ path: candidate })).content;
            break;
          } catch {
            // 다음 언어 후보를 시도한다.
          }
        }
        const content = episodeNoteMarkdown(template, name);
        const saved = await window.nops.note.save({ path, content, baseHash: null });
        if (saved.status !== 'saved') {
          setToast({ message: t('episode.err.exists', { name }) });
          return;
        }
        setSelected(path);
        refresh();
      } catch (e) {
        setToast({ message: t('episode.err.failed', { message: userMessage(e) }) });
      }
    },
    [refresh, setSelected],
  );

  /**
   * 새 캐릭터 노트 — 그 작품의 캐릭터 폴더에 만들고 바로 연다.
   * 내용은 작품 템플릿의 캐릭터 시트를 복사하고 속성 `name` 만 채운다(템플릿이 없으면 기본 시트).
   */
  const createCharacter = useCallback(
    async (work: string, characterFolder: string, rawName: string) => {
      const problem = validateWorkName(rawName);
      if (problem) {
        setToast({ message: t(`character.err.${problem}`) });
        return;
      }
      const name = rawName.trim();
      const path = `${characterFolder}/${name}.md`;
      if (live.current.notes.some((n) => n.path === path)) {
        setToast({ message: t('character.err.exists', { name }) });
        return;
      }
      try {
        // 작품을 만든 언어와 지금 UI 언어가 다를 수 있다 — 그 작품에 실제로 있는 템플릿을 먼저 찾는다.
        let template: string | null = null;
        for (const candidate of characterTemplateCandidates(work)) {
          try {
            template = (await window.nops.note.read({ path: candidate })).content;
            break;
          } catch {
            // 다음 후보(다른 언어 이름)를 시도한다.
          }
        }
        const content = characterNoteMarkdown(template, name, getLanguage().locale);
        const saved = await window.nops.note.save({ path, content, baseHash: null });
        if (saved.status !== 'saved') {
          setToast({ message: t('character.err.exists', { name }) });
          return;
        }
        setSelected(path);
        refresh();
      } catch (e) {
        setToast({ message: t('character.err.failed', { message: userMessage(e) }) });
      }
    },
    [refresh, setSelected],
  );

  /**
   * 작품(폴더+템플릿) 만들기 — 작가 모드 설정의 버튼에서 부른다.
   * 같은 이름의 폴더가 있으면 덮어쓰지 않고 알린다. 실패해도 이미 만든 것만 남는다.
   */
  const createWork = useCallback(
    async (rawName: string) => {
      const problem = validateWorkName(rawName);
      if (problem) {
        setToast({ message: t(`work.err.${problem}`) });
        return;
      }
      const plan = workPlan(rawName, getLanguage().locale);
      if (!plan) return;
      try {
        const folders = await window.nops.folder.list();
        if (folders.includes(plan.name)) {
          setToast({ message: t('work.err.exists', { name: plan.name }) });
          return;
        }
        for (const folder of plan.folders) {
          const created = await window.nops.folder.create({ path: folder });
          // 동시에 같은 이름이 생겼으면 기존 폴더를 건드리지 않고 멈춘다(create 는 중복 시 이름을 바꾼다).
          if (created.path !== folder) {
            setToast({ message: t('work.err.exists', { name: plan.name }) });
            refresh();
            return;
          }
        }
        for (const file of plan.files) await window.nops.note.save({ path: file.path, content: file.content, baseHash: null });
        setSelected(plan.files[0]?.path ?? plan.name);
        refresh();
      } catch (e) {
        setToast({ message: t('work.err.failed', { message: userMessage(e) }) });
        refresh();
      }
    },
    [refresh, setSelected],
  );

  /** 문서 목표 글자수를 프런트매터 `goal_chars` 에 쓰거나 지운다. 열려 있는 에디터는 다시 불러온다. */
  const setNoteGoal = useCallback(
    async (p: string, goal: number | null) => {
      try {
        await flushAll();
        const cur = await window.nops.note.read({ path: p });
        const next = withGoalChars(cur.content, goal);
        if (next !== cur.content) await window.nops.note.save({ path: p, content: next, baseHash: cur.hash });
        window.dispatchEvent(new CustomEvent('nops:reload-note', { detail: p }));
        refresh();
      } catch (e) {
        setToast({ message: t('writer.goalFailed', { message: userMessage(e) }) });
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
        setToast({ message: t('entry.coverFailed', { message: userMessage(e) }) });
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
      if (items.length < topLevel(raw).length) setToast({ message: t('entry.moveIntoSelf') });
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
        message: failed
          ? t(links > 0 ? 'entry.movedWithLinksPartial' : 'entry.movedPartial', {
              items: tPlural('count.items', done.length),
              links: tPlural('count.links', links),
              failed: tPlural('count.items', failed),
            })
          : t(links > 0 ? 'entry.movedWithLinks' : 'entry.moved', {
              items: tPlural('count.items', done.length),
              links: tPlural('count.links', links),
            }),
        undo: done.length
          ? async () => {
              await flushAll();
              for (const d of [...done].reverse()) {
                await window.nops.note.undoRename({ undoId: d.undoId });
                await applyMovedState(d.target, d.from, d.isFolder, false);
              }
              refresh();
              setToast({ message: t('entry.undone') });
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
        if (raw.some((it) => it.isFolder && target.startsWith(`${it.path}/`))) setToast({ message: t('entry.moveIntoSelf') });
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
        title: isFolder ? t('entry.deleteFolderTitle', { name }) : t('entry.deleteNoteTitle', { name }),
        lines: [
          isFolder ? t('entry.deleteFolderBody') : t('entry.deleteNoteBody'),
          t('entry.deleteBacklinkNote'),
        ],
        confirmLabel: t('common.delete'),
        tone: 'danger',
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
                message: t('entry.trashed', { name }),
                undo: async () => {
                  const back = await window.nops.note.restore({ trashId: r.trashId });
                  refresh();
                  if (!r.isFolder) setSelected(back.path);
                  setToast({ message: t('entry.undone') });
                },
              });
            } catch (e) {
              setToast({ message: t('entry.deleteFailed', { message: userMessage(e) }) });
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
        title: t('entry.deleteManyTitle', { items: tPlural('count.items', items.length) }),
        lines: [
          ...items.slice(0, 6).map((it) => `· ${it.isFolder ? '📁 ' : ''}${nameOf(it.path)}`),
          ...(items.length > 6 ? [t('entry.moreCount', { count: items.length - 6 })] : []),
          t('entry.deleteNoteBody'),
        ],
        confirmLabel: t('common.delete'),
        tone: 'danger',
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
                message: t('entry.trashedMany', { items: tPlural('count.items', items.length) }),
                undo: async () => {
                  for (const id of trashed) await window.nops.note.restore({ trashId: id });
                  refresh();
                  setToast({ message: t('entry.undone') });
                },
              });
            } catch (e) {
              refresh();
              setToast({ message: t('entry.deleteFailed', { message: userMessage(e) }) });
            }
          })();
        },
      });
    },
    [refresh, deleteEntry],
  );


  return { createNote, quickNote, newFolder, openDaily, createWork, createCharacter, createEpisode, renameEntry, renameCurrent, setNoteIcon, setNoteCover, setNoteGoal, renameNoteTitle, moveMany, moveEntries, moveRelative, deleteEntry, deleteEntries };
}
