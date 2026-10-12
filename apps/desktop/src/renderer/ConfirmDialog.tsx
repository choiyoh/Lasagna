import { useEffect } from 'react';

interface Props {
  title: string;
  lines: string[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 확인 대화상자(Enter 확인, Esc 취소). */
export function ConfirmDialog({ title, lines, confirmLabel, onConfirm, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onConfirm, onCancel]);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <ul>
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        <div className="dialog__actions">
          <button onClick={onCancel}>취소</button>
          <button className="primary" onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
