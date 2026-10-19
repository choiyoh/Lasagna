/* global console, process */
// Electron 패키지의 postinstall 이 건너뛰어진 새 클론(pnpm 11)에서 실행 파일을 채운다.
// 이미 있으면 아무것도 하지 않고(빠른 no-op), 내려받기에 실패해도 설치는 계속되게 경고만 한다.
// 사용: node scripts/ensure-electron.mjs [--strict]   (--strict: 설치 실패를 종료 코드 1로 알린다. CI e2e 용)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** 설치된 electron 패키지 폴더. 없으면 null. */
export function electronPackageDir() {
  try {
    return path.dirname(require.resolve('electron/package.json'));
  } catch {
    return null;
  }
}

/**
 * 설치된 Electron 실행 파일 경로. `path.txt` 가 가리키는 파일이 dist 안에 실제로 있어야 한다.
 * `require('electron')` 은 dist 가 없으면 그 자리에서 내려받기를 시도하므로, 폴더만 require.resolve 로 찾는다.
 */
export function electronBinary(dir, env = process.env) {
  const pathFile = path.join(dir, 'path.txt');
  if (!existsSync(pathFile)) return null;
  const name = readFileSync(pathFile, 'utf8').trim();
  if (!name) return null;
  const dist = env.ELECTRON_OVERRIDE_DIST_PATH || path.join(dir, 'dist');
  const binary = path.join(dist, name);
  return existsSync(binary) ? binary : null;
}

/**
 * 실행 파일이 없으면 electron/install.js 를 돌린다.
 * 반환: 'ok'(이미 있음) | 'installed'(방금 설치) | 'failed'(설치 못 함) | 'missing'(electron 패키지 없음)
 */
export function ensureElectron({ dir = electronPackageDir(), spawn = spawnSync, log = console.log, warn = console.warn } = {}) {
  if (!dir) {
    warn('[ensure-electron] electron 패키지를 찾지 못했어요. 설치를 건너뜁니다.');
    return 'missing';
  }
  if (electronBinary(dir)) return 'ok';

  const installer = path.join(dir, 'install.js');
  if (!existsSync(installer)) {
    warn(`[ensure-electron] ${installer} 가 없어 설치하지 못했어요.`);
    return 'failed';
  }
  log('[ensure-electron] Electron 실행 파일이 없어 내려받습니다…');
  const result = spawn(process.execPath, [installer], { cwd: dir, stdio: 'inherit' });
  if (result.status !== 0 || !electronBinary(dir)) {
    warn('[ensure-electron] Electron 실행 파일을 설치하지 못했어요. 오프라인이면 연결한 뒤 `node scripts/ensure-electron.mjs` 를 다시 실행해 주세요.');
    return 'failed';
  }
  return 'installed';
}

// 직접 실행할 때만 CLI 로 동작한다(단위 테스트에서 import 할 수 있게).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const status = ensureElectron();
  if (process.argv.includes('--strict') && status !== 'ok' && status !== 'installed') process.exit(1);
}
