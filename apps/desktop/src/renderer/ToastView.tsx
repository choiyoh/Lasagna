import { t } from '@nopsidian/i18n';
import type { Dispatch, SetStateAction } from 'react';
import type { Toast } from './app-types';
import { userMessage } from './user-message';

/** 화면 아래에 잠깐 뜨는 알림. `undo` 가 있으면 "되돌리기" 버튼이 붙는다. */
export function ToastView({ toast, setToast }: { toast: Toast | null; setToast: Dispatch<SetStateAction<Toast | null>> }) {
  if (!toast) return null;
  return (
    <div className="toast" role="status" aria-live="polite" aria-atomic="true">
      <span>{toast.message}</span>
      {toast.action && (
        <button
          onClick={() => {
            const action = toast.action!;
            setToast(null);
            action.onClick();
          }}
        >
          {toast.action.label}
        </button>
      )}
      {toast.undo && (
        <button
          onClick={() => {
            const undo = toast.undo!;
            setToast(null);
            void undo().catch((e) => setToast({ message: t('toast.undoFailed', { message: userMessage(e) }) }));
          }}
        >
          {t('toast.undo')}
        </button>
      )}
    </div>
  );
}
