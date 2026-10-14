import { useCallback, useEffect, useState } from 'react';
import type { HistoryEntryDto } from './history-types';
import { lineDiff } from '@nopsidian/core/diff';
import { flushAll } from './flush';

interface Props {
  path: string;
  /** 복원이 끝나면 호출 */
  onRestored: (message: string) => void;
}

const fmt = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/** 오른쪽 패널 "기록": 저장 때마다 남긴 이전 버전 목록, 현재 내용과의 줄 단위 비교, 복원. */
export function HistoryPanel({ path, onRestored }: Props) {
  const [entries, setEntries] = useState<HistoryEntryDto[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [old, setOld] = useState('');
  const [current, setCurrent] = useState('');

  const load = useCallback(async () => {
    setEntries(await window.nops.history.list({ path }));
    setCurrent((await window.nops.note.read({ path })).content);
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
    void window.nops.history.read({ path, id: picked }).then((r) => setOld(r.content));
  }, [picked, path]);

  const restore = async () => {
    if (!picked) return;
    await flushAll();
    const cur = await window.nops.note.read({ path });
    await window.nops.note.save({ path, content: old, baseHash: cur.hash });
    window.dispatchEvent(new CustomEvent('nops:reload-note', { detail: path }));
    onRestored('이전 버전으로 되돌렸어요. 되돌리기 직전 내용도 기록에 남아 있어요.');
    setPicked(null);
    void load();
  };

  const diff = picked ? lineDiff(old, current) : [];
  const changed = diff.filter((d) => d.type !== 'same').length;

  return (
    <div className="history" data-testid="panel-history">
      {entries.length === 0 && <p className="muted small pad">아직 기록이 없어요. 노트를 고치면 저장할 때마다 이전 버전이 남아요.</p>}
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
            <span className="muted small">{changed === 0 ? '현재와 같아요' : `현재와 ${changed}줄이 달라요 (빨강: 이 버전 / 초록: 현재)`}</span>
            <button onClick={() => void restore()} disabled={changed === 0} data-testid="history-restore">
              이 버전으로 복원
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
