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
  if (!registered.has(e.sender.id)) throw new Error('등록되지 않은 webContents');
  if (!frame || frame.parent !== null) throw new Error('최상위 프레임만 허용');
  if (!isTrustedUrl(frame.url, devServerUrl)) throw new Error('신뢰할 수 없는 오리진');
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
    const result = await fn(input, e);
    return def.output.parse(result);
  });
}
