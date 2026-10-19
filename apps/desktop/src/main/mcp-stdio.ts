import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { mcpScriptPath } from './mcp-cli';

/** 번들된 MCP 서버(nopsidian-mcp.mjs)가 내보내는 것 */
interface McpModule {
  main?: (argv: readonly string[]) => Promise<number> | number;
}

export interface RunMcpStdioOptions {
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
  /** 테스트용 주입: 서버 모듈 불러오기 */
  load?: (url: string) => Promise<unknown>;
  /** 테스트용 주입: 파일 존재 확인 */
  exists?: (file: string) => boolean;
  /** 테스트용 주입: 오류 출력 */
  stderr?: (text: string) => void;
}

/**
 * 앱 실행 파일이 `--mcp-stdio …` 로 시작됐을 때 번들된 MCP 서버를 이 프로세스에서 돌린다.
 * 창·트레이·프로토콜·IPC 없이 stdio 만 쓰고, 끝나면(또는 오류면) 종료 코드를 돌려준다.
 * 프로세스를 끝내는 일은 부르는 쪽(main.ts)이 한다.
 */
export async function runMcpStdio(argv: string[], opts: RunMcpStdioOptions): Promise<number> {
  const stderr = opts.stderr ?? ((text: string) => void process.stderr.write(text));
  const script = mcpScriptPath(opts);
  if (!(opts.exists ?? existsSync)(script)) {
    stderr(`nopsidian-mcp: 서버 파일이 없어요: ${script}\n`);
    return 1;
  }
  try {
    const mod = (await (opts.load ?? ((url: string) => import(url)))(pathToFileURL(script).href)) as McpModule;
    if (typeof mod?.main !== 'function') {
      stderr(`nopsidian-mcp: 서버 모듈에 main 이 없어요: ${script}\n`);
      return 1;
    }
    const code = await mod.main(argv);
    return typeof code === 'number' && Number.isInteger(code) ? code : 0;
  } catch (e) {
    stderr(`nopsidian-mcp 오류: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    return 1;
  }
}
