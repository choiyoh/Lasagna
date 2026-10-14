import { useCallback, useEffect, useState } from 'react';

interface Item {
  trashId: string;
  path: string;
  isFolder: boolean;
  at: string;
}

interface Props {
  onClose: () => void;
  /** 복원 뒤(경로) */
  onRestored: (path: string, isFolder: boolean) => void;
}

const when = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 휴지통: 지운 노트·폴더를 되돌리거나 영구 삭제한다. */
export function TrashDialog({ onClose, onRestored }: Props) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const load = useCallback(() => void window.nops.trash.list().then(setItems), []);
  useEffect(load, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog trashdialog" role="dialog" aria-modal="true" aria-label="휴지통">
        <h2>🗑 휴지통</h2>
        {items === null ? (
          <p className="muted">불러오는 중…</p>
        ) : items.length === 0 ? (
          <p className="muted">휴지통이 비어 있어요.</p>
        ) : (
          <ul className="trashdialog__list">
            {items.map((t) => (
              <li key={t.trashId}>
                <span className="trashdialog__name" title={t.path}>
                  {t.isFolder ? '📁 ' : '📄 '}
                  {t.path.replace(/\.md$/i, '')}
                </span>
                <span className="muted small">{when(t.at)}</span>
                <button
                  onClick={async () => {
                    const r = await window.nops.note.restore({ trashId: t.trashId });
                    onRestored(r.path, t.isFolder);
                    load();
                  }}
                >
                  복원
                </button>
                <button
                  className="danger"
                  onClick={async () => {
                    await window.nops.trash.purge({ trashId: t.trashId });
                    load();
                  }}
                >
                  영구 삭제
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="dialog__actions">
          {items && items.length > 0 &&
            (confirmAll ? (
              <button
                className="danger"
                onClick={async () => {
                  await window.nops.trash.purge({});
                  setConfirmAll(false);
                  load();
                }}
              >
                정말 모두 영구 삭제
              </button>
            ) : (
              <button onClick={() => setConfirmAll(true)}>휴지통 비우기</button>
            ))}
          <button className="primary" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
