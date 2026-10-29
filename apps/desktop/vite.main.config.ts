import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import { EXTERNAL_NATIVE } from './native-modules';

/** `apps/desktop/.env.gdrive.local` 또는 같은 형식의 환경 변수에서 사용자 전용 클라이언트를 읽는다. */
function localEnv(): Record<string, string> {
  const candidates = [
    path.resolve(process.cwd(), '.env.gdrive.local'),
    path.resolve(process.cwd(), 'apps/desktop/.env.gdrive.local'),
  ];
  const file = candidates.find((p) => existsSync(p));
  if (file === undefined) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const text = line.trim();
    if (text === '' || text.startsWith('#')) continue;
    const i = text.indexOf('=');
    if (i <= 0) continue;
    const key = text.slice(0, i).trim();
    let value = text.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const local = localEnv();
const clientId = process.env.NOPS_GDRIVE_CLIENT_ID ?? local.NOPS_GDRIVE_CLIENT_ID ?? '';
const clientSecret = process.env.NOPS_GDRIVE_CLIENT_SECRET ?? local.NOPS_GDRIVE_CLIENT_SECRET ?? '';

// 네이티브 모듈은 번들하지 않고 런타임에 require 한다.
// sourcemap 은 비밀 값이 별도 파일에 남지 않도록 끈다.
export default defineConfig({
  define: {
    __NOPS_GDRIVE_CLIENT_ID__: JSON.stringify(clientId),
    __NOPS_GDRIVE_CLIENT_SECRET__: JSON.stringify(clientSecret),
  },
  build: { sourcemap: false, rollupOptions: { external: EXTERNAL_NATIVE } },
  resolve: { mainFields: ['module', 'jsnext:main', 'jsnext'] },
});
