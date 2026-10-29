#!/usr/bin/env node
/* global process, console */
/**
 * 빌드 후 검사: 내장 client ID/secret 은 main 번들에만 있어야 한다.
 * 값은 환경 변수 또는 .env.gdrive.local 에서 읽고, 없으면 검사를 건너뛴다.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { gdriveSourceLabel, loadGdriveClient } from './gdrive-env.mjs';

const client = loadGdriveClient();
if (client.clientId === '') {
  console.log('내장 Google 클라이언트 값이 없어 검사를 건너뜀');
  process.exit(0);
}
console.log(`[gdrive] ${gdriveSourceLabel(client)}`);

const values = [client.clientId, ...(client.clientSecret === '' ? [] : [client.clientSecret])];
const containsAll = (text) => values.every((value) => text.includes(value));
const containsAny = (text) => values.some((value) => text.includes(value));
const root = process.cwd();
const build = path.join(root, '.vite');
const main = path.join(build, 'build', 'main.cjs');

if (!existsSync(main)) {
  console.error(`main 번들이 없어요: ${main}`);
  process.exit(2);
}
if (!containsAll(readFileSync(main, 'utf8'))) {
  console.error('main 번들에 내장 client ID/secret 이 주입되지 않았어요.');
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
    const p = path.join(dir, ent.name);
    return ent.isDirectory() ? walk(p) : [p];
  });
}

const leaks = walk(build).filter((file) => file !== main && containsAny(readFileSync(file, 'utf8')));
if (leaks.length > 0) {
  console.error(`내장 client 값이 main 밖으로 샜어요: ${leaks.map((p) => path.relative(root, p)).join(', ')}`);
  process.exit(1);
}

// 선택: 패키징된 app.asar 안에도 .env 파일이나 main 밖의 값이 없는지 확인한다.
const out = path.join(root, 'out');
const asars = existsSync(out) ? walk(out).filter((file) => path.basename(file) === 'app.asar') : [];
if (existsSync(out)) {
  const envFiles = walk(out).filter((file) => path.basename(file) === '.env.gdrive.local');
  if (envFiles.length > 0) {
    console.error(`패키징 결과에 .env.gdrive.local 이 들어갔어요: ${envFiles.map((p) => path.relative(root, p)).join(', ')}`);
    process.exit(1);
  }
}
if (asars.length > 0) {
  let asar;
  try {
    asar = createRequire(import.meta.url)('@electron/asar');
  } catch {
    console.warn('@electron/asar 를 찾을 수 없어 app.asar 검사는 건너뜀');
  }
  if (asar === undefined) {
    // 선택 검사만 건너뛴다.
  } else for (const archive of asars) {
    const entries = asar.listPackage(archive).map((p) => p.replace(/^\/+/, ''));
    if (entries.some((p) => p.endsWith('.env.gdrive.local'))) {
      console.error(`app.asar 안에 .env.gdrive.local 이 들어갔어요: ${path.relative(root, archive)}`);
      process.exit(1);
    }
    const mainEntry = entries.find((p) => p === '.vite/build/main.cjs');
    if (mainEntry === undefined) {
      console.error(`app.asar 안에 main 번들이 없어요: ${path.relative(root, archive)}`);
      process.exit(1);
    }
    if (!containsAll(asar.extractFile(archive, mainEntry).toString('utf8'))) {
      console.error(`app.asar main 번들에 내장 값이 없어요: ${path.relative(root, archive)}`);
      process.exit(1);
    }
    const asarLeaks = entries.filter((entry) => {
      if (entry === mainEntry) return false;
      const stat = asar.statFile(archive, entry);
      if (stat.files !== undefined) return false;
      return containsAny(asar.extractFile(archive, entry).toString('utf8'));
    });
    if (asarLeaks.length > 0) {
      console.error(`app.asar 안에서 값이 main 밖으로 샜어요: ${asarLeaks.join(', ')}`);
      process.exit(1);
    }
  }
}

console.log('OK: client ID/secret 은 main 번들에만 있고 renderer/preload/sourcemap/app.asar 사본에도 없어요.');
