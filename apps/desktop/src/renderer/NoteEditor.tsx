import { useEffect, useRef, useState } from 'react';
import type { Editor, NopsPeekHost } from '@nopsidian/editor/nops';
import { createDbViewHost } from './db/dbview-host';
import { createRowPropsHost } from './db/RowProps';
import { EmojiPicker } from './EmojiPicker';
import { FindBar } from './FindBar';
import { keys } from './keys';
import type { DbEmbedHost } from './db/EmbeddedDb';
import { relativePath, vaultUrl } from '@nopsidian/core/assets';
import { TextSelection } from 'prosemirror-state';
import {
  createNopsEditor,
  flashBlock,
  insertMarkdown,
  parseDocument,
  serializeDocument,
  type Baseline,
  type NopsAssetHost,
  type NopsLinkHost,
  type WikiLinkTarget,
} from '@nopsidian/editor/nops';
import type { SourceEditor } from '@nopsidian/editor/nops/source';
import type { AssetStore } from './assets';
import { registerFlush } from './flush';
import { TemplatePicker } from './TemplatePicker';

const SAVE_DELAY_MS = 500;

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
type Mode = 'edit' | 'source';

interface Props {
  path: string;
  vaultId: string;
  assets: AssetStore;
  links: NopsLinkHost;
  onOpenLink: (link: WikiLinkTarget) => void;
  /** 이름 변경(F2) */
  onRename?: () => void;
  /** ```dbview 펜스(노트 안의 데이터베이스 뷰)를 그릴 때 쓰는 앱 기능. 없으면 평범한 코드 블록 */
  dbHost?: DbEmbedHost;
  /** 위키링크 호버 미리보기·노트 임베드 발췌 */
  peek?: NopsPeekHost;
  /** 문서 아이콘(이모지)과 바꾸는 함수. 없으면 아이콘 UI 가 없다 */
  icon?: string | null;
  onSetIcon?: (icon: string | null) => void;
  /** 링크로 열었을 때 이동할 제목/블록 */
  focus?: { heading: string | null; block: string | null } | null;
  /** 이 노트를 가리키는 링크 이름(블록 링크 복사에 쓴다) */
  noteLinkName: string;
}

/** 저장 결과가 앱의 내용과 달라졌을 때 사용자에게 알리는 문구 */
const NOTICES = {
  merged: '다른 곳에서 바뀐 내용과 자동으로 합쳤어요.',
  conflict: '같은 부분을 두 곳에서 고쳐서 양쪽 내용을 모두 남겼어요. 충돌 표시(<!-- nopsidian:conflict -->)를 보고 정리해 주세요.',
  copy: '파일이 다른 곳에서 바뀌어서, 내가 고친 내용은 ‘(충돌 …)’ 사본으로 따로 저장했어요.',
} as const;

/** 링크로 열었을 때 그 제목/블록으로 커서와 화면을 옮긴다. */
function scrollToFocus(editor: Editor, focus: { heading: string | null; block: string | null } | null | undefined) {
  if (!focus || (!focus.heading && !focus.block)) return;
  const view = editor.getView();
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  let found = -1;
  let prevTop = -1;
  view.state.doc.forEach((node, offset) => {
    if (found >= 0) return;
    if (focus.block) {
      const own = node.attrs.blockId === focus.block;
      const inList = node.type.name === 'bullet_list' || node.type.name === 'ordered_list' || node.type.name === 'blockquote' || node.type.name === 'callout';
      let nested = -1;
      if (inList) node.descendants((n, pos) => {
        if (nested < 0 && n.attrs.blockId === focus.block) nested = offset + 1 + pos;
        return nested < 0;
      });
      if (own) found = offset;
      else if (nested >= 0) found = nested;
      else if (node.type.name === 'paragraph' && node.textContent.trim() === `^${focus.block}` && prevTop >= 0) found = prevTop;
    } else if (focus.heading && node.type.name === 'heading' && norm(node.textContent) === norm(focus.heading)) {
      found = offset;
    }
    prevTop = offset;
  });
  if (found < 0) return;
  const pos = Math.min(found + 1, view.state.doc.content.size);
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))).scrollIntoView());
  // 어디로 왔는지 보이도록 잠깐 강조한다
  flashBlock(view, found);
}

/**
 * 노트 하나를 편집한다. 두 가지 모드가 같은 저장 흐름을 쓴다.
 *  - 편집 모드: 블록 에디터. 저장할 때 바뀐 블록만 다시 쓴다.
 *  - 소스 모드(⌘E): 파일 전체(프런트매터 포함)의 마크다운 원문을 그대로 편집한다.
 *
 * 열기: 읽기(hash) → 파싱 → 표시. 편집 500ms 뒤 `note.save`(baseHash로 외부 변경 감지).
 * 외부 변경: 편집 중이 아니면 조용히 다시 불러오고, 편집 중이면 다음 저장에서 병합한다.
 */
export function NoteEditor({ path, vaultId, assets, links, onOpenLink, onRename, focus, noteLinkName, dbHost, peek, icon, onSetIcon }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sourceHostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<SaveState>('saved');
  const [mode, setModeState] = useState<Mode>('edit');
  const [notice, setNotice] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const insertTemplateRef = useRef<(templatePath: string) => Promise<void>>(async () => undefined);
  const linkRef = useRef(onOpenLink);
  linkRef.current = onOpenLink;
  const linksRef = useRef(links);
  linksRef.current = links;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const nameRef = useRef(noteLinkName);
  nameRef.current = noteLinkName;
  const dbHostRef = useRef(dbHost);
  dbHostRef.current = dbHost;
  const onRenameRef = useRef(onRename);
  onRenameRef.current = onRename;
  const [pickingIcon, setPickingIcon] = useState(false);
  const peekRef = useRef(peek);
  peekRef.current = peek;
  const toggleRef = useRef<() => void>(() => undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const modeRef = useRef<Mode>('edit');
  modeRef.current = mode;
  /** 찾기 막대: 열린 상태·처음 채울 말·초점 다시 주기·문서 변경 횟수 */
  const [find, setFindState] = useState<{ initial: string; tick: number } | null>(null);
  const [docTick, setDocTick] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    const sourceHost = sourceHostRef.current;
    if (!host || !sourceHost) return;
    let disposed = false;

    const noteDir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const assetHost: NopsAssetHost = {
      resolve: (target) => assets.resolve(target, path),
      url: (p) => vaultUrl(vaultId, p),
      save: async (file) => {
        const data = new Uint8Array(await file.arrayBuffer());
        const r = await window.nops.asset.save({ name: file.name, data });
        assets.add(r.path); // 에디터가 바로 그리도록 목록에 즉시 반영한다
        return r.path;
      },
      imageSrc: (p) => relativePath(noteDir, p),
      embedTarget: (p) => {
        const base = p.slice(p.lastIndexOf('/') + 1);
        return assets.resolve(base, path) === p ? base : p;
      },
      open: (p) => void window.nops.asset.open({ path: p }),
      onError: (m) => setNotice(m),
    };
    const editor: Editor = createNopsEditor(host, { onOpenLink: (l) => linkRef.current(l), assets: assetHost,
      rowProps: createRowPropsHost(path, () => dbHostRef.current?.notes ?? [], () => onRenameRef.current?.()),
      peek: {
        peek: (l) => (peekRef.current ? peekRef.current.peek(l) : Promise.resolve(null)),
        source: (l) => (peekRef.current?.source ? peekRef.current.source(l) : Promise.resolve(null)),
        save: (l, md) => (peekRef.current?.save ? peekRef.current.save(l, md) : Promise.resolve(false)),
        onChange: (cb) => peekRef.current?.onChange?.(cb) ?? (() => undefined),
      },
      links: linksRef.current,
      dbView: dbHostRef.current
        ? createDbViewHost({
            // 에디터는 한 번만 만들어지므로 최신 값은 ref 로 읽는다
            get vaultId() {
              return dbHostRef.current!.vaultId;
            },
            get notes() {
              return dbHostRef.current!.notes;
            },
            openNote: (p) => dbHostRef.current!.openNote(p),
            openDb: (f) => dbHostRef.current!.openDb(f),
          })
        : undefined,
      slashItems: [
        {
          icon: '📋',
          label: '템플릿 삽입',
          description: '템플릿 노트의 내용을 여기에 넣어요',
          category: 'advanced',
          keywords: ['template', '템플릿', '양식', '서식'],
          run: () => setPicker(true),
        },
      ],
      blockLink: {
        noteName: () => nameRef.current,
        copy: (text) => {
          navigator.clipboard.writeText(text).then(
            () => setNotice(`복사했어요: ${text}`),
            (e) => setNotice(`복사하지 못했어요: ${e instanceof Error ? e.message : String(e)}`),
          );
        },
      },
    });

    editorRef.current = editor;
    insertTemplateRef.current = async (templatePath) => {
      const title = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '');
      const { content } = await window.nops.template.read({ path: templatePath, title });
      insertMarkdown(editor.getView(), content);
      editor.focus();
    };

    let source: SourceEditor | null = null;
    let current: Mode = 'edit';
    let baseline: Baseline | null = null;
    let hash: string | null = null;
    let dirty = false;
    let saving = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let loaded = false;

    /** 지금 화면(어느 모드든)의 파일 내용 */
    const currentContent = () =>
      current === 'source' && source ? source.getText() : serializeDocument(editor.getDocument(), baseline);
    /** 저장하는 동안 더 편집했는지 비교하기 위한 스냅샷 */
    const snapshot = () => (current === 'source' && source ? source.getText() : editor.getDocument());

    /** 디스크에서 읽은(또는 병합된) 내용으로 두 화면을 맞춘다 */
    const showContent = (content: string) => {
      const parsed = parseDocument(content);
      baseline = parsed.baseline;
      editor.setDocument(parsed.doc, { silent: true });
      source?.setText(content);
    };

    const load = async () => {
      const r = await window.nops.note.read({ path });
      if (disposed) return;
      // 이미 같은 내용이면(우리가 방금 쓴 파일의 감시 이벤트 등) 아무것도 바꾸지 않는다 — 커서가 튀지 않게
      if (loaded && r.hash === hash) return;
      const view = editor.getView();
      const oldHead = view.state.selection.head;
      hash = r.hash;
      showContent(r.content);
      if (loaded && current === 'edit') {
        // 다시 불러온 경우 커서를 같은 위치 근처에 둔다
        const size = view.state.doc.content.size;
        view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(Math.min(oldHead, size)))));
      }
      dirty = false;
      const first = !loaded;
      loaded = true;
      setState('saved');
      if (first) scrollToFocus(editor, focusRef.current);
    };

    const save = async (): Promise<void> => {
      if (!loaded || saving || !dirty) return;
      saving = true;
      setState('saving');
      const atSave = snapshot();
      try {
        const content = currentContent();
        const r = await window.nops.note.save({ path, content, baseHash: hash });
        if (disposed) return;
        hash = r.hash;
        if (r.status !== 'saved') {
          // 디스크 내용이 앱의 내용과 달라졌으므로 화면을 그 내용으로 다시 채운다
          showContent(r.content);
          setNotice(NOTICES[r.status]);
          dirty = false;
        } else {
          baseline = parseDocument(r.content).baseline;
          dirty = snapshot() !== atSave; // 저장하는 동안 더 편집했으면 다시 저장
        }
        setState(dirty ? 'dirty' : 'saved');
      } catch (e) {
        console.error('저장 실패', e);
        setState('error');
        return;
      } finally {
        saving = false;
      }
      if (dirty) schedule();
    };

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void save(), SAVE_DELAY_MS);
    };

    const markDirty = () => {
      if (!loaded) return;
      dirty = true;
      setNotice(null);
      setState('dirty');
      schedule();
    };
    editor.on('change', markDirty);
    editor.on('change', () => setDocTick((t) => t + 1));
    editor.on('blur', () => {
      clearTimeout(timer);
      void save();
    });

    // ── 모드 전환 ──
    const setMode = async (next: Mode) => {
      if (!loaded || next === current) return;
      if (next === 'source') {
        if (!source) {
          // 소스 편집기(CodeMirror)는 처음 쓸 때 불러온다
          const { createSourceEditor } = await import('@nopsidian/editor/nops/source');
          if (disposed) return;
          source = createSourceEditor(sourceHost, { text: currentContent(), onChange: markDirty });
        } else {
          source.setText(currentContent());
        }
        current = 'source';
        setModeState('source');
        source.focus();
      } else {
        if (!source) return;
        const text = source.getText();
        const parsed = parseDocument(text);
        baseline = parsed.baseline; // 소스에서 고친 내용이 기준이 되므로 안 바뀐 블록은 바이트 그대로 유지된다
        editor.setDocument(parsed.doc, { silent: true });
        current = 'edit';
        setModeState('edit');
        editor.focus();
      }
    };
    toggleRef.current = () => void setMode(current === 'edit' ? 'source' : 'edit');

    // 이름 변경처럼 디스크를 건드리는 작업 전에 미저장 내용을 저장한다
    const unregisterFlush = registerFlush(async () => {
      clearTimeout(timer);
      while (saving) await new Promise((r) => setTimeout(r, 20));
      await save();
    });

    const offChanged = window.nops.on('note.changed', (e) => {
      if (e.path !== path || !e.external || e.kind === 'unlink') return;
      if (dirty || saving) return; // 편집 중이면 다음 저장에서 병합한다
      void load();
    });

    // 앱 안에서 파일을 바꾼 경우(버전 복원 등)는 자기 쓰기라 `external` 이 아니므로 직접 알린다
    const onReload = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== path || dirty || saving) return;
      void load();
    };
    window.addEventListener('nops:reload-note', onReload);

    void load();

    return () => {
      disposed = true;
      unregisterFlush();
      offChanged();
      window.removeEventListener('nops:reload-note', onReload);
      clearTimeout(timer);
      // 닫기 전에 남은 편집을 저장한다
      if (loaded && dirty && !saving) {
        void window.nops.note.save({ path, content: currentContent(), baseHash: hash });
      }
      toggleRef.current = () => undefined;
      editorRef.current = null;
      setFindState(null);
      source?.destroy();
      editor.destroy();
    };
  }, [path, vaultId, assets]);

  // ⌘E / Ctrl+E: 편집 모드 ↔ 소스 모드
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        toggleRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ⌘F / Ctrl+F: 노트 안 찾기. 초점이 있는 에디터가 받고, 아무 에디터에도 초점이 없으면 첫 에디터가 받는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'f') || e.shiftKey) return;
      const root = rootRef.current;
      const editor = editorRef.current;
      if (!root || !editor || modeRef.current !== 'edit') return;
      const active = document.activeElement;
      const mine = active instanceof Node && root.contains(active);
      const anyEditor = active instanceof Element && active.closest('.note-editor');
      if (!mine && (anyEditor || document.querySelector('.note-editor') !== root)) return;
      e.preventDefault();
      const { state } = editor.getView();
      const picked = state.selection.empty ? '' : state.doc.textBetween(state.selection.from, state.selection.to, ' ');
      setFindState((f) => ({ initial: picked.length < 200 && !picked.includes('\n') ? picked : '', tick: (f?.tick ?? 0) + 1 }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="note-editor" data-mode={mode} ref={rootRef}>
      {find && mode === 'edit' && editorRef.current && (
        <FindBar
          view={editorRef.current.getView()}
          initial={find.initial}
          focusTick={find.tick}
          docTick={docTick}
          onClose={() => setFindState(null)}
        />
      )}
      <div className="note-editor__bar">
        <span className="note-editor__status" data-state={state} aria-live="polite">
          {state === 'saved' ? '저장됨' : state === 'saving' ? '저장 중…' : state === 'error' ? '저장 실패' : '편집 중'}
        </span>
        {onRename && (
          <button className="note-editor__mode" onClick={onRename} title="이름 바꾸기 / 이동 (F2)">
            이름 바꾸기
          </button>
        )}
        <button
          className="note-editor__mode"
          onClick={() => toggleRef.current()}
          title={keys('편집 모드 ↔ 소스 모드 (⌘E)')}
          aria-pressed={mode === 'source'}
        >
          {mode === 'source' ? '편집 모드' : '소스 모드'}
        </button>
      </div>
      {notice && (
        <div className="note-editor__notice" role="status">
          {notice}
          <button onClick={() => setNotice(null)} aria-label="닫기">
            ×
          </button>
        </div>
      )}
      {(icon || onSetIcon) && (
        <div className="noteicon">
          {icon ? (
            <button className="noteicon__btn" onClick={() => onSetIcon && setPickingIcon(true)} title="아이콘 바꾸기" aria-label="아이콘 바꾸기" data-testid="note-icon">
              {icon}
            </button>
          ) : (
            <button className="noteicon__add" onClick={() => setPickingIcon(true)} data-testid="note-icon-add">
              ☺ 아이콘 추가
            </button>
          )}
          {pickingIcon && onSetIcon && (
            <EmojiPicker
              hasIcon={!!icon}
              onClose={() => setPickingIcon(false)}
              onPick={(e) => {
                setPickingIcon(false);
                onSetIcon(e);
              }}
            />
          )}
        </div>
      )}
      <div ref={hostRef} className="note-editor__host" data-testid="note-editor" hidden={mode === 'source'} />
      {picker && (
        <TemplatePicker
          onClose={() => {
            setPicker(false);
          }}
          onPick={(p) => {
            setPicker(false);
            void insertTemplateRef.current(p);
          }}
        />
      )}
      <div ref={sourceHostRef} className="note-editor__source" data-testid="source-editor" hidden={mode === 'edit'} />
    </div>
  );
}
