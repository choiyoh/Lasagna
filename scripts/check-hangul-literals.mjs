#!/usr/bin/env node
/* global console, process */
// 한글 리터럴 가드(래칫): 소스에 남은 한글 UI 문자열을 파일별로 세어 scripts/hangul-allowlist.json 과 비교한다.
// 허용치보다 많거나, 목록에 없는 파일에 한글이 있거나, 반대로 허용치가 실제보다 크면 실패한다(줄일 때만 통과).
// 기준선 갱신은 `node scripts/check-hangul-literals.mjs --write` — 늘리는 방향으로는 쓰지 않는다.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', '.vite', 'fixtures', 'test-results']);
const SKIP_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SKIP_PATH = [
  // 사전은 한글이 원본이다(영어 사전이 짝을 타입으로 강제한다).
  /^packages\/i18n\/src\/messages\//,
  // e2e 스펙은 사용자 화면 문구가 아니다.
  /(^|\/)e2e\//,
];

/** 한 줄에서 주석을 뺀 나머지에 한글이 있으면 1. 문자열·템플릿·JSX 텍스트를 모두 센다. */
export function countHangulLines(source) {
  let lines = 0;
  let block = false;
  let quote = null; // 여러 줄에 걸친 템플릿 리터럴만 유지한다
  let regex = false;
  let regexClass = false;
  let previous = ''; // 정규식 시작 판별용: 마지막으로 본 의미 있는 글자
  for (const line of source.split('\n')) {
    let hit = false;
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (block) {
        if (ch === '*' && line[i + 1] === '/') {
          block = false;
          i += 2;
          continue;
        }
        i += 1;
        continue;
      }
      if (quote) {
        if (ch === '\\') {
          // '\uAC00'·'\u{AC00}' 처럼 이스케이프로 쓴 한글도 센다(사전으로 옮기라는 신호다).
          const escape = /^\\u(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/.exec(line.slice(i));
          if (escape) {
            const code = Number.parseInt(escape[1] ?? escape[2], 16);
            if (code <= 0x10ffff && HANGUL.test(String.fromCodePoint(code))) hit = true;
            i += escape[0].length;
            continue;
          }
          i += 2;
          continue;
        }
        if (ch === quote) quote = null;
        else if (HANGUL.test(ch)) hit = true;
        i += 1;
        continue;
      }
      if (regex) {
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === '[') regexClass = true;
        else if (ch === ']') regexClass = false;
        else if (ch === '/' && !regexClass) regex = false;
        i += 1;
        continue;
      }
      if (ch === '/' && line[i + 1] === '/') break;
      if (ch === '/' && line[i + 1] === '*') {
        block = true;
        i += 2;
        continue;
      }
      if (ch === '/' && (previous === '' || /[=(:,[!&|?{};+\-*%~^<>]/.test(previous))) {
        // 앞이 연산자·괄호면 나눗셈이 아니라 정규식 리터럴이다. 안의 따옴표·백틱은 글자다.
        regex = true;
        regexClass = false;
        previous = '/';
        i += 1;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        quote = ch;
        previous = 'x';
        i += 1;
        continue;
      }
      if (HANGUL.test(ch)) hit = true;
      if (!/\s/.test(ch)) previous = ch;
      i += 1;
    }
    if (quote !== '`') quote = null; // 보통 문자열·정규식은 줄에서 끝난다
    regex = false;
    regexClass = false;
    if (hit) lines += 1;
  }
  return lines;
}

function walk(root, prefix, out) {
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(root, rel, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name) || SKIP_FILE.test(entry.name)) continue;
    if (SKIP_PATH.some((pattern) => pattern.test(rel))) continue;
    out.push(rel);
  }
}

/** 한 디렉터리 아래의 (상대경로 → 한글 줄 수). 0 인 파일은 넣지 않는다. */
export function scanTree(root) {
  const files = [];
  walk(root, '', files);
  const counts = new Map();
  for (const rel of files) {
    const lines = countHangulLines(readFileSync(path.join(root, rel), 'utf8'));
    if (lines > 0) counts.set(rel, lines);
  }
  return counts;
}

/** 검사 대상: apps/desktop/src 와 각 packages/<name>/src. 경로는 저장소 기준 상대 경로다. */
export function scanRepo(repoRoot) {
  const dirs = ['apps/desktop/src'];
  const packagesRoot = path.join(repoRoot, 'packages');
  if (existsSync(packagesRoot)) {
    for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(`packages/${entry.name}/src`);
    }
  }
  const counts = new Map();
  for (const dir of dirs) {
    if (!existsSync(path.join(repoRoot, dir)) || !statSync(path.join(repoRoot, dir)).isDirectory()) continue;
    for (const [rel, lines] of scanTree(path.join(repoRoot, dir))) counts.set(`${dir}/${rel}`, lines);
    // 사전은 scanTree 가 디렉터리 단위로 거르지 못하므로 여기서 한 번 더 지운다.
  }
  for (const key of [...counts.keys()]) if (SKIP_PATH.some((pattern) => pattern.test(key))) counts.delete(key);
  return counts;
}

/** 래칫 검사. 문제 목록을 돌려주고, 비어 있으면 통과다. */
export function checkAllowlist(current, allowlist) {
  const problems = [];
  for (const [file, lines] of current) {
    const allowed = allowlist[file];
    if (allowed === undefined) problems.push(`${file}: ${lines}줄 (목록에 없는 파일)`);
    else if (lines > allowed) problems.push(`${file}: ${lines}줄 > 허용 ${allowed}줄`);
  }
  for (const [file, allowed] of Object.entries(allowlist)) {
    const lines = current.get(file) ?? 0;
    if (lines < allowed) problems.push(`${file}: 허용 ${allowed}줄 > 실제 ${lines}줄 (허용치를 줄이세요)`);
  }
  return problems;
}

/** 기준선보다 늘어난 항목. `--write` 는 이게 비어 있거나 `--allow-increase` 일 때만 쓴다. */
export function allowlistIncreases(previous, current) {
  return [...current.entries()]
    .filter(([file, lines]) => lines > (previous[file] ?? 0))
    .map(([file, lines]) => ({ file, from: previous[file] ?? 0, to: lines }));
}

export function formatAllowlist(counts) {
  const sorted = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  return `${JSON.stringify(Object.fromEntries(sorted), null, 2)}\n`;
}

function main(argv) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const file = path.join(repoRoot, 'scripts', 'hangul-allowlist.json');
  const counts = scanRepo(repoRoot);
  if (argv.includes('--write')) {
    const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    const raises = allowlistIncreases(previous, counts);
    if (raises.length > 0 && !argv.includes('--allow-increase')) {
      console.error('기준선을 올릴 수 없습니다(래칫). 사전으로 옮겨 줄이거나, 정말 필요하면 --allow-increase:');
      console.error(raises.map((entry) => `  - ${entry.file}: ${entry.from} → ${entry.to}`).join('\n'));
      return 1;
    }
    writeFileSync(file, formatAllowlist(counts));
    console.log(`hangul allowlist: ${counts.size} files, ${[...counts.values()].reduce((a, b) => a + b, 0)} lines`);
    return 0;
  }
  const allowlist = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const problems = checkAllowlist(counts, allowlist);
  if (problems.length > 0) {
    console.error('한글 리터럴 가드 실패:\n' + problems.map((p) => `  - ${p}`).join('\n'));
    console.error('새 문자열은 @nopsidian/i18n 사전으로 옮기세요. 기준선 갱신은 --write 로만, 줄어든 뒤에.');
    return 1;
  }
  console.log('한글 리터럴 가드 통과');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
