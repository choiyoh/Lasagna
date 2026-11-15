/**
 * 늦은(rAF) 포커스 복귀가 새로 열린 화면의 초기 포커스를 덮지 않게 하는 공용 가드.
 * 대화상자·팔레트·프롬프트가 열려 있거나 포커스가 입력·대화상자 안이면 복귀하지 않는다.
 */
const OVERLAY = '.dialog-backdrop, .switcher, .nops-prompt, .ctxmask';

export function canRestoreFocus(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.querySelector(OVERLAY)) return false;
  const active = document.activeElement;
  if (active instanceof HTMLElement && (active.isContentEditable || active.closest(OVERLAY))) return false;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return false;
  return true;
}

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 대화상자 안에서 Tab/Shift+Tab 이 밖으로 나가지 않게 첫/끝에서 감는다.
 * 포커스가 대화상자 밖에 있으면 첫 컨트롤로 되돌린다.
 */
export function trapFocus(event: { key: string; shiftKey: boolean; preventDefault(): void }, container: HTMLElement | null): void {
  if (event.key !== 'Tab' || !container) return;
  const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!active || !container.contains(active)) {
    event.preventDefault();
    first?.focus();
    return;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first?.focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last?.focus();
  }
}
