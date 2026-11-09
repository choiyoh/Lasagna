import { formatShortDateTime, t, tPlural } from '@nopsidian/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryEntryDto } from './history-types';
import { lineDiff } from '@nopsidian/core/diff';
import { flushAll } from './flush';
import { useLanguage } from './useLocale';
import { showTextPrompt } from '@nopsidian/editor/nops';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  path: string;
  /** 복원이 끝나면 호출 */
  onRestored: (message: string) => void;
}

const fmt = (iso: string) => formatShortDateTime(iso, { seconds: true });

/** 이름 붙인 스냅샷 한 건(작가 모드) */
interface SnapEntry {
  id: string;
  name: string;
  time: string;
  size: number;
}

const QUICK_NAMES = [
  ['history.snapshot.quick1', 'history.snapshot.quick1'],
  ['history.snapshot.quick2', 'history.snapshot.quick2'],
  ['history.snapshot.quickRevised', 'history.snapshot.quickRevised'],
  ['history.snapshot.quickReview', 'history.snapshot.quickReview'],
] as const;

/** 오른쪽 패널 "기록": 저장 때마다 남긴 이전 버전 목록, 현재 내용과의 줄 단위 비교, 복원. */
export function HistoryPanel({ path, onRestored }: Props) {
  const [entries, setEntries] = useState<HistoryEntryDto[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [old, setOld] = useState('');
  const [current, setCurrent] = useState('');
  const language = useLanguage();
  const writer = language.writerMode === true;
  const [snaps, setSnaps] = useState<SnapEntry[]>([]);
  const [snapPicked, setSnapPicked] = useState<string | null>(null);
  /** 선택한 스냅샷이 어느 노트의 것인지 — 노트가 바뀐 채 되돌리기로 다른 노트를 덮어쓰지 않게 한다. */
  const [snapPickedFor, setSnapPickedFor] = useState<string | null>(null);
  /** 자동 이력 선택도 같은 이유로 노트 경로를 함께 기억한다. */
  const [pickedFor, setPickedFor] = useState<string | null>(null);
  const [snapContent, setSnapContent] = useState('');
  const [snapNaming, setSnapNaming] = useState(false);
  const [snapDraft, setSnapDraft] = useState('');
  const [confirm, setConfirm] = useState<null | { kind: 'delete'; id: string } | { kind: 'restore' }>(null);
  /** 다시 읽기를 여러 번 요청했을 때 늦게 도착한 이전 결과를 버리기 위한 번호 */
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const list = await window.nops.history.list({ path });
      if (seq !== loadSeq.current) return;
      setEntries(list);
      if (writer) {
        try {
          setSnaps(await window.nops.history.snapshotList({ path }));
        } catch {
          // 스냅샷 목록을 못 읽어도 자동 이력은 보여 준다.
        }
      }
      const { content } = await window.nops.note.read({ path });
      if (seq !== loadSeq.current) return;
      setCurrent(content);
    } catch {
      // 읽지 못하면 이전 화면을 그대로 둔다(다음 변경 알림에서 다시 시도한다)
    }
  }, [path, writer]);

  useEffect(() => {
    // 노트가 바뀌면 선택·내용·확인창을 모두 비운다(다른 노트의 스냅샷으로 덮어쓰기 방지).
    setPicked(null);
    setPickedFor(null);
    setOld('');
    setSnapPicked(null);
    setSnapPickedFor(null);
    setSnapContent('');
    setSnapNaming(false);
    setSnapDraft('');
    setConfirm(null);
    void load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = window.nops.on('note.changed', () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 600);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [path, load]);

  useEffect(() => {
    if (!picked) return;
    let cancelled = false;
    window.nops.history
      .read({ path, id: picked })
      .then((r) => {
        // 그 사이 다른 버전을 골랐으면 늦게 온 답은 버린다
        if (!cancelled) setOld(r.content);
      })
      .catch(() => {
        // 읽지 못하면 이전 화면을 그대로 둔다
      });
    return () => {
      cancelled = true;
    };
  }, [picked, path]);

  const restore = async () => {
    if (!picked || pickedFor !== path) return; // 다른 노트의 이력으로 현재 노트를 덮어쓰지 않는다
    await flushAll();
    const cur = await window.nops.note.read({ path });
    await window.nops.note.save({ path, content: old, baseHash: cur.hash });
    window.dispatchEvent(new CustomEvent('nops:reload-note', { detail: path }));
    onRestored(t('history.restored'));
    setPicked(null);
    void load();
  };

  const diff = picked ? lineDiff(old, current) : [];
  const changed = diff.filter((d) => d.type !== 'same').length;
  const snapDiff = snapPicked ? lineDiff(snapContent, current) : [];
  const snapChanged = snapDiff.filter((d) => d.type !== 'same').length;

  /** 지금 화면 내용을 이름 붙여 저장한다(미저장 편집을 먼저 flush). */
  const saveSnap = async (name: string) => {
    await flushAll();
    const { content } = await window.nops.note.read({ path });
    await window.nops.history.snapshotSave({ path, name, content });
    setSnapNaming(false);
    setSnapDraft('');
    setSnaps(await window.nops.history.snapshotList({ path }));
    onRestored(t('history.snapshot.saved'));
  };

  const openSnap = async (id: string) => {
    if (id === snapPicked) {
      setSnapPicked(null);
      return;
    }
    const r = await window.nops.history.snapshotRead({ path, id });
    setSnapContent(r.content);
    setSnapPicked(id);
    setSnapPickedFor(path);
  };

  const renameSnap = async (id: string) => {
    const name = await showTextPrompt(t('history.snapshot.rename'), snaps.find((s) => s.id === id)?.name ?? '');
    if (name === null) return;
    await window.nops.history.snapshotRename({ path, id, name });
    setSnaps(await window.nops.history.snapshotList({ path }));
  };

  const deleteSnap = async (id: string) => {
    await window.nops.history.snapshotDelete({ path, id });
    if (snapPicked === id) setSnapPicked(null);
    setSnaps(await window.nops.history.snapshotList({ path }));
  };

  const restoreSnap = async () => {
    if (!snapPicked || snapPickedFor !== path) return; // 노트가 바뀌었으면 되돌리지 않는다
    await flushAll();
    const cur = await window.nops.note.read({ path });
    await window.nops.note.save({ path, content: snapContent, baseHash: cur.hash });
    window.dispatchEvent(new CustomEvent('nops:reload-note', { detail: path }));
    onRestored(t('history.restored'));
    setSnapPicked(null);
    void load();
  };

  return (
    <>
    <div className="history" data-testid="panel-history">
      {writer && (
        <section className="snapshots" data-testid="snapshots">
          <div className="snapshots__head">
            <span>{t('history.snapshot.title')}</span>
            <button
              data-testid="snapshot-add"
              onClick={() => {
                setSnapDraft('');
                setSnapNaming(true);
              }}
            >
              {t('history.snapshot.add')}
            </button>
          </div>
          {snapNaming && (
            <div className="snapshots__form">
              <input
                data-testid="snapshot-name"
                autoFocus
                value={snapDraft}
                placeholder={t('history.snapshot.namePlaceholder')}
                onChange={(e) => setSnapDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveSnap(snapDraft);
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setSnapNaming(false);
                  }
                }}
              />
              <button data-testid="snapshot-save" onClick={() => void saveSnap(snapDraft)}>
                {t('history.snapshot.save')}
              </button>
              <button onClick={() => setSnapNaming(false)}>{t('history.snapshot.cancel')}</button>
              <div className="snapshots__quick">
                {QUICK_NAMES.map(([key]) => (
                  <button key={key} data-testid="snapshot-quick" onClick={() => setSnapDraft(t(key))}>
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {snaps.length === 0 ? (
            <p className="muted small pad">{t('history.snapshot.empty')}</p>
          ) : (
            <ul className="history__list">
              {snaps.map((s) => (
                <li key={s.id} className="snapshots__row">
                  <button className={s.id === snapPicked ? 'active' : ''} onClick={() => void openSnap(s.id)} data-testid="snapshot-entry">
                    <b>{s.name}</b> <span className="muted small">{fmt(s.time)} · {s.size}B</span>
                  </button>
                  <button className="snapshots__more" title={t('history.snapshot.rename')} data-testid="snapshot-rename" onClick={() => void renameSnap(s.id)}>
                    ⋯
                  </button>
                  <button className="snapshots__more" title={t('history.snapshot.delete')} data-testid="snapshot-delete" onClick={() => setConfirm({ kind: 'delete', id: s.id })}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {snapPicked && (
            <div className="history__diff">
              <div className="history__bar">
                <span className="muted small">{snapChanged === 0 ? t('history.same') : tPlural('history.diff', snapChanged)}</span>
                <button data-testid="snapshot-restore" disabled={snapChanged === 0} onClick={() => setConfirm({ kind: 'restore' })}>
                  {t('history.restore')}
                </button>
              </div>
              <pre data-testid="snapshot-diff">
                {snapDiff.map((d, i) => (
                  <div key={i} className={`diff-${d.type}`}>
                    {d.type === 'add' ? '+ ' : d.type === 'del' ? '- ' : '  '}
                    {d.text}
                  </div>
                ))}
              </pre>
            </div>
          )}
        </section>
      )}
      {snaps.length > 0 && <div className="snapshots__sep muted small">{t('history.snapshot.auto')}</div>}
      {entries.length === 0 && <p className="muted small pad">{t('history.empty')}</p>}
      <ul className="history__list">
        {entries.map((e) => (
          <li key={e.id}>
            <button
              className={e.id === picked ? 'active' : ''}
              onClick={() => {
                // 선택 시점의 노트 경로를 함께 기록한다(노트가 바뀌면 복원 중단).
                const next = e.id === picked ? null : e.id;
                setPicked(next);
                setPickedFor(next === null ? null : path);
              }}
              data-testid="history-entry"
            >
              {fmt(e.time)} <span className="muted small">{e.size}B</span>
            </button>
          </li>
        ))}
      </ul>
      {picked && (
        <div className="history__diff">
          <div className="history__bar">
            <span className="muted small">{changed === 0 ? t('history.same') : tPlural('history.diff', changed)}</span>
            <button onClick={() => void restore()} disabled={changed === 0} data-testid="history-restore">
              {t('history.restore')}
            </button>
          </div>
          <pre data-testid="history-diff">
            {diff.map((d, i) => (
              <div key={i} className={`diff-${d.type}`}>
                {d.type === 'add' ? '+ ' : d.type === 'del' ? '- ' : '  '}
                {d.text}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
    {confirm && (
      <ConfirmDialog
        title={confirm.kind === 'restore' ? t('history.restore') : t('history.snapshot.delete')}
        lines={[t(confirm.kind === 'restore' ? 'history.snapshot.restoreConfirm' : 'history.snapshot.deleteConfirm')]}
        confirmLabel={confirm.kind === 'restore' ? t('history.restore') : t('history.snapshot.delete')}
        tone={confirm.kind === 'delete' ? 'danger' : 'primary'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const kind = confirm.kind;
          setConfirm(null);
          if (kind === 'restore') void restoreSnap();
          else if (confirm.kind === 'delete') void deleteSnap(confirm.id);
        }}
      />
    )}
    </>
  );
}