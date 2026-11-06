import { t } from '@nopsidian/i18n';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { PolicyError, folderCovers, normalizeFolder } from './folders.js';

export { PolicyError, normalizeFolder };

/** MCP 서버가 볼트에 할 수 있는 일의 한도. 기본은 읽기 전용이고, 쓰기는 켜야만 되며 폴더도 좁힌다. */
export interface McpPolicy {
  /** 볼트 폴더(절대 경로) */
  root: string;
  /** 쓰기 도구(노트 만들기·덧붙이기·고치기)를 열어 주는가 */
  write: boolean;
  /** 쓰기를 허용하는 폴더(볼트 상대). 빈 문자열 하나면 볼트 전체 */
  writeFolders: string[];
  /** 1분 안에 허용하는 쓰기 횟수(폭주한 에이전트 방지) */
  maxWritesPerMinute: number;
  /** 한 번에 쓸 수 있는 최대 크기(바이트) */
  maxBytes: number;
}

export const DEFAULT_WRITE_FOLDER = 'AI';
export const DEFAULT_MAX_WRITES_PER_MINUTE = 30;
export const DEFAULT_MAX_BYTES = 1_000_000;

/** 도움말. 서버 언어(시작 시 결정)로 만든다. */
export const usage = (): string =>
  t('mcpCli.usage', { folder: DEFAULT_WRITE_FOLDER, max: DEFAULT_MAX_WRITES_PER_MINUTE });


/** 명령줄 인자·환경 변수에서 정책을 만든다. 잘못되면 PolicyError */
export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): McpPolicy | 'help' {
  let vault = env.NOPSIDIAN_VAULT ?? '';
  let write = false;
  const folders: string[] = [];
  let maxWrites = DEFAULT_MAX_WRITES_PER_MINUTE;
  const takeValue = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new PolicyError(t('mcpCli.needsValue', { flag }));
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') return 'help';
    else if (a === '--vault') vault = takeValue(i++, a);
    else if (a === '--write') write = true;
    else if (a === '--write-folder') folders.push(normalizeFolder(takeValue(i++, a)));
    else if (a === '--max-writes-per-minute') {
      const n = Number(takeValue(i++, a));
      if (!Number.isInteger(n) || n < 1 || n > 1000) throw new PolicyError(t('mcpCli.badMaxWrites'));
      maxWrites = n;
    } else throw new PolicyError(t('mcpCli.unknownOption', { option: a }));
  }
  if (!vault) throw new PolicyError(t('mcpCli.needVault'));
  const root = path.resolve(vault);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new PolicyError(t('mcpCli.vaultMissing', { path: root }));
  if (folders.length && !write) throw new PolicyError(t('mcpCli.writeFolderNeedsWrite'));
  return {
    root,
    write,
    writeFolders: write ? [...new Set(folders.length ? folders : [DEFAULT_WRITE_FOLDER])] : [],
    maxWritesPerMinute: maxWrites,
    maxBytes: DEFAULT_MAX_BYTES,
  };
}

/** 볼트 안 노트 경로를 정규화·검증한다(절대 경로·`..`·점으로 시작하는 폴더/파일·이상한 글자 거부, `.md` 보장). */
export function validateNotePath(input: string): string {
  let p = input.normalize('NFC').replace(/\\/g, '/').replace(/^(\.\/)+/, '').trim();
  if (!p) throw new PolicyError(t('mcpPolicy.err.emptyPath'));
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) throw new PolicyError(t('mcpPolicy.err.relativeOnly'));
  if (!/\.md$/i.test(p)) p += '.md';
  if (p.length > 240) throw new PolicyError(t('mcpPolicy.err.tooLong'));
  const parts = p.split('/');
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') throw new PolicyError(t('mcpPolicy.err.badPath', { path: input }));
    if (part.startsWith('.')) throw new PolicyError(t('mcpPolicy.err.dotName'));
    // eslint-disable-next-line no-control-regex
    if (/[\\:*?"<>|\u0000-\u001f]/.test(part)) throw new PolicyError(t('mcpPolicy.err.badChars', { name: part }));
  }
  return p;
}

/** 이 경로에 쓰기가 허용되는가 */
export function canWrite(policy: McpPolicy, rel: string): boolean {
  if (!policy.write) return false;
  return policy.writeFolders.some((f) => folderCovers(f, rel));
}
