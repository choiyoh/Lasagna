import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { t } from '@nopsidian/i18n';
import { applyServerLocale } from './lang.js';
import { PolicyError, parseArgs, usage } from './policy.js';
import { createServer } from './server.js';

declare const __VERSION__: string | undefined;

/** 이 모듈이 `node nopsidian-mcp.mjs …` 처럼 직접 실행됐는가(앱이 불러 `main` 을 쓸 때는 아니다). */
export function isDirectRun(argv: readonly string[], moduleUrl: string): boolean {
  const entry = argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    // 실행 인자가 파일 경로가 아니면(개발 중 `electron .` 등) 직접 실행이 아니다
    return false;
  }
}

/**
 * MCP 서버를 stdio 로 띄우고 클라이언트가 stdin 을 닫을 때까지 기다린다.
 * 돌려주는 값은 종료 코드(0 정상, 2 잘못된 인자)이고 예기치 못한 오류는 던진다.
 * 앱은 `--mcp-stdio` 로 이 함수를 직접 불러 쓴다(별도 Node.js 가 필요 없다).
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  // 시작 시 한 번 언어를 정한다(NOPSIDIAN_LANG → 앱 설정 파일 → OS → ko).
  applyServerLocale();
  let policy;
  try {
    policy = parseArgs([...argv]);
  } catch (e) {
    if (e instanceof PolicyError) {
      process.stderr.write(t('mcpCli.error', { message: e.message, usage: usage() }));
      return 2;
    }
    throw e;
  }
  if (policy === 'help') {
    process.stdout.write(usage());
    return 0;
  }
  const { server } = createServer(policy, typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0');
  await server.connect(new StdioServerTransport());
  // stdout 은 MCP 프로토콜 전용이므로 상태는 stderr 로만 낸다
  process.stderr.write(
    `nopsidian-mcp: ${policy.root} (${policy.write ? t('mcpCli.writeAllowed', { folders: policy.writeFolders.map((f) => f || t('mcpCli.wholeVault')).join(', ') }) : t('mcpCli.readOnly')})\n`,
  );
  // 클라이언트가 stdin 을 닫으면(또는 연결이 끝나면) 돌아온다. 앱은 이때 프로세스를 끝낸다.
  await new Promise<void>((resolve) => {
    server.server.onclose = () => resolve();
    process.stdin.once('end', () => resolve());
    process.stdin.once('close', () => resolve());
  });
  return 0;
}

if (isDirectRun(process.argv, import.meta.url)) {
  void main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e) => {
      process.stderr.write(t('mcpCli.fatal', { message: e instanceof Error ? (e.stack ?? e.message) : String(e) }));
      process.exit(1);
    });
}
