import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isMcpStdioInvocation, mcpLaunchArgs, mcpScriptPath, mcpStdioArgs } from './mcp-cli';

const EXE = '/Applications/Nopsidian.app/Contents/MacOS/nopsidian';

describe('isMcpStdioInvocation', () => {
  it('--mcp-stdio 가 있으면 참', () => {
    expect(isMcpStdioInvocation([EXE, '--mcp-stdio', '--vault', '/볼트'])).toBe(true);
    expect(isMcpStdioInvocation(['/usr/bin/electron', '.', '--mcp-stdio'])).toBe(true);
    expect(isMcpStdioInvocation(['--vault', '/볼트', '--mcp-stdio'])).toBe(true);
  });
  it('없거나 비슷한 다른 인자면 거짓', () => {
    expect(isMcpStdioInvocation([])).toBe(false);
    expect(isMcpStdioInvocation([EXE, '--vault', '/볼트'])).toBe(false);
    expect(isMcpStdioInvocation([EXE, '--mcp-stdio-extra'])).toBe(false);
  });
});

describe('mcpStdioArgs', () => {
  it('--mcp-stdio 뒤의 인자만 그대로 넘긴다', () => {
    expect(mcpStdioArgs([EXE, '--mcp-stdio', '--vault', '/볼트', '--write', '--write-folder', 'AI'])).toEqual(['--vault', '/볼트', '--write', '--write-folder', 'AI']);
    expect(mcpStdioArgs([EXE, '--mcp-stdio'])).toEqual([]);
    expect(mcpStdioArgs([EXE, '--vault', '/볼트'])).toEqual([]);
  });
});

describe('mcpScriptPath', () => {
  it('패키징된 앱은 resources/ 의 번들을 쓴다', () => {
    expect(mcpScriptPath({ packaged: true, resourcesPath: '/앱/Contents/Resources', appPath: '/앱/Contents/Resources/app.asar' })).toBe(
      path.join('/앱/Contents/Resources', 'nopsidian-mcp.mjs'),
    );
  });
  it('개발 중에는 저장소의 빌드 결과를 쓴다', () => {
    expect(mcpScriptPath({ packaged: false, resourcesPath: '/무시', appPath: '/저장소/apps/desktop' })).toBe(
      path.resolve('/저장소/apps/desktop', '../../packages/mcp/dist/nopsidian-mcp.mjs'),
    );
  });
});

describe('mcpLaunchArgs', () => {
  it('리눅스는 headless 화면 플랫폼을 앞에 붙이고, 다른 OS 는 --mcp-stdio 만', () => {
    expect(mcpLaunchArgs('linux')).toEqual(['--ozone-platform=headless', '--mcp-stdio']);
    expect(mcpLaunchArgs('darwin')).toEqual(['--mcp-stdio']);
    expect(mcpLaunchArgs('win32')).toEqual(['--mcp-stdio']);
  });
  it('launchArgs 로 띄워도 MCP 인자는 --mcp-stdio 뒤의 것만 넘긴다', () => {
    const argv = ['/opt/n/nopsidian', ...mcpLaunchArgs('linux'), '--vault', '/v'];
    expect(isMcpStdioInvocation(argv)).toBe(true);
    expect(mcpStdioArgs(argv)).toEqual(['--vault', '/v']);
  });
});
