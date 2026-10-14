/* global console, process */
// 방금 만든 설치 파일(apps/desktop/out/make)을 `<대상 폴더>/<버전>/` 으로 복사한다.
// 대상은 구글 드라이브 데스크톱이 동기화하는 폴더(예: `AI Works/Nopsidian/빌드`)를 넘기면 된다. macOS·Windows 모두 동작.
// 사용: node scripts/collect-build.mjs "<대상 폴더>"
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = process.argv[2];
if (!dest) {
  console.error('사용: node scripts/collect-build.mjs "<대상 폴더>"');
  process.exit(1);
}
const version = JSON.parse(readFileSync(path.join(root, 'apps/desktop/package.json'), 'utf8')).version;
const make = path.join(root, 'apps/desktop/out/make');
if (!existsSync(make)) {
  console.error('먼저 `pnpm --filter @nopsidian/desktop make` 로 설치 파일을 만들어 주세요.');
  process.exit(1);
}
const WANT = /\.(dmg|exe|zip|nupkg)$|^RELEASES$/;
const found = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (WANT.test(name)) found.push(full);
  }
};
walk(make);
if (found.length === 0) {
  console.error('복사할 설치 파일이 없어요.');
  process.exit(1);
}
const out = path.join(dest, `v${version}`);
mkdirSync(out, { recursive: true });
for (const f of found) {
  const target = path.join(out, path.basename(f));
  copyFileSync(f, target);
  console.log(`${path.basename(f)}  ${(statSync(target).size / 1048576).toFixed(0)}MB`);
}
console.log(`→ ${out}`);
