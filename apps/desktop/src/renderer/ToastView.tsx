import type { Dispatch, SetStateAction } from 'react';
import type { Toast } from './app-types';

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
            void undo().catch((e) => setToast({ message: `되돌리지 못했어요: ${e instanceof Error ? e.message : String(e)}` }));
          }}
        >
          되돌리기
        </button>
      )}
    </div>
  );
}
