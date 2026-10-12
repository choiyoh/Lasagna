import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@nopsidian/editor';
import { relativePath, vaultUrl } from '@nopsidian/core/assets';
import { TextSelection } from 'prosemirror-state';
import {
  createNopsEditor,
  parseDocument,
  serializeDocument,
  type Baseline,
  type NopsAssetHost,
  type WikiLinkTarget,
} from '@nopsidian/editor/nops';
import type { SourceEditor } from '@nopsidian/editor/nops/source';
import type { AssetStore } from './assets';

const SAVE_DELAY_MS = 500;

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
type Mode = 'edit' | 'source';

interface Props {
  path: string;
  vaultId: string;
  assets: AssetStore;
  onOpenLink: (link: WikiLinkTarget) => void;
}

/** 저장 결과가 앱의 내용과 달라졌을 때 사용자에게 알리는 문구 */
const NOTICES = {
  merged: '다른 편집기에서 바뀐 내용과 자동으로 합쳤어요.',
  conflict: '같은 부분을 두 곳에서 고쳐서 양쪽 내용을 모두 남겼어요. 표시(<!-- nopsidian:conflict -->)를 보고 정리해 주세요.',
  copy: '파일이 밖에서 바뀌어 내 편집본을 "(충돌 …)" 사본으로 저장했어요.',
} as const;

/**
 * 노트 하나를 편집한다. 두 가지 모드가 같은 저장 흐름을 쓴다.
 *  - 편집 모드: 블록 에디터. 저장할 때 바뀐 블록만 다시 쓴다.
 *  - 소스 모드(⌘E): 파일 전체(프런트매터 포함)의 마크다운 원문을 그대로 편집한다.
 *
 * 열기: 읽기(hash) → 파싱 → 표시. 편집 500ms 뒤 `note.save`(baseHash로 외부 변경 감지).
 * 외부 변경: 편집 중이 아니면 조용히 다시 불러오고, 편집 중이면 다음 저장에서 병합한다.
 */
export function NoteEditor({ path, vaultId, assets, onOpenLink }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sourceHostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<SaveState>('saved');
  const [mode, setModeState] = useState<Mode>('edit');
  const [notice, setNotice] = useState<string | null>(null);
  const linkRef = useRef(onOpenLink);
  linkRef.current = onOpenLink;
  const toggleRef = useRef<() => void>(() => undefined);

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
    const editor: Editor = createNopsEditor(host, { onOpenLink: (l) => linkRef.current(l), assets: assetHost });

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
      loaded = true;
      setState('saved');
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

    const offChanged = window.nops.on('note.changed', (e) => {
      if (e.path !== path || !e.external || e.kind === 'unlink') return;
      if (dirty || saving) return; // 편집 중이면 다음 저장에서 병합한다
      void load();
    });

    void load();

    return () => {
      disposed = true;
      offChanged();
      clearTimeout(timer);
      // 닫기 전에 남은 편집을 저장한다
      if (loaded && dirty && !saving) {
        void window.nops.note.save({ path, content: currentContent(), baseHash: hash });
      }
      toggleRef.current = () => undefined;
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

  return (
    <div className="note-editor" data-mode={mode}>
      <div className="note-editor__bar">
        <span className="note-editor__status" data-state={state} aria-live="polite">
          {state === 'saved' ? '저장됨' : state === 'saving' ? '저장 중…' : state === 'error' ? '저장 실패' : '편집 중'}
        </span>
        <button
          className="note-editor__mode"
          onClick={() => toggleRef.current()}
          title="편집 모드 ↔ 소스 모드 (⌘E)"
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
      <div ref={hostRef} className="note-editor__host" data-theme="system" data-testid="note-editor" hidden={mode === 'source'} />
      <div ref={sourceHostRef} className="note-editor__source" data-testid="source-editor" hidden={mode === 'edit'} />
    </div>
  );
}
