import { folderCovers, normalizeFolder } from '@nopsidian/mcp/folders';

/** `mcp.info` IPC 가 돌려주는 것: 번들된 서버 경로·볼트·앱 실행 파일·패키징 여부 */
export interface McpInfo {
  script: string | null;
  vault: string;
  vaultName: string;
  vaultId: string;
  /** 앱 설정의 데일리 노트 폴더(볼트 상대) */
  dailyFolder: string;
  executable: string;
  packaged: boolean;
  /** 앱 실행 파일 뒤에 붙이는 MCP 모드 인자(`--mcp-stdio`, 리눅스는 `--ozone-platform=headless` 도) */
  launchArgs: string[];
}

export type McpClientId = 'claude-code' | 'claude-desktop' | 'codex' | 'cursor' | 'vscode' | 'gemini-cli';

export interface McpSnippetOptions {
  write: boolean;
  /** 쓰기를 허용할 폴더(볼트 상대, `.` 은 볼트 전체) */
  folder: string;
  /** 데일리 노트 폴더도 쓰기 허용 폴더에 넣을지 */
  allowDailyFolder: boolean;
  dailyFolder: string;
  /** 서버 이름. 비어 있으면 볼트 이름으로 만든 기본값 */
  name: string;
}

export interface McpClientBlock {
  id: McpClientId;
  label: string;
  /** 설정을 넣을 파일 또는 실행할 곳 */
  target: string;
  format: 'bash' | 'json' | 'toml';
  code: string;
  hint: string;
}

export interface McpSnippet {
  command: string;
  args: string[];
  /** 실제로 쓰는 서버 이름(기본값이 채워진 값) */
  name: string;
  /** Claude Code 에 붙여 넣을 한 줄 명령 */
  cli: string;
  /** Claude Desktop 등에 붙여 넣을 JSON */
  json: string;
  /** 설정 화면 탭 6종 */
  clients: McpClientBlock[];
}

/** 셸 인자: 공백·특수문자가 있어도 안전하게 큰따옴표로 감싼다 */
export const shellQuote = (s: string) => `"${s.replace(/(["\\$`])/g, '\\$1')}"`;

/** 쓰기 폴더를 서버와 같은 규칙으로 검증한다. 문제가 있으면 화면에 보여 줄 이유, 없으면 null. */
export function folderError(folder: string): string | null {
  try {
    normalizeFolder(folder);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** 입력한 상위 폴더가 하위 경로(데일리 폴더 등)를 포함하는가. 잘못된 경로면 false. */
export function folderContains(parent: string, child: string): boolean {
  try {
    return folderCovers(normalizeFolder(parent), normalizeFolder(child));
  } catch {
    return false;
  }
}

/** 볼트 이름에서 기본 서버 이름에 쓸 슬러그를 만든다. 한글처럼 ASCII 로 바꿀 수 없으면 `vault`. */
export function vaultSlug(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return ascii || 'vault';
}

/** 볼트 id 의 짧은 해시(FNV-1a, base36). 같은 이름의 볼트도 기본 이름이 겹치지 않게 한다. */
function vaultHash(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, '0');
}

/** 기본 서버 이름: `lasagna-<볼트 슬러그>-<볼트 해시>` */
export function defaultServerName(info: Pick<McpInfo, 'vaultName' | 'vaultId'>): string {
  return `lasagna-${vaultSlug(info.vaultName)}-${vaultHash(info.vaultId)}`;
}

/** 클라이언트 설정 파일 키로 쓸 수 있는 이름인가(공백 없이 글자·숫자·`._-`) */
export function isValidServerName(name: string): boolean {
  return /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(name.trim());
}

/** 스니펫에 넣을 쓰기 허용 폴더 목록. 서버 정책과 같은 규칙으로 검증하고, 덮이는 데일리 폴더는 넣지 않는다. */
export function snippetWriteFolders(opts: Pick<McpSnippetOptions, 'write' | 'folder' | 'allowDailyFolder' | 'dailyFolder'>): string[] {
  if (!opts.write) return [];
  const main = normalizeFolder(opts.folder);
  if (main === '') return ['']; // 볼트 전체
  const folders = [main];
  if (opts.allowDailyFolder) {
    const daily = normalizeFolder(opts.dailyFolder);
    if (daily && !folderCovers(main, daily)) folders.push(daily);
  }
  return folders;
}

/** Claude Code CLI 한 줄. `-s user` 라서 어느 폴더에서 연 Claude Code 에서도 보인다. */
function claudeCodeCli(name: string, head: string, args: string[]): string {
  const nameArg = /^[A-Za-z0-9._-]+$/.test(name) ? name : shellQuote(name);
  return `claude mcp add -s user ${nameArg} -- ${head} ${args.map((a) => (a.startsWith('--') ? a : shellQuote(a))).join(' ')}`;
}

/**
 * 설정 화면에 보여 줄 MCP 연결 스니펫을 만든다. 서버 파일이 없으면 null.
 * 패키징된 앱은 앱 실행 파일이 `--mcp-stdio` 로 MCP 서버가 되고(Node.js 불필요),
 * 개발 빌드는 저장소의 번들을 `node` 로 실행한다.
 */
export function mcpSnippet(info: McpInfo, opts: McpSnippetOptions): McpSnippet | null {
  if (!info.script) return null;
  const name = opts.name.trim() || defaultServerName(info);
  // 이름이 CLI 옵션처럼 보이거나 설정 키로 쓸 수 없으면 복사할 수 있는 스니펫을 만들지 않는다
  if (!isValidServerName(name)) return null;
  const command = info.packaged ? info.executable : 'node';
  let folders: string[];
  try {
    folders = snippetWriteFolders({ ...opts, dailyFolder: opts.dailyFolder || info.dailyFolder });
  } catch {
    // 잘못된 폴더는 서버가 시작할 때 PolicyError 로 죽는다. 이유는 설정 화면이 보여 준다.
    return null;
  }
  const args = [
    ...(info.packaged ? info.launchArgs : [info.script]),
    '--vault',
    info.vault,
    ...(opts.write ? ['--write', ...folders.flatMap((f) => ['--write-folder', f || '.'])] : []),
  ];
  // 명령 자체가 경로면(앱 실행 파일) 따옴표로 감싸고, `node` 는 그대로 둔다
  const head = info.packaged ? shellQuote(command) : command;
  const cli = claudeCodeCli(name, head, args);
  const mcpServers = () => JSON.stringify({ mcpServers: { [name]: { command, args } } }, null, 2);
  const json = mcpServers();
  const toml = `[mcp_servers.${JSON.stringify(name)}]\ncommand = ${JSON.stringify(command)}\nargs = [${args.map((a) => JSON.stringify(a)).join(', ')}]`;
  const vscode = JSON.stringify({ servers: { [name]: { type: 'stdio', command, args } } }, null, 2);
  return {
    command,
    args,
    name,
    cli,
    json,
    clients: [
      {
        id: 'claude-code',
        label: 'Claude Code',
        target: '터미널에서 한 번 실행',
        format: 'bash',
        code: cli,
        hint: '사용자 범위(-s user)로 등록돼 어느 폴더에서 연 Claude Code 에서도 보여요. 등록 확인: claude mcp list',
      },
      {
        id: 'claude-desktop',
        label: 'Claude Desktop',
        target: '~/Library/Application Support/Claude/claude_desktop_config.json',
        format: 'json',
        code: json,
        hint: '파일이 없으면 새로 만들고, 이미 있으면 mcpServers 안에 이 항목을 더해요. 저장한 뒤 Claude Desktop 을 다시 시작하세요.',
      },
      {
        id: 'codex',
        label: 'Codex',
        target: '~/.codex/config.toml',
        format: 'toml',
        code: toml,
        hint: '기존 파일의 [mcp_servers] 항목에 이 표를 더해요. 또는 codex mcp add <이름> -- <명령> <인자…> 로도 등록할 수 있어요.',
      },
      {
        id: 'cursor',
        label: 'Cursor',
        target: '~/.cursor/mcp.json',
        format: 'json',
        code: mcpServers(),
        hint: 'Cursor 설정 → MCP 에서도 같은 JSON 을 붙여 넣을 수 있어요. 프로젝트마다 쓰려면 .cursor/mcp.json 에 넣으세요.',
      },
      {
        id: 'vscode',
        label: 'VS Code',
        target: '.vscode/mcp.json (워크스페이스)',
        format: 'json',
        code: vscode,
        hint: 'VS Code 의 MCP 설정은 mcpServers 가 아니라 servers 이고 "type": "stdio" 가 필요해요. 모든 워크스페이스에서 쓰려면 명령 팔레트 → “MCP: Open User Configuration”.',
      },
      {
        id: 'gemini-cli',
        label: 'Gemini CLI',
        target: '~/.gemini/settings.json',
        format: 'json',
        code: mcpServers(),
        hint: '설정 파일을 저장한 뒤 Gemini CLI 를 다시 시작하세요.',
      },
    ],
  };
}
