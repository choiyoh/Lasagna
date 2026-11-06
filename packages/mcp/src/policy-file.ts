import { readFileSync } from 'node:fs';
import { t, type MessageKey } from '@nopsidian/i18n';
import path from 'node:path';
import { z } from 'zod';
import { atomicWrite } from '@nopsidian/core';
import { folderCovers, normalizeFolder } from './folders.js';
import type { McpPolicy } from './policy.js';

/** 볼트 안의 MCP 쓰기 정책 파일. 앱 설정 화면이 정본을 쓴다. */
export const POLICY_FILE = '.nopsidian/mcp-policy.json';
export const POLICY_VERSION = 1;

export const policyFileSchema = z
  .object({
    version: z.literal(POLICY_VERSION),
    write: z.boolean(),
    writeFolders: z.array(z.string().max(1024)).max(50),
    maxWritesPerMinute: z.number().int().min(1).max(1000),
  })
  .strict();

export type PolicyFile = z.infer<typeof policyFileSchema>;

/** 정책 파일 오류의 종류 — 화면은 이 코드로 지금 언어의 문구를 만든다(문구 자체는 사람이 읽는 용도). */
export type PolicyErrorCode = 'unreadable' | 'invalidJson' | 'invalidSchema' | 'noFolders' | 'badFolder';

export interface PolicyError {
  code: PolicyErrorCode;
  params?: Record<string, string>;
}

export type PolicyFileRead =
  | { kind: 'missing' }
  | { kind: 'ok'; policy: PolicyFile }
  | { kind: 'invalid'; error: string; code: PolicyErrorCode; params?: Record<string, string> };

export type EffectivePolicy = McpPolicy & {
  source: 'args' | 'file';
  /** 쓰기를 거부할 때 감사 기록에 남길 코드 */
  reason?: 'policy-disabled' | 'policy-invalid';
  /** 거부 사유 — 언어별 문장을 저장하지 않고 코드/키로 들고 있다가 응답 시점에 번역한다 */
  messageKey?: MessageKey;
  errorCode?: PolicyErrorCode;
  errorParams?: Record<string, string>;
};

export function policyPath(root: string): string {
  return path.join(root, POLICY_FILE);
}

/** 정책 파일을 읽는다. 없으면 missing, 깨졌으면 invalid(서버는 쓰기를 거부한다). */
export function readPolicyFile(root: string): PolicyFileRead {
  const file = policyPath(root);
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    return {
      kind: 'invalid',
      error: t('mcp.policyErr.unreadable', { message: e instanceof Error ? e.message : String(e) }),
      code: 'unreadable',
      params: { message: e instanceof Error ? e.message : String(e) },
    };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', error: t('mcp.policyErr.invalidJson'), code: 'invalidJson' };
  }
  const parsed = policyFileSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      kind: 'invalid',
      error: issue
        ? t('mcp.policyErr.invalidSchema', { path: issue.path.join('.'), message: issue.message })
        : t('mcp.policyErr.invalidSchemaNoIssue'),
      code: 'invalidSchema',
      ...(issue ? { params: { path: issue.path.join('.'), message: issue.message } } : {}),
    };
  }
  try {
    const writeFolders = [...new Set(parsed.data.writeFolders.map((f) => normalizeFolder(f)))];
    if (parsed.data.write && writeFolders.length === 0) {
      return { kind: 'invalid', error: t('mcp.policyErr.noFolders'), code: 'noFolders' };
    }
    return { kind: 'ok', policy: { ...parsed.data, writeFolders } };
  } catch (e) {
    return {
      kind: 'invalid',
      error: t('mcp.policyErr.badFolder', { message: e instanceof Error ? e.message : String(e) }),
      code: 'badFolder',
      params: { message: e instanceof Error ? e.message : String(e) },
    };
  }
}

/** 앱이 정책 파일을 원자적으로 쓴다. 폴더를 서버와 같은 규칙으로 검증·정규화한다. */
export function writePolicyFile(root: string, input: unknown): PolicyFile {
  const parsed = policyFileSchema.parse(input);
  const writeFolders = [...new Set(parsed.writeFolders.map((f) => normalizeFolder(f)))];
  if (parsed.write && writeFolders.length === 0) throw new Error(t('mcp.policyNeedFolder'));
  const policy: PolicyFile = { ...parsed, writeFolders };
  atomicWrite(policyPath(root), `${JSON.stringify(policy, null, 2)}\n`);
  return policy;
}

/**
 * 서버 인자와 앱 정책 파일의 교집합. 둘 중 더 제한적인 쪽만 남긴다.
 * 파일이 없으면 인자 그대로(기존 사용자 호환), 파일이 깨졌거나 파일이 쓰기를 끄면 쓰기를 거부한다.
 */
export function effectivePolicy(args: McpPolicy, file: PolicyFileRead): EffectivePolicy {
  if (!args.write) return { ...args, source: 'args' };
  if (file.kind === 'missing') return { ...args, source: 'args' };
  if (file.kind === 'invalid') {
    return { ...args, write: false, writeFolders: [], source: 'file', reason: 'policy-invalid', errorCode: file.code, ...(file.params ? { errorParams: file.params } : {}) };
  }
  const policy = file.policy;
  const maxWritesPerMinute = Math.min(args.maxWritesPerMinute, policy.maxWritesPerMinute);
  if (!policy.write) {
    return {
      ...args,
      write: false,
      writeFolders: [],
      maxWritesPerMinute,
      source: 'file',
      reason: 'policy-disabled',
      messageKey: 'mcp.policyErr.appDisabled',
    };
  }
  const writeFolders = intersectWriteFolders(args.writeFolders, policy.writeFolders);
  if (writeFolders.length === 0) {
    return {
      ...args,
      write: false,
      writeFolders: [],
      maxWritesPerMinute,
      source: 'file',
      reason: 'policy-disabled',
      messageKey: 'mcp.policyErr.noOverlap',
    };
  }
  return { ...args, writeFolders, maxWritesPerMinute, source: 'file' };
}

/** 두 허용 폴더 목록의 교집합. 한쪽이 상위 폴더면 더 좁은 쪽을 남긴다. */
export function intersectWriteFolders(left: string[], right: string[]): string[] {
  const out: string[] = [];
  for (const a of left) {
    for (const b of right) {
      if (a === '' && b === '') out.push('');
      else if (a === '') out.push(b);
      else if (b === '') out.push(a);
      else if (a === b) out.push(a);
      else if (a.startsWith(`${b}/`)) out.push(a);
      else if (b.startsWith(`${a}/`)) out.push(b);
    }
  }
  const unique = [...new Set(out)];
  // 상위 폴더가 하위 폴더를 덮으므로 중복을 정리한다.
  return unique.filter((f, i) => !unique.some((g, j) => j !== i && g !== f && folderCovers(g, f)));
}
