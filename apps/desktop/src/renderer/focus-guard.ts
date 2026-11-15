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
