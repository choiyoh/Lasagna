// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpSettings } from './McpSettings';
import { storageKey } from './mcp-settings';
import { defaultServerName, type McpInfo } from './mcp-snippet';

let container: HTMLDivElement;
let root: Root | null = null;

const BASE_INFO: McpInfo = {
  script: '/앱/Contents/Resources/nopsidian-mcp.mjs',
  vault: '/내 볼트',
  vaultName: 'Work Notes',
  vaultId: 'vault-a',
  dailyFolder: '일기',
  executable: '/Applications/Nopsidian.app/Contents/MacOS/nopsidian',
  packaged: true,
  launchArgs: ['--mcp-stdio'],
};

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

const render = async () => {
  root = createRoot(container);
  await act(async () => root!.render(<McpSettings onOpenNote={() => {}} onReverted={() => {}} />));
  await flush();
};

const tab = (label: string) => [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((el) => el.textContent === label)!;
const input = (label: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const typeInto = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

let info: McpInfo;

beforeEach(() => {
  info = { ...BASE_INFO };
  container = document.createElement('div');
  document.body.append(container);
  localStorage.clear();
  Object.defineProperty(window, 'nops', {
    configurable: true,
    value: { mcp: { info: vi.fn(async () => info), audit: vi.fn(async () => []), revert: vi.fn() } },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
});

describe('McpSettings', () => {
  it('클라이언트 탭 6종을 보여 주고 기본은 Claude Code 사용자 범위 명령이다', async () => {
    await render();
    expect([...container.querySelectorAll('[role="tab"]')].map((el) => el.textContent)).toEqual([
      'Claude Code',
      'Claude Desktop',
      'Codex',
      'Cursor',
      'VS Code',
      'Gemini CLI',
    ]);
    expect(input('MCP 서버 이름').value).toBe(defaultServerName(info));
    const cli = container.querySelector('[data-testid="mcp-cli"]')?.textContent ?? '';
    expect(cli).toContain(`claude mcp add -s user ${defaultServerName(info)}`);
    expect(cli).toContain('--mcp-stdio');
  });

  it('탭을 바꾸면 그 클라이언트 형식이 보이고 선택이 이 볼트에 저장된다', async () => {
    await render();
    await act(async () => tab('Codex').click());
    const codex = container.querySelector('[data-testid="mcp-code-codex"]')?.textContent ?? '';
    expect(codex).toContain(`[mcp_servers."${defaultServerName(info)}"]`);
    expect(JSON.parse(localStorage.getItem(storageKey('vault-a'))!)).toMatchObject({ client: 'codex' });
    await act(async () => tab('VS Code').click());
    expect(JSON.parse(container.querySelector('[data-testid="mcp-code-vscode"]')!.textContent!)).toMatchObject({
      servers: { [defaultServerName(info)]: { type: 'stdio' } },
    });
  });

  it('오늘의 노트 폴더를 켜면 스니펫에 폴더가 추가되고, 끄면 실패 이유를 보여 준다', async () => {
    await render();
    expect(container.querySelector('[data-testid="mcp-daily-warning"]')).toBeNull();
    await act(async () => input('에이전트가 노트 쓰기 허용').click());
    expect(container.querySelector('[data-testid="mcp-daily-warning"]')?.textContent).toContain('forbidden-folder');
    expect(container.querySelector('[data-testid="mcp-cli"]')?.textContent).not.toContain('--write-folder "일기"');
    await act(async () => input('오늘의 노트 폴더도 허용').click());
    expect(container.querySelector('[data-testid="mcp-daily-warning"]')).toBeNull();
    expect(container.querySelector('[data-testid="mcp-cli"]')?.textContent).toContain('--write-folder "AI" --write-folder "일기"');
  });

  it('다른 볼트가 같은 이름을 쓰면 경고한다', async () => {
    localStorage.setItem(storageKey('vault-b'), JSON.stringify({ name: defaultServerName(info) }));
    await render();
    expect(container.querySelector('[data-testid="mcp-name-conflict"]')?.textContent).toContain('덮어써요');
  });

  it('이름에 공백을 넣으면 경고한다', async () => {
    await render();
    await typeInto(input('MCP 서버 이름'), '내 서버');
    expect(container.querySelector('[data-testid="mcp-name-warning"]')?.textContent).toContain('공백 없이');
    // 잘못된 이름으로는 붙여 넣을 스니펫을 만들지 않는다(CLI 옵션 오인 방지)
    expect(container.querySelector('[data-testid="mcp-cli"]')).toBeNull();
  });

  it('쓸 수 없는 폴더면 이유를 보여 주고 스니펫을 만들지 않는다', async () => {
    await render();
    await act(async () => input('에이전트가 노트 쓰기 허용').click());
    await typeInto(input('쓸 수 있는 폴더'), '..');
    expect(container.querySelector('[data-testid="mcp-folder-warning"]')?.textContent).toContain('쓰기 폴더');
    expect(container.querySelector('[data-testid="mcp-cli"]')).toBeNull();
    await typeInto(input('쓸 수 있는 폴더'), 'AI/하위');
    expect(container.querySelector('[data-testid="mcp-folder-warning"]')).toBeNull();
    expect(container.querySelector('[data-testid="mcp-cli"]')?.textContent).toContain('--write-folder "AI/하위"');
  });

  it('데일리 폴더가 허용 폴더의 하위면 경고도 중복 인자도 없다', async () => {
    info = { ...BASE_INFO, dailyFolder: '일기/2026' };
    await render();
    await act(async () => input('에이전트가 노트 쓰기 허용').click());
    await typeInto(input('쓸 수 있는 폴더'), '일기');
    await act(async () => input('오늘의 노트 폴더도 허용').click());
    expect(container.querySelector('[data-testid="mcp-daily-warning"]')).toBeNull();
    const cli = container.querySelector('[data-testid="mcp-cli"]')?.textContent ?? '';
    expect(cli).toContain('--write-folder "일기"');
    expect(cli).not.toContain('--write-folder "일기/2026"');
  });
});
