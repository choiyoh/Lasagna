import { useSyncExternalStore } from 'react';
import type { AppLanguage } from '@nopsidian/ipc-contract';
import { getLanguage, subscribeLanguage } from './language';

/** 언어가 바뀌면 다시 렌더한다. App 이 한 번 구독해 트리 전체를 갱신한다. */
export function useLocale(): 'ko' | 'en' {
  return useSyncExternalStore(subscribeLanguage, () => getLanguage().locale, () => 'ko');
}

/** 설정 라디오처럼 "무엇을 따르는지"까지 봐야 하는 화면용. */
export function useLanguage(): AppLanguage {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}
