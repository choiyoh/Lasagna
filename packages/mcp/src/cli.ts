import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PolicyError, USAGE, parseArgs } from './policy.js';
import { createServer } from './server.js';

declare const __VERSION__: string | undefined;

async function main() {
  let policy;
  try {
    policy = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof PolicyError) {
      process.stderr.write(`오류: ${e.message}\n\n${USAGE}`);
      process.exit(2);
    }
    throw e;
  }
  if (policy === 'help') {
    process.stdout.write(USAGE);
    return;
  }
  const { server } = createServer(policy, typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0');
  await server.connect(new StdioServerTransport());
  // stdout 은 MCP 프로토콜 전용이므로 상태는 stderr 로만 낸다
  process.stderr.write(`nopsidian-mcp: ${policy.root} (${policy.write ? `쓰기 허용: ${policy.writeFolders.map((f) => f || '볼트 전체').join(', ')}` : '읽기 전용'})\n`);
}

void main().catch((e) => {
  process.stderr.write(`nopsidian-mcp 오류: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
