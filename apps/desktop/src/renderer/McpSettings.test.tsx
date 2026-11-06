// @vitest-environment jsdom
import { act } from 'react';
import { setLocale } from '@nopsidian/i18n';
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
let policyGet: ReturnType<typeof vi.fn>;
let policySet: ReturnType<typeof vi.fn>;

beforeEach(() => {
  info = { ...BASE_INFO };
  policyGet = vi.fn(async () => ({ exists: false, policy: null, error: null }));
  policySet = vi.fn(async (p: { write: boolean; writeFolders: string[]; maxWritesPerMinute: number }) => ({ version: 1 as const, ...p }));
  container = document.createElement('div');
  document.body.append(container);
  localStorage.clear();
  Object.defineProperty(window, 'nops', {
    configurable: true,
    value: { mcp: { info: vi.fn(async () => info), audit: vi.fn(async () => []), revert: vi.fn(), policyGet, policySet } },
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

  it('정책 파일이 있으면 localStorage 값보다 우선하고 이미 연결된 에이전트 안내를 보여 준다', async () => {
    localStorage.setItem(storageKey('vault-a'), JSON.stringify({ write: false, folder: '옛 폴더' }));
    policyGet.mockResolvedValue({
      exists: true,
      policy: { version: 1, write: true, writeFolders: ['메모', '일기'], maxWritesPerMinute: 7 },
      error: null,
    });
    await render();
    expect(input('에이전트가 노트 쓰기 허용').checked).toBe(true);
    expect(input('쓸 수 있는 폴더').value).toBe('메모');
    expect(input('오늘의 노트 폴더도 허용').checked).toBe(true);
    expect(container.querySelector('[data-testid="mcp-policy-note"]')?.textContent).toContain('이미 연결된 에이전트');
    // 파일 경로는 base 처럼 <code> 로 강조한다(문구만 사전으로 옮겼다)
    expect(container.querySelector('[data-testid="mcp-policy-note"] code')?.textContent).toBe('.nopsidian/mcp-policy.json');
    expect(container.querySelector('[data-testid="mcp-policy-missing"]')).toBeNull();
    expect(container.querySelector('[data-testid="mcp-policy-device-note"]')?.textContent).toContain('다른 기기');
    expect(container.querySelector('[data-testid="mcp-cli"]')?.textContent).toContain('--write-folder "메모" --write-folder "일기"');
  });

  it('정책 파일이 없으면 인자 기반 동작을 안내하고 현재 값으로 파일을 만들 수 있다', async () => {
    await render();
    const missing = container.querySelector('[data-testid="mcp-policy-missing"]');
    expect(missing?.textContent).toContain('에이전트 연결 인자');
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="mcp-policy-create"]')!.click());
    await flush();
    expect(policySet).toHaveBeenCalledWith({ write: false, writeFolders: ['AI'], maxWritesPerMinute: 30 });
    expect(container.querySelector('[data-testid="mcp-policy-missing"]')).toBeNull();
  });

  it('정책 파일이 없어도 쓰기를 끄면 곧바로 write=false 파일을 만든다', async () => {
    localStorage.setItem(storageKey('vault-a'), JSON.stringify({ write: true, folder: 'AI', allowDailyFolder: false, name: 'nopsidian-a', client: 'claude-code' }));
    await render();
    expect(input('에이전트가 노트 쓰기 허용').checked).toBe(true);
    await act(async () => input('에이전트가 노트 쓰기 허용').click());
    await flush();
    expect(policySet).toHaveBeenCalledWith({ write: false, writeFolders: ['AI'], maxWritesPerMinute: 30 });
    expect(container.querySelector('[data-testid="mcp-policy-missing"]')).toBeNull();
  });

  it('스위치를 켜면 정책 파일을 쓰기 허용과 폴더로 저장한다', async () => {
    await render();
    await act(async () => input('에이전트가 노트 쓰기 허용').click());
    await flush();
    expect(policySet).toHaveBeenCalledWith({ write: true, writeFolders: ['AI'], maxWritesPerMinute: 30 });
  });

  it('정책 파일이 깨졌으면 쓰기를 꺼진 것으로 보여 주고 이유를 알린다', async () => {
    policyGet.mockResolvedValue({ exists: true, policy: null, error: '정책 파일이 올바른 JSON 이 아니에요' });
    await render();
    expect(input('에이전트가 노트 쓰기 허용').checked).toBe(false);
    expect(container.querySelector('[data-testid="mcp-policy-warning"]')?.textContent).toContain('올바른 JSON');
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

describe('되돌리기 오류의 로캘', () => {
  it('알려진 실패 코드는 화면 언어로 보여 주고, 언어를 바꾸면 다시 번역한다', async () => {
    const audit = [
      { t: '2026-11-05T00:00:00.000Z', client: 'claude', action: 'update' as const, tool: 'write_note', path: 'a.md' },
    ];
    (window.nops.mcp.audit as ReturnType<typeof vi.fn>).mockImplementation(async () => audit);
    (window.nops.mcp.revert as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ kind: 'failed', code: 'changed' }));
    await render();

    const undo = container.querySelector<HTMLButtonElement>('[data-testid="mcp-revert"]')!;
    await act(async () => undo.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="mcp-revert-confirm"]')!.click());
    await flush();
    const msg = () => container.querySelector('[data-testid="mcp-revert-msg"]')?.textContent ?? '';
    expect(msg()).toContain('버전 기록에서 복원');

    setLocale('en');
    await act(async () => root!.render(<McpSettings onOpenNote={() => {}} onReverted={() => {}} />));
    expect(msg()).toContain('version history');
    expect(msg()).not.toMatch(/[가-힣]/);
    setLocale('ko');
  });
});

describe('오류 문구에 자리표시자가 새지 않는다', () => {
  it('savePolicy 경로 전수: ko/en 모두 {…} 리터럴이 없다', async () => {
    // 정책 파일 읽기/스키마 오류
    for (const err of [
      { exists: true, policy: null, error: '깨짐', errorCode: 'invalidJson' },
      { exists: true, policy: null, error: '형식', errorCode: 'invalidSchema', errorParams: { path: 'write', message: 'bad' } },
      { exists: true, policy: null, error: '읽기', errorCode: 'unreadable', errorParams: { message: 'EACCES' } },
    ]) {
      policyGet.mockImplementation(async () => err);
      await render();
      const warn = container.querySelector('[data-testid="mcp-policy-warning"]')?.textContent ?? '';
      expect(warn).not.toMatch(/[{}]/);
      setLocale('en');
      await act(async () => root!.render(<McpSettings onOpenNote={() => {}} onReverted={() => {}} />));
      expect(container.querySelector('[data-testid="mcp-policy-warning"]')?.textContent ?? '').not.toMatch(/[{}]/);
      setLocale('ko');
      act(() => root!.unmount());
      root = null;
      container.remove();
      container = document.createElement('div');
      document.body.append(container);
    }
  });

  it('쓰기를 켠 채 폴더를 비우면 폴더 이름이 문장에 채워진다(리터럴 없음)', async () => {
    await render();
    const write = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => write.click());
    await typeInto(input('쓸 수 있는 폴더'), '');
    // 저장 버튼(정책 만들기)이 없으면 토글에서 저장 경로를 타지 않으므로, 안내 문구로 대체 확인
    // 저장 경로(savePolicy)를 실제로 타도록 토글을 껐다 켠다
    await act(async () => write.click());
    await act(async () => write.click());
    const koText = container.textContent ?? '';
    expect(koText).not.toMatch(/[{}]/);
    setLocale('en');
    await act(async () => root!.render(<McpSettings onOpenNote={() => {}} onReverted={() => {}} />));
    const enText = container.textContent ?? '';
    expect(enText).not.toMatch(/[{}]/);
    expect(enText).not.toMatch(/\{issue\}/);
    setLocale('ko');
  });
});
