import { describe, expect, it } from 'vitest';
import { defaultServerName, isValidServerName, mcpSnippet, shellQuote, snippetWriteFolders, type McpInfo, type McpSnippetOptions } from './mcp-snippet';

const packaged = (over: Partial<McpInfo> = {}): McpInfo => ({
  script: '/앱/Contents/Resources/nopsidian-mcp.mjs',
  vault: '/내 볼트',
  vaultName: 'Work Notes',
  vaultId: 'abc123def456',
  dailyFolder: '일기',
  executable: '/Applications/Nopsidian.app/Contents/MacOS/nopsidian',
  packaged: true,
  launchArgs: ['--mcp-stdio'],
  ...over,
});

const dev = (over: Partial<McpInfo> = {}): McpInfo => packaged({ packaged: false, executable: '/usr/local/bin/electron', ...over });

const opts = (over: Partial<McpSnippetOptions> = {}): McpSnippetOptions => ({
  write: false,
  folder: 'AI',
  allowDailyFolder: false,
  dailyFolder: '일기',
  name: '',
  ...over,
});

const NAME = defaultServerName({ vaultName: 'Work Notes', vaultId: 'abc123def456' });

describe('mcpSnippet', () => {
  it('서버 파일이 없으면 null', () => {
    expect(mcpSnippet(packaged({ script: null }), opts())).toBeNull();
  });

  it('패키징된 앱은 앱 실행 파일 + --mcp-stdio 로 연결한다', () => {
    const s = mcpSnippet(packaged(), opts())!;
    expect(s.command).toBe('/Applications/Nopsidian.app/Contents/MacOS/nopsidian');
    expect(s.args).toEqual(['--mcp-stdio', '--vault', '/내 볼트']);
    expect(s.cli).toBe(`claude mcp add -s user ${NAME} -- "/Applications/Nopsidian.app/Contents/MacOS/nopsidian" --mcp-stdio --vault "/내 볼트"`);
    expect(s.cli).not.toContain('-- node ');
    expect(JSON.parse(s.json)).toEqual({ mcpServers: { [NAME]: { command: s.command, args: s.args } } });
  });

  it('개발 빌드는 node 로 번들을 실행한다', () => {
    const s = mcpSnippet(dev(), opts())!;
    expect(s.command).toBe('node');
    expect(s.args).toEqual(['/앱/Contents/Resources/nopsidian-mcp.mjs', '--vault', '/내 볼트']);
    expect(s.cli).toBe(`claude mcp add -s user ${NAME} -- node "/앱/Contents/Resources/nopsidian-mcp.mjs" --vault "/내 볼트"`);
    expect(s.args).not.toContain('--mcp-stdio');
  });

  it('Claude Code 명령은 사용자 범위(-s user)를 쓴다', () => {
    const s = mcpSnippet(packaged(), opts())!;
    expect(s.cli.startsWith('claude mcp add -s user ')).toBe(true);
    expect(s.clients.find((c) => c.id === 'claude-code')!.code).toBe(s.cli);
  });

  it('쓰기 허용이면 --write 와 폴더를 붙인다', () => {
    const s = mcpSnippet(packaged(), opts({ write: true, folder: '메모/AI/' }))!;
    expect(s.args).toEqual(['--mcp-stdio', '--vault', '/내 볼트', '--write', '--write-folder', '메모/AI']);
    expect(s.cli).toContain('--write --write-folder "메모/AI"');
    const all = mcpSnippet(packaged(), opts({ write: true, folder: '  ' }))!;
    expect(all.args.at(-1)).toBe('.');
    expect(JSON.parse(all.json).mcpServers[NAME].args.at(-1)).toBe('.');
  });

  it('오늘의 노트 폴더를 허용하면 --write-folder 를 하나 더 붙인다', () => {
    const s = mcpSnippet(packaged(), opts({ write: true, allowDailyFolder: true, dailyFolder: '저널' }))!;
    expect(s.args).toEqual(['--mcp-stdio', '--vault', '/내 볼트', '--write', '--write-folder', 'AI', '--write-folder', '저널']);
    expect(s.cli).toContain('--write-folder "AI" --write-folder "저널"');
  });

  it('데일리 폴더가 이미 허용 범위면 중복해서 넣지 않는다', () => {
    expect(snippetWriteFolders({ write: true, folder: 'AI', allowDailyFolder: true, dailyFolder: 'AI' })).toEqual(['AI']);
    expect(snippetWriteFolders({ write: true, folder: '.', allowDailyFolder: true, dailyFolder: '일기' })).toEqual(['']);
    expect(snippetWriteFolders({ write: true, folder: 'AI', allowDailyFolder: false, dailyFolder: '일기' })).toEqual(['AI']);
    expect(snippetWriteFolders({ write: false, folder: 'AI', allowDailyFolder: true, dailyFolder: '일기' })).toEqual([]);
    // 상위 폴더가 하위 데일리 폴더를 덮는다(policy.canWrite 와 같은 판정)
    expect(snippetWriteFolders({ write: true, folder: 'Daily', allowDailyFolder: true, dailyFolder: 'Daily/2026' })).toEqual(['Daily']);
    expect(snippetWriteFolders({ write: true, folder: 'Daily/2026', allowDailyFolder: true, dailyFolder: 'Daily' })).toEqual(['Daily/2026', 'Daily']);
    expect(snippetWriteFolders({ write: true, folder: 'AI', allowDailyFolder: true, dailyFolder: 'AIx' })).toEqual(['AI', 'AIx']);
  });

  it('쓰기 폴더를 서버 정책과 같은 규칙으로 검증한다', () => {
    for (const bad of ['..', '.trash', 'AI/./sub', 'AI/../etc', 'AI//sub']) {
      expect(() => snippetWriteFolders({ write: true, folder: bad, allowDailyFolder: false, dailyFolder: '일기' }), bad).toThrow(/쓰기 폴더/);
      expect(mcpSnippet(packaged(), opts({ write: true, folder: bad })), bad).toBeNull();
    }
    expect(snippetWriteFolders({ write: true, folder: ' 메모\\AI/ ', allowDailyFolder: false, dailyFolder: '일기' })).toEqual(['메모/AI']);
    expect(snippetWriteFolders({ write: true, folder: '/', allowDailyFolder: true, dailyFolder: '일기' })).toEqual(['']);
    expect(mcpSnippet(packaged(), opts({ write: true, folder: '메모/AI' }))).not.toBeNull();
  });

  it('이름을 바꾸면 6종 스니펫 모두에 그 이름이 들어간다', () => {
    const s = mcpSnippet(packaged(), opts({ write: true, name: 'my-vault' }))!;
    expect(s.name).toBe('my-vault');
    expect(s.clients).toHaveLength(6);
    expect(s.clients.map((c) => c.id)).toEqual(['claude-code', 'claude-desktop', 'codex', 'cursor', 'vscode', 'gemini-cli']);
    expect(s.clients.find((c) => c.id === 'claude-desktop')!.code).toContain('"my-vault"');
    expect(s.clients.find((c) => c.id === 'codex')!.code).toContain('[mcp_servers."my-vault"]');
    expect(s.clients.find((c) => c.id === 'vscode')!.code).toContain('"my-vault"');
    expect(s.clients.find((c) => c.id === 'cursor')!.code).toContain('"my-vault"');
    expect(s.clients.find((c) => c.id === 'gemini-cli')!.code).toContain('"my-vault"');
    expect(s.clients.find((c) => c.id === 'claude-code')!.code).toContain('my-vault');
  });

  it('Codex 는 TOML [mcp_servers."<이름>"] 형식이다', () => {
    const code = mcpSnippet(packaged(), opts({ write: true, allowDailyFolder: true }))!.clients.find((c) => c.id === 'codex')!;
    expect(code.format).toBe('toml');
    expect(code.target).toBe('~/.codex/config.toml');
    expect(code.code).toContain(`[mcp_servers."${NAME}"]`);
    expect(code.code).toContain('command = "/Applications/Nopsidian.app/Contents/MacOS/nopsidian"');
    expect(code.code).toContain('args = ["--mcp-stdio", "--vault", "/내 볼트", "--write", "--write-folder", "AI", "--write-folder", "일기"]');
  });

  it('VS Code 는 servers + type:stdio 형식이다', () => {
    const code = mcpSnippet(packaged(), opts())!.clients.find((c) => c.id === 'vscode')!;
    expect(code.target).toBe('.vscode/mcp.json (워크스페이스)');
    expect(JSON.parse(code.code)).toEqual({
      servers: { [NAME]: { type: 'stdio', command: '/Applications/Nopsidian.app/Contents/MacOS/nopsidian', args: ['--mcp-stdio', '--vault', '/내 볼트'] } },
    });
  });

  it('Claude Desktop·Cursor·Gemini CLI 는 mcpServers JSON 형식이다', () => {
    const s = mcpSnippet(packaged(), opts())!;
    for (const id of ['claude-desktop', 'cursor', 'gemini-cli'] as const) {
      const c = s.clients.find((x) => x.id === id)!;
      expect(c.format).toBe('json');
      expect(JSON.parse(c.code).mcpServers[NAME]).toEqual({ command: s.command, args: s.args });
    }
    expect(s.clients.find((c) => c.id === 'claude-desktop')!.target).toContain('claude_desktop_config.json');
    expect(s.clients.find((c) => c.id === 'cursor')!.target).toBe('~/.cursor/mcp.json');
    expect(s.clients.find((c) => c.id === 'gemini-cli')!.target).toBe('~/.gemini/settings.json');
  });

  it('볼트 이름이 ASCII 가 아니면 볼트 id 로 기본 이름을 만든다', () => {
    expect(defaultServerName({ vaultName: 'Work Notes', vaultId: 'abc123def456' })).toBe(NAME);
    expect(defaultServerName({ vaultName: '내 볼트', vaultId: 'abc123def456' })).toMatch(/^lasagna-vault-[a-z0-9]+$/);
    expect(defaultServerName({ vaultName: '  ', vaultId: 'ZZZ' })).toMatch(/^lasagna-vault-[a-z0-9]+$/);
  });

  it('같은 이름의 볼트도 기본 서버 이름이 다르다', () => {
    const a = defaultServerName({ vaultName: 'Work Notes', vaultId: 'abc123def456' });
    const b = defaultServerName({ vaultName: 'Work Notes', vaultId: 'abc123def457' });
    expect(a).not.toBe(b);
    // 슬러그가 32자에서 잘린 뒤 같아져도 해시 접미사로 구분된다
    const x = defaultServerName({ vaultName: `${'a'.repeat(40)}one`, vaultId: 'id-one' });
    const y = defaultServerName({ vaultName: `${'a'.repeat(40)}two`, vaultId: 'id-two' });
    expect(x.slice(0, 'lasagna-'.length + 32)).toBe(y.slice(0, 'lasagna-'.length + 32));
    expect(x).not.toBe(y);
  });

  it('유효하지 않은 서버 이름이면 스니펫을 만들지 않는다', () => {
    expect(mcpSnippet(packaged(), opts({ name: '-옵션처럼보임' }))).toBeNull();
    expect(mcpSnippet(packaged(), opts({ name: '내 서버' }))).toBeNull();
  });

  it('서버 이름은 공백 없는 글자·숫자·._- 만 허용한다', () => {
    expect(isValidServerName('nopsidian-work')).toBe(true);
    expect(isValidServerName('내-볼트_2')).toBe(true);
    expect(isValidServerName('내 볼트')).toBe(false);
    expect(isValidServerName('-시작')).toBe(false);
    expect(isValidServerName('')).toBe(false);
  });

  it('경로의 공백·큰따옴표·역슬래시를 안전하게 감싼다', () => {
    const exe = String.raw`C:\Program Files\Nopsidian\nopsidian.exe`;
    const s = mcpSnippet(packaged({ executable: exe, vault: '/볼트 "A"' }), opts())!;
    expect(s.cli).toContain(`${shellQuote(exe)} --mcp-stdio --vault ${shellQuote('/볼트 "A"')}`);
    expect(JSON.parse(s.json).mcpServers[NAME].command).toBe(exe);
  });

  it('shellQuote: 따옴표·역슬래시·$·백틱을 이스케이프한다', () => {
    expect(shellQuote('그냥 경로')).toBe('"그냥 경로"');
    expect(shellQuote(String.raw`C:\Program Files\nopsidian.exe`)).toBe(String.raw`"C:\\Program Files\\nopsidian.exe"`);
    expect(shellQuote('따옴표"와 $달러 `백틱`')).toBe(String.raw`"따옴표\"와 \$달러 \`백틱\`"`);
  });
});

describe('mcpSnippet — 리눅스', () => {
  it('화면 없는 리눅스에서도 뜨도록 launchArgs(--ozone-platform=headless)를 앞에 붙인다', () => {
    const s = mcpSnippet(packaged({ executable: '/opt/Nopsidian/nopsidian', launchArgs: ['--ozone-platform=headless', '--mcp-stdio'] }), opts())!;
    expect(s.args).toEqual(['--ozone-platform=headless', '--mcp-stdio', '--vault', '/내 볼트']);
    expect(s.cli).toBe(
      `claude mcp add -s user ${NAME} -- "/opt/Nopsidian/nopsidian" --ozone-platform=headless --mcp-stdio --vault "/내 볼트"`,
    );
  });
});
