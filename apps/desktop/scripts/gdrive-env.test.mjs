import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gdriveSourceLabel, loadGdriveClient, parseEnv } from './gdrive-env.mjs';

describe('parseEnv', () => {
  it('export·따옴표·인라인 주석을 처리한다', () => {
    const env = parseEnv(`
export A=plain # comment
B="hello # world" # trailing
C='single # value'
D=foo#bar
E="line\\nnext"
`);
    expect(env).toMatchObject({ A: 'plain', B: 'hello # world', C: 'single # value', D: 'foo#bar', E: 'line\nnext' });
  });
});

describe('loadGdriveClient', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nops-gdrive-env-'));
  writeFileSync(path.join(dir, '.env.gdrive.local'), 'NOPS_GDRIVE_CLIENT_ID=file-id\nNOPS_GDRIVE_CLIENT_SECRET=file-secret\n');

  it('환경 변수가 파일보다 우선하고 출처를 구분한다', () => {
    expect(loadGdriveClient({ cwd: dir, env: {} })).toMatchObject({ clientId: 'file-id', clientSecret: 'file-secret', source: 'file' });
    expect(loadGdriveClient({ cwd: dir, env: { NOPS_GDRIVE_CLIENT_ID: 'env-id', NOPS_GDRIVE_CLIENT_SECRET: 'env-secret' } })).toMatchObject({
      clientId: 'env-id',
      clientSecret: 'env-secret',
      source: 'env',
    });
    expect(loadGdriveClient({ cwd: dir, env: { NOPS_GDRIVE_CLIENT_ID: 'env-id' } })).toMatchObject({
      clientId: 'env-id',
      clientSecret: 'file-secret',
      source: 'mixed',
    });
  });

  it('출처 문구에는 값이 들어가지 않는다', () => {
    expect(gdriveSourceLabel({ clientId: 'id', clientSecret: 'secret', source: 'env', file: null })).toBe('환경 변수 값을 사용함');
    expect(gdriveSourceLabel({ clientId: 'id', clientSecret: 'secret', source: 'file', file: '/tmp/.env.gdrive.local' })).toBe('로컬 .env.gdrive.local 값을 사용함');
    expect(gdriveSourceLabel({ clientId: '', clientSecret: '', source: 'none', file: null })).toBe('내장 클라이언트 값이 없음');
  });

  it('값이 없으면 none 이다', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'nops-gdrive-empty-'));
    expect(loadGdriveClient({ cwd: empty, env: {} })).toMatchObject({ clientId: '', clientSecret: '', source: 'none' });
  });
});
