import { t } from '@nopsidian/i18n';

/**
 * 워커가 던지는 분류 가능한 오류들. 화면·메인은 문구가 아니라 `key`/`code` 로 판정한다
 * (문구는 언어에 따라 바뀌므로 매칭에 쓰지 않는다).
 */
export const syncBusyError = () => Object.assign(new Error(t('main.err.syncBusy')), { key: 'busy', code: 'BUSY' });
