#!/usr/bin/env node
/* global process, console */
/**
 * 빌드 후 검사: 내장 secret 은 main 번들에만 있어야 한다.
 * 사용: NOPS_GDRIVE_CLIENT_SECRET=... pnpm --filter @nopsidian/desktop check:builtin
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const secret = process.env.NOPS_GDRIVE_CLIENT_SECRET;
const clientId = process.env.NOPS_GDRIVE_CLIENT_ID;
if (secret === undefined || secret === '' || clientId === undefined || clientId === '') {
  console.error('NOPS_GDRIVE_CLIENT_ID/SECRET 없이 검사할 수 없어요. 빌드 때 쓴 가짜 값을 지정해 주세요.');
  process.exit(2);
}

const root = process.cwd();
const build = path.join(root, '.vite');
const main = path.join(build, 'build', 'main.cjs');
if (!existsSync(main)) {
  console.error(`main 번들이 없어요: ${main}`);
  process.exit(2);
}
const mainText = readFileSync(main, 'utf8');
if (!mainText.includes(secret) || !mainText.includes(clientId)) {
  console.error('main 번들에 내장 client ID/secret 이 주입되지 않았어요.');
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
    const p = path.join(dir, ent.name);
    return ent.isDirectory() ? walk(p) : [p];
  });
}

const leaks = walk(build).filter((file) => {
  if (file === main) return false;
  const text = readFileSync(file, 'utf8');
  return text.includes(secret) || text.includes(clientId);
});
if (leaks.length > 0) {
  console.error(`내장 client 값이 main 밖으로 샜어요: ${leaks.map((p) => path.relative(root, p)).join(', ')}`);
  process.exit(1);
}
console.log('OK: client ID/secret 은 .vite/build/main.cjs 에만 있고 renderer/preload/sourcemap 에는 없어요.');
