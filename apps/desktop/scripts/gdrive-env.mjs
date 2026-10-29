/* global process */
/**
 * 빌드와 빌드 후 검사가 함께 쓰는 Google 클라이언트 환경 로더.
 * 환경 변수 > apps/desktop/.env.gdrive.local 순서. 값은 로그에 출력하지 않는다.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ID_KEY = 'NOPS_GDRIVE_CLIENT_ID';
const SECRET_KEY = 'NOPS_GDRIVE_CLIENT_SECRET';

/** `export KEY=`, 따옴표, 인라인 `#` 주석을 지원하는 작은 .env 파서. */
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let rest = line.slice(eq + 1).trim();
    let value = '';
    if (rest.startsWith('"') || rest.startsWith("'")) {
      const quote = rest[0];
      let i = 1;
      let escaped = false;
      for (; i < rest.length; i++) {
        const c = rest[i];
        if (quote === '"' && escaped) {
          value += c === 'n' ? '\n' : c === 't' ? '\t' : c;
          escaped = false;
          continue;
        }
        if (quote === '"' && c === '\\') {
          escaped = true;
          continue;
        }
        if (c === quote) break;
        value += c;
      }
    } else {
      const comment = rest.search(/\s#/);
      value = (comment >= 0 ? rest.slice(0, comment) : rest).trim();
    }
    out[key] = value;
  }
  return out;
}

export function findGdriveEnvFile(cwd = process.cwd()) {
  const candidates = [path.resolve(cwd, '.env.gdrive.local'), path.resolve(cwd, 'apps/desktop/.env.gdrive.local')];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function loadGdriveClient({ cwd = process.cwd(), env = process.env } = {}) {
  const file = findGdriveEnvFile(cwd);
  const fromFile = file === null ? {} : parseEnv(readFileSync(file, 'utf8'));
  const values = {};
  let usedEnv = false;
  let usedFile = false;
  for (const key of [ID_KEY, SECRET_KEY]) {
    const envValue = env[key];
    if (envValue !== undefined && envValue !== '') {
      values[key] = envValue;
      usedEnv = true;
    } else if (fromFile[key] !== undefined && fromFile[key] !== '') {
      values[key] = fromFile[key];
      usedFile = true;
    } else {
      values[key] = '';
    }
  }
  const source = usedEnv && usedFile ? 'mixed' : usedEnv ? 'env' : usedFile ? 'file' : 'none';
  return { clientId: values[ID_KEY], clientSecret: values[SECRET_KEY], source, file };
}

export function gdriveSourceLabel(info) {
  if (info.source === 'env') return '환경 변수 값을 사용함';
  if (info.source === 'file') return '로컬 .env.gdrive.local 값을 사용함';
  if (info.source === 'mixed') return '환경 변수와 로컬 .env.gdrive.local 값을 함께 사용함';
  return '내장 클라이언트 값이 없음';
}
