export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  message: string;
  /** 있으면 "되돌리기" 버튼을 보여 준다 */
  undo?: () => Promise<void>;
  /** 있으면 동작 버튼을 보여 준다(예: 필터 지우기) */
  action?: ToastAction;
  /** 자동으로 사라지기까지의 ms. 없으면 undo=10초, 그 외 4초 */
  duration?: number;
}

export interface ConfirmState {
  title: string;
  lines: string[];
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
}
