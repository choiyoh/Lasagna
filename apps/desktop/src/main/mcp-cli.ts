import path from 'node:path';

/** 앱 실행 파일을 MCP 서버(stdio) 모드로 띄우는 인자 */
export const MCP_STDIO_FLAG = '--mcp-stdio';

/** `--mcp-stdio` 가 있으면 앱 대신 MCP 서버로만 동작한다(창·트레이·프로토콜·IPC 없음). */
export function isMcpStdioInvocation(argv: readonly string[]): boolean {
  return argv.includes(MCP_STDIO_FLAG);
}

/**
 * 앱 실행 파일 뒤에 붙여 MCP 서버 모드로 띄우는 인자.
 * 리눅스는 화면(X/Wayland)이 없는 곳(SSH·서버·에이전트 샌드박스)에서 Chromium 이 "Missing X server" 로 바로 끝나므로
 * `--ozone-platform=headless` 를 앞에 둔다(이 스위치는 앱 코드가 돌기 전에 정해져 main.ts 에서 덧붙일 수 없다).
 */
export function mcpLaunchArgs(platform: NodeJS.Platform): string[] {
  return platform === 'linux' ? ['--ozone-platform=headless', MCP_STDIO_FLAG] : [MCP_STDIO_FLAG];
}

/** `--mcp-stdio` 뒤의 나머지 인자를 MCP 서버에 그대로 넘긴다. */
export function mcpStdioArgs(argv: readonly string[]): string[] {
  const at = argv.indexOf(MCP_STDIO_FLAG);
  return at < 0 ? [] : argv.slice(at + 1);
}

/** 번들된 MCP 서버 파일 경로: 패키징된 앱은 resources/, 개발 중에는 저장소의 빌드 결과. */
export function mcpScriptPath(opts: { packaged: boolean; resourcesPath: string; appPath: string }): string {
  return opts.packaged
    ? path.join(opts.resourcesPath, 'nopsidian-mcp.mjs')
    : path.resolve(opts.appPath, '../../packages/mcp/dist/nopsidian-mcp.mjs');
}
