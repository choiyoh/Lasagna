import type { WebContents } from 'electron';

/** 저장 성공 뒤 실행할 알림(origin 창에만 external=false). 감시 이벤트와 중복돼도 렌더러는 안전하다. */
export interface SelfSaveSender {
  send(channel: 'note.changed', payload: { path: string; kind: 'change'; external: false }): void;
}

/**
 * 저장을 먼저 수행하고, **성공한 경우에만** 후속 작업(공통 조상·selfWrites 갱신과 자기 저장 알림)을 실행한다.
 * 저장이 던지면 후속은 실행되지 않아 실패한 저장에 알림이 가지 않는다.
 */
export function saveWithSelfNotification<T>(save: () => T, afterSuccess: (result: T) => void): T {
  const result = save();
  afterSuccess(result);
  return result;
}

/** 감시(@parcel/watcher) 이벤트를 기다리지 않고 자기 저장을 origin 창에 바로 알린다. */
export function notifySelfSave(sender: Pick<WebContents, 'send'>, rel: string): void {
  sender.send('note.changed', { path: rel, kind: 'change', external: false });
}
