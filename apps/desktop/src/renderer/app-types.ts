export interface Toast {
  message: string;
  /** 있으면 "되돌리기" 버튼을 보여 준다 */
  undo?: () => Promise<void>;
}

export interface ConfirmState {
  title: string;
  lines: string[];
  confirmLabel: string;
  onConfirm: () => void;
}
