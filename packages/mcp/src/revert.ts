import { existsSync, readFileSync } from 'node:fs';
import { listHistory, readHistory, resolveInVault, saveNote, sha256 } from '@nopsidian/core';
import { appendAudit, readAudit, type AuditEntry } from './audit.js';

export type RevertErrorCode = 'not-found' | 'not-revertable' | 'already' | 'changed' | 'no-snapshot' | 'missing';

export class RevertError extends Error {
  constructor(
    readonly code: RevertErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type RevertPlan = { action: 'restore'; content: string } | { action: 'trash' };

/** 에이전트가 한 작업(감사 기록 한 줄)을 되돌릴 수 있는지 살피고, 무엇을 할지 정한다. 디스크는 건드리지 않는다. */
export function planRevert(root: string, t: string, notePath: string): { entry: AuditEntry; plan: RevertPlan } {
  const all = readAudit(root, 1000);
  const entry = all.find((e) => e.t === t && e.path === notePath);
  if (!entry) throw new RevertError('not-found', '그 기록을 찾을 수 없어요');
  if (entry.action === 'denied' || entry.action === 'revert') throw new RevertError('not-revertable', '되돌릴 수 있는 작업이 아니에요');
  if (all.some((e) => e.action === 'revert' && e.note === `revert:${entry.t}` && e.path === entry.path)) throw new RevertError('already', '이미 되돌린 작업이에요');
  const full = resolveInVault(root, entry.path);
  if (!existsSync(full)) throw new RevertError('missing', '노트가 지금은 없어요(지웠거나 이름을 바꿨어요)');
  const disk = readFileSync(full, 'utf8');
  if (entry.hashAfter && sha256(disk) !== entry.hashAfter) {
    throw new RevertError('changed', '그 뒤로 노트가 또 바뀌었어요. 더 최근 작업부터 되돌리거나 노트의 버전 기록에서 복원해 주세요');
  }
  if (entry.action === 'create') return { entry, plan: { action: 'trash' } };
  const want = entry.hashBefore?.slice(0, 8);
  const snap = want ? listHistory(root, entry.path).find((h) => h.id.endsWith(`-${want}.md`)) : undefined;
  if (!snap) throw new RevertError('no-snapshot', '이전 내용의 버전 기록이 없어요(오래돼 정리됐을 수 있어요)');
  return { entry, plan: { action: 'restore', content: readHistory(root, entry.path, snap.id) } };
}

/** 이전 내용으로 복원한다(현재 내용은 버전 기록에 남는다)하고 되돌림 기록을 남긴다. */
export function applyRestore(root: string, entry: AuditEntry, content: string, now = new Date()): void {
  const full = resolveInVault(root, entry.path);
  const disk = readFileSync(full, 'utf8');
  const r = saveNote({ root, rel: entry.path, content, baseHash: sha256(disk), baseContent: disk, now });
  logRevert(root, entry, r.hash, now);
}

/** 되돌림 기록(감사 기록에 한 줄 추가) */
export function logRevert(root: string, entry: AuditEntry, hashAfter: string | undefined, now = new Date()): void {
  appendAudit(root, { t: now.toISOString(), client: 'Lasagna 앱', action: 'revert', tool: 'app', path: entry.path, hashBefore: entry.hashAfter ?? null, hashAfter, note: `revert:${entry.t}` });
}
