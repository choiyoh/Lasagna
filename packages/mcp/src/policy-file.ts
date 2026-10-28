import { readFileSync } from 'node:fs';
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

export type PolicyFileRead = { kind: 'missing' } | { kind: 'ok'; policy: PolicyFile } | { kind: 'invalid'; error: string };

export type EffectivePolicy = McpPolicy & {
  source: 'args' | 'file';
  /** 쓰기를 거부할 때 감사 기록에 남길 코드 */
  reason?: 'policy-disabled' | 'policy-invalid';
  message?: string;
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
    return { kind: 'invalid', error: `정책 파일을 읽을 수 없어요: ${e instanceof Error ? e.message : String(e)}` };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', error: '정책 파일이 올바른 JSON 이 아니에요' };
  }
  const parsed = policyFileSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { kind: 'invalid', error: `정책 파일 형식이 올바르지 않아요${issue ? `: ${issue.path.join('.')} ${issue.message}` : ''}` };
  }
  try {
    const writeFolders = [...new Set(parsed.data.writeFolders.map((f) => normalizeFolder(f)))];
    if (parsed.data.write && writeFolders.length === 0) {
      return { kind: 'invalid', error: '쓰기가 켜져 있지만 허용 폴더가 없어요' };
    }
    return { kind: 'ok', policy: { ...parsed.data, writeFolders } };
  } catch (e) {
    return { kind: 'invalid', error: `정책 파일의 폴더가 올바르지 않아요: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 앱이 정책 파일을 원자적으로 쓴다. 폴더를 서버와 같은 규칙으로 검증·정규화한다. */
export function writePolicyFile(root: string, input: unknown): PolicyFile {
  const parsed = policyFileSchema.parse(input);
  const writeFolders = [...new Set(parsed.writeFolders.map((f) => normalizeFolder(f)))];
  if (parsed.write && writeFolders.length === 0) throw new Error('쓰기를 켜려면 허용 폴더가 하나 이상 필요해요');
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
    return { ...args, write: false, writeFolders: [], source: 'file', reason: 'policy-invalid', message: file.error };
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
      message: '앱 설정에서 쓰기를 꺼 두었어요',
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
      message: '앱 정책과 서버 인자가 허용하는 폴더가 겹치지 않아요',
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
