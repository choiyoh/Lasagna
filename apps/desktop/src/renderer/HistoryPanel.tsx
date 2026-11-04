import { formatShortDateTime, t } from '@nopsidian/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryEntryDto } from './history-types';
import { lineDiff } from '@nopsidian/core/diff';
import { flushAll } from './flush';

interface Props {
  path: string;
  /** 복원이 끝나면 호출 */
  onRestored: (message: string) => void;
}

const fmt = (iso: string) => formatShortDateTime(iso, { seconds: true });

/** 오른쪽 패널 "기록": 저장 때마다 남긴 이전 버전 목록, 현재 내용과의 줄 단위 비교, 복원. */
export function HistoryPanel({ path, onRestored }: Props) {
  const [entries, setEntries] = useState<HistoryEntryDto[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [old, setOld] = useState('');
  const [current, setCurrent] = useState('');
  /** 다시 읽기를 여러 번 요청했을 때 늦게 도착한 이전 결과를 버리기 위한 번호 */
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const list = await window.nops.history.list({ path });
      if (seq !== loadSeq.current) return;
      setEntries(list);
      const { content } = await window.nops.note.read({ path });
      if (seq !== loadSeq.current) return;
      setCurrent(content);
    } catch {
      // 읽지 못하면 이전 화면을 그대로 둔다(다음 변경 알림에서 다시 시도한다)
    }
  }, [path]);

  useEffect(() => {
    setPicked(null);
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
    if (!picked) return;
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

  return (
    <div className="history" data-testid="panel-history">
      {entries.length === 0 && <p className="muted small pad">{t('history.empty')}</p>}
      <ul className="history__list">
        {entries.map((e) => (
          <li key={e.id}>
            <button className={e.id === picked ? 'active' : ''} onClick={() => setPicked(e.id === picked ? null : e.id)} data-testid="history-entry">
              {fmt(e.time)} <span className="muted small">{e.size}B</span>
            </button>
          </li>
        ))}
      </ul>
      {picked && (
        <div className="history__diff">
          <div className="history__bar">
            <span className="muted small">{changed === 0 ? t('history.same') : t('history.diff', { n: changed })}</span>
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
  );
}
