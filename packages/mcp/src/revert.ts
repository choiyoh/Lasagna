import { t as tr } from '@nopsidian/i18n';
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
  if (!entry) throw new RevertError('not-found', tr('mcp.revertErr.not-found'));
  if (entry.action === 'denied' || entry.action === 'revert') throw new RevertError('not-revertable', tr('mcp.revertErr.not-revertable'));
  if (all.some((e) => e.action === 'revert' && e.note === `revert:${entry.t}` && e.path === entry.path)) throw new RevertError('already', tr('mcp.revertErr.already'));
  const full = resolveInVault(root, entry.path);
  if (!existsSync(full)) throw new RevertError('missing', tr('mcp.revertErr.missing'));
  const disk = readFileSync(full, 'utf8');
  if (entry.hashAfter && sha256(disk) !== entry.hashAfter) {
    throw new RevertError('changed', tr('mcp.revertErr.changed'));
  }
  if (entry.action === 'create') return { entry, plan: { action: 'trash' } };
  const want = entry.hashBefore?.slice(0, 8);
  const snap = want ? listHistory(root, entry.path).find((h) => h.id.endsWith(`-${want}.md`)) : undefined;
  if (!snap) throw new RevertError('no-snapshot', tr('mcp.revertErr.no-snapshot'));
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
