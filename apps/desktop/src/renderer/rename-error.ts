import { t } from '@nopsidian/i18n';
import { userMessage } from './user-message';

/** 이름 바꾸기 실패를 화면 문구로. 이미 있는 이름이면 그 사실을 분명히 알려 준다. */
export function renameFailureText(e: unknown, auto: boolean, target?: string): string {
  if (auto) return t('entry.renameKeptFile');
  const key = (e as { key?: string } | null)?.key;
  if (key === 'main.err.pathExists') {
    const name = (target ?? '').replace(/\.md$/i, '').split('/').pop() ?? '';
    return name ? t('entry.renameTaken', { name }) : t('entry.renameFailed', { message: userMessage(e) });
  }
  return t('entry.renameFailed', { message: userMessage(e) });
}
