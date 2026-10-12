import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@nopsidian/editor';
import { createNopsEditor, parseDocument, serializeDocument, type Baseline, type WikiLinkTarget } from '@nopsidian/editor/nops';

const SAVE_DELAY_MS = 500;

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

interface Props {
  path: string;
  onOpenLink: (link: WikiLinkTarget) => void;
}

/** 저장 결과가 앱의 내용과 달라졌을 때 사용자에게 알리는 문구 */
const NOTICES = {
  merged: '다른 편집기에서 바뀐 내용과 자동으로 합쳤어요.',
  conflict: '같은 부분을 두 곳에서 고쳐서 양쪽 내용을 모두 남겼어요. 표시(<!-- nopsidian:conflict -->)를 보고 정리해 주세요.',
  copy: '파일이 밖에서 바뀌어 내 편집본을 "(충돌 …)" 사본으로 저장했어요.',
} as const;

/**
 * 노트 하나를 편집한다.
 *  - 열 때: 읽기(hash) → 파싱 → 에디터에 표시
 *  - 편집 후 500ms: 바뀐 블록만 다시 쓴 마크다운을 `note.save`로 저장 (baseHash로 외부 변경 감지)
 *  - 외부 변경: 편집 중이 아니면 조용히 다시 불러오고, 편집 중이면 다음 저장에서 병합한다
 */
export function NoteEditor({ path, onOpenLink }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<SaveState>('saved');
  const [notice, setNotice] = useState<string | null>(null);
  const linkRef = useRef(onOpenLink);
  linkRef.current = onOpenLink;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;

    const editor: Editor = createNopsEditor(host, { onOpenLink: (l) => linkRef.current(l) });
    let baseline: Baseline | null = null;
    let hash: string | null = null;
    let dirty = false;
    let saving = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let loaded = false;

    const load = async () => {
      const r = await window.nops.note.read({ path });
      if (disposed) return;
      const parsed = parseDocument(r.content);
      baseline = parsed.baseline;
      hash = r.hash;
      editor.setDocument(parsed.doc, { silent: true });
      dirty = false;
      loaded = true;
      setState('saved');
    };

    const save = async (): Promise<void> => {
      if (!loaded || saving || !dirty) return;
      saving = true;
      setState('saving');
      const docAtSave = editor.getDocument();
      try {
        const content = serializeDocument(docAtSave, baseline);
        const r = await window.nops.note.save({ path, content, baseHash: hash });
        if (disposed) return;
        hash = r.hash;
        baseline = parseDocument(r.content).baseline;
        if (r.status !== 'saved') {
          // 디스크 내용이 앱의 내용과 달라졌으므로 에디터를 그 내용으로 다시 채운다
          editor.setDocument(parseDocument(r.content).doc, { silent: true });
          setNotice(NOTICES[r.status]);
          dirty = false;
        } else {
          dirty = editor.getDocument() !== docAtSave; // 저장하는 동안 더 편집했으면 다시 저장
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

    editor.on('change', () => {
      if (!loaded) return;
      dirty = true;
      setNotice(null);
      setState('dirty');
      schedule();
    });
    editor.on('blur', () => {
      clearTimeout(timer);
      void save();
    });

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
        void window.nops.note.save({ path, content: serializeDocument(editor.getDocument(), baseline), baseHash: hash });
      }
      editor.destroy();
    };
  }, [path]);

  return (
    <div className="note-editor">
      <div className="note-editor__status" data-state={state} aria-live="polite">
        {state === 'saved' ? '저장됨' : state === 'saving' ? '저장 중…' : state === 'error' ? '저장 실패' : '편집 중'}
      </div>
      {notice && (
        <div className="note-editor__notice" role="status">
          {notice}
          <button onClick={() => setNotice(null)} aria-label="닫기">
            ×
          </button>
        </div>
      )}
      <div ref={hostRef} className="note-editor__host" data-theme="system" data-testid="note-editor" />
    </div>
  );
}
