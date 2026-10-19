/** `mcp.info` IPC 가 돌려주는 것: 번들된 서버 경로·볼트·앱 실행 파일·패키징 여부 */
export interface McpInfo {
  script: string | null;
  vault: string;
  executable: string;
  packaged: boolean;
  /** 앱 실행 파일 뒤에 붙이는 MCP 모드 인자(`--mcp-stdio`, 리눅스는 `--ozone-platform=headless` 도) */
  launchArgs: string[];
}

export interface McpSnippet {
  command: string;
  args: string[];
  /** Claude Code 에 붙여 넣을 한 줄 명령 */
  cli: string;
  /** Claude Desktop 등에 붙여 넣을 JSON 설정 */
  json: string;
}

/** 셸 인자: 공백·특수문자가 있어도 안전하게 큰따옴표로 감싼다 */
export const shellQuote = (s: string) => `"${s.replace(/(["\\$`])/g, '\\$1')}"`;

/** 쓰기 폴더 입력을 다듬는다(앞뒤 슬래시 제거, 빈 값은 볼트 전체 = `.`) */
const writeFolder = (folder: string) => folder.trim().replace(/^\/+|\/+$/g, '') || '.';

/**
 * 설정 화면에 보여 줄 MCP 연결 스니펫을 만든다. 서버 파일이 없으면 null.
 * 패키징된 앱은 앱 실행 파일이 `--mcp-stdio` 로 MCP 서버가 되고(Node.js 불필요),
 * 개발 빌드는 저장소의 번들을 `node` 로 실행한다.
 */
export function mcpSnippet(info: McpInfo, opts: { write: boolean; folder: string }): McpSnippet | null {
  if (!info.script) return null;
  const command = info.packaged ? info.executable : 'node';
  const args = [...(info.packaged ? info.launchArgs : [info.script]), '--vault', info.vault, ...(opts.write ? ['--write', '--write-folder', writeFolder(opts.folder)] : [])];
  // 명령 자체가 경로면(앱 실행 파일) 따옴표로 감싸고, `node` 는 그대로 둔다
  const head = info.packaged ? shellQuote(command) : command;
  return {
    command,
    args,
    cli: `claude mcp add nopsidian -- ${head} ${args.map((a) => (a.startsWith('--') ? a : shellQuote(a))).join(' ')}`,
    json: JSON.stringify({ mcpServers: { nopsidian: { command, args } } }, null, 2),
  };
}
