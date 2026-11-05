/** Electron에는 `window.prompt`가 없으므로 같은 역할을 하는 작은 입력 대화상자. 취소하면 null. */
import { t } from '@nopsidian/i18n';
export function showTextPrompt(message: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'nops-prompt';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const box = document.createElement('form');
    box.className = 'nops-prompt__box';
    const label = document.createElement('label');
    label.textContent = message;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    const actions = document.createElement('div');
    actions.className = 'nops-prompt__actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = t('common.cancel');
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.textContent = t('editor.ok');
    actions.append(cancel, ok);
    label.append(input);
    box.append(label, actions);
    overlay.append(box);

    const done = (result: string | null) => {
      overlay.remove();
      resolve(result);
    };
    box.addEventListener('submit', (e) => (e.preventDefault(), done(input.value)));
    cancel.addEventListener('click', () => done(null));
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) done(null);
    });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') done(null);
    });
    document.body.append(overlay);
    input.focus();
    input.select();
  });
}
