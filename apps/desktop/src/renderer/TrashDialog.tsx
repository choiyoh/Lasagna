import { formatCompactDateTime, t } from '@nopsidian/i18n';
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

const when = (iso: string) => formatCompactDateTime(iso);

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
      <div className="dialog trashdialog" role="dialog" aria-modal="true" aria-label={t('trash.title')}>
        <h2>🗑 {t('trash.title')}</h2>
        {items === null ? (
          <p className="muted">{t('common.loading')}</p>
        ) : items.length === 0 ? (
          <p className="muted">{t('trash.empty')}</p>
        ) : (
          <ul className="trashdialog__list">
            {items.map((item) => (
              <li key={item.trashId}>
                <span className="trashdialog__name" title={item.path}>
                  {item.isFolder ? '📁 ' : '📄 '}
                  {item.path.replace(/\.md$/i, '')}
                </span>
                <span className="muted small">{when(item.at)}</span>
                <button
                  onClick={async () => {
                    const r = await window.nops.note.restore({ trashId: item.trashId });
                    onRestored(r.path, item.isFolder);
                    load();
                  }}
                >
                  {t('trash.restore')}
                </button>
                <button
                  className="danger"
                  onClick={async () => {
                    await window.nops.trash.purge({ trashId: item.trashId });
                    load();
                  }}
                >
                  {t('trash.purge')}
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
                {t('trash.confirmAll')}
              </button>
            ) : (
              <button onClick={() => setConfirmAll(true)}>{t('trash.emptyAll')}</button>
            ))}
          <button className="primary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
