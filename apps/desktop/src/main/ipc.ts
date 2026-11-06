import { t } from '@nopsidian/i18n';
import { errorCode } from '@nopsidian/core';
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { contract, type Channel, type ChannelInput, type ChannelOutput } from '@nopsidian/ipc-contract';
import { isTrustedUrl } from './security';

const registered = new Set<number>();
let devServerUrl: string | undefined;

export function configureIpc(opts: { devServerUrl?: string }) {
  devServerUrl = opts.devServerUrl;
}

/** 앱이 만든 창의 webContents만 IPC를 호출할 수 있다. */
export function registerWebContents(wc: WebContents) {
  registered.add(wc.id);
  wc.once('destroyed', () => registered.delete(wc.id));
}

export function assertTrustedSender(e: IpcMainInvokeEvent) {
  const frame = e.senderFrame;
  if (!registered.has(e.sender.id)) throw new Error(t('main.err.unregisteredSender'));
  if (!frame || frame.parent !== null) throw new Error(t('main.err.topFrameOnly'));
  if (!isTrustedUrl(frame.url, devServerUrl)) throw new Error(t('main.err.untrustedOrigin'));
}

/** 계약에 정의된 채널만 등록하고, 발신자·입력·출력을 모두 검증한다. */
export function handle<C extends Channel>(
  channel: C,
  fn: (input: ChannelInput<C>, e: IpcMainInvokeEvent) => Promise<ChannelOutput<C>> | ChannelOutput<C>,
) {
  const def = contract[channel];
  ipcMain.handle(channel, async (e, raw) => {
    assertTrustedSender(e);
    const input = def.input.parse(raw) as ChannelInput<C>;
    try {
      const result = await fn(input, e);
      return def.output.parse(result);
    } catch (error) {
      // 코어는 코드+params 로 던진다 — 렌더러로 넘길 때(표시 경계) 지금 언어로 만들고,
      // 언어를 바꿔 다시 그릴 수 있게 코드도 함께 붙인다.
      const coded = errorCode(error);
      if (!coded) throw error;
      throw Object.assign(new Error(t(coded.key, coded.params)), { key: coded.key, params: coded.params });
    }
  });
}
