/* global URL */// stdio MCP 서버를 의존성까지 한 파일로 묶는다(앱에 넣어 `node nopsidian-mcp.mjs` 로 실행).
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../apps/desktop/package.json', import.meta.url), 'utf8'));
await build({
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/nopsidian-mcp.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: false,
  sourcemap: false,
  logLevel: 'info',
  define: { __VERSION__: JSON.stringify(pkg.version) },
  // ESM 번들 안의 CommonJS 의존성이 require 를 쓸 수 있게 한다
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
