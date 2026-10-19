import { describe, expect, it } from 'vitest';
import { mcpSnippet, shellQuote, type McpInfo } from './mcp-snippet';

const packaged = (over: Partial<McpInfo> = {}): McpInfo => ({
  script: '/앱/Contents/Resources/nopsidian-mcp.mjs',
  vault: '/내 볼트',
  executable: '/Applications/Nopsidian.app/Contents/MacOS/nopsidian',
  packaged: true,
  launchArgs: ['--mcp-stdio'],
  ...over,
});

const dev = (over: Partial<McpInfo> = {}): McpInfo => packaged({ packaged: false, executable: '/usr/local/bin/electron', ...over });

describe('mcpSnippet', () => {
  it('서버 파일이 없으면 null', () => {
    expect(mcpSnippet(packaged({ script: null }), { write: false, folder: 'AI' })).toBeNull();
  });

  it('패키징된 앱은 앱 실행 파일 + --mcp-stdio 로 연결한다', () => {
    const s = mcpSnippet(packaged(), { write: false, folder: 'AI' })!;
    expect(s.command).toBe('/Applications/Nopsidian.app/Contents/MacOS/nopsidian');
    expect(s.args).toEqual(['--mcp-stdio', '--vault', '/내 볼트']);
    expect(s.cli).toBe('claude mcp add nopsidian -- "/Applications/Nopsidian.app/Contents/MacOS/nopsidian" --mcp-stdio --vault "/내 볼트"');
    expect(JSON.parse(s.json)).toEqual({ mcpServers: { nopsidian: { command: s.command, args: s.args } } });
    expect(s.cli).not.toContain('node');
  });

  it('개발 빌드는 지금처럼 node 로 번들을 실행한다', () => {
    const s = mcpSnippet(dev(), { write: false, folder: 'AI' })!;
    expect(s.command).toBe('node');
    expect(s.args).toEqual(['/앱/Contents/Resources/nopsidian-mcp.mjs', '--vault', '/내 볼트']);
    expect(s.cli).toBe('claude mcp add nopsidian -- node "/앱/Contents/Resources/nopsidian-mcp.mjs" --vault "/내 볼트"');
    expect(s.args).not.toContain('--mcp-stdio');
  });

  it('쓰기 허용이면 두 형태 모두 --write 와 폴더를 붙인다', () => {
    const s = mcpSnippet(packaged(), { write: true, folder: '메모/AI/' })!;
    expect(s.args).toEqual(['--mcp-stdio', '--vault', '/내 볼트', '--write', '--write-folder', '메모/AI']);
    expect(s.cli).toContain('--write --write-folder "메모/AI"');
    const all = mcpSnippet(packaged(), { write: true, folder: '  ' })!;
    expect(all.args.at(-1)).toBe('.');
    expect(JSON.parse(all.json).mcpServers.nopsidian.args.at(-1)).toBe('.');
  });

  it('경로의 공백·큰따옴표·역슬래시를 안전하게 감싼다', () => {
    const exe = String.raw`C:\Program Files\Nopsidian\nopsidian.exe`;
    const s = mcpSnippet(packaged({ executable: exe, vault: '/볼트 "A"' }), { write: false, folder: 'AI' })!;
    expect(s.cli).toContain(`${shellQuote(exe)} --mcp-stdio --vault ${shellQuote('/볼트 "A"')}`);
    expect(JSON.parse(s.json).mcpServers.nopsidian.command).toBe(exe);
  });

  it('shellQuote: 따옴표·역슬래시·$·백틱을 이스케이프한다', () => {
    expect(shellQuote('그냥 경로')).toBe('"그냥 경로"');
    expect(shellQuote(String.raw`C:\Program Files\nopsidian.exe`)).toBe(String.raw`"C:\\Program Files\\nopsidian.exe"`);
    expect(shellQuote('따옴표"와 $달러 `백틱`')).toBe(String.raw`"따옴표\"와 \$달러 \`백틱\`"`);
  });
});

describe('mcpSnippet — 리눅스', () => {
  it('화면 없는 리눅스에서도 뜨도록 launchArgs(--ozone-platform=headless)를 앞에 붙인다', () => {
    const s = mcpSnippet(packaged({ executable: '/opt/Nopsidian/nopsidian', launchArgs: ['--ozone-platform=headless', '--mcp-stdio'] }), { write: false, folder: 'AI' })!;
    expect(s.args).toEqual(['--ozone-platform=headless', '--mcp-stdio', '--vault', '/내 볼트']);
    expect(s.cli).toBe('claude mcp add nopsidian -- "/opt/Nopsidian/nopsidian" --ozone-platform=headless --mcp-stdio --vault "/내 볼트"');
  });
});
