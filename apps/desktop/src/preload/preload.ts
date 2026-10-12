import { contextBridge, ipcRenderer } from 'electron';
import { contract, events, type Channel, type EventName } from '@nopsidian/ipc-contract';

/** 계약의 채널 `a.b`를 `window.nops.a.b(input)`로 노출한다. 그 외 IPC는 열지 않는다. */
const api: Record<string, Record<string, (input?: unknown) => Promise<unknown>>> = {};
for (const channel of Object.keys(contract) as Channel[]) {
  const [ns, method] = channel.split('.') as [string, string];
  (api[ns] ??= {})[method] = (input?: unknown) => ipcRenderer.invoke(channel, input);
}

const on = (event: EventName, cb: (payload: unknown) => void) => {
  if (!(event in events)) throw new Error(`알 수 없는 이벤트: ${event}`);
  const listener = (_e: unknown, payload: unknown) => cb(payload);
  ipcRenderer.on(event, listener);
  return () => void ipcRenderer.removeListener(event, listener);
};

contextBridge.exposeInMainWorld('nops', { ...api, on });
