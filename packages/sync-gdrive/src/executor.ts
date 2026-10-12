import { sha256Hex, text, utf8 } from './hash.js';
import { planSync, type PlanInput } from './planner.js';
import {
  RevisionConflictError,
  type DriveClient,
  type LocalStore,
  type MergeText,
  type OpResult,
  type SyncEntry,
  type SyncOp,
  type SyncPath,
  type SyncPlan,
  type SyncReport,
  type SyncState,
} from './types.js';

export interface SyncDeps {
  drive: DriveClient;
  local: LocalStore;
  state: SyncState;
  merge: MergeText;
  /** 충돌 사본 이름의 날짜 */
  now?: () => Date;
  /** 텍스트로 병합할 수 있는 파일인가(기본: 확장자 기준) */
  isText?: (path: SyncPath) => boolean;
  isSyncable?: (path: SyncPath) => boolean;
}

const TEXT_EXT = /\.(md|markdown|txt|ya?ml|json|canvas|csv)$/i;
const defaultIsText = (p: SyncPath) => TEXT_EXT.test(p);

/** 중단해야 하는 오류(토큰 만료 등). 파일 하나의 실패가 아니다. */
function isFatal(e: unknown): boolean {
  return e instanceof Error && (e.name === 'DriveAuthError' || e.name === 'AuthRevokedError');
}

/** 현재 로컬·원격·기록을 읽어 계획을 세운다(아무것도 바꾸지 않는다 — dry-run). */
export async function buildPlan(deps: SyncDeps, opts: Pick<PlanInput, 'maxDeleteRatio' | 'guardMinTracked'> = {}): Promise<SyncPlan> {
  const [local, remote, entries] = await Promise.all([deps.local.scan(), deps.drive.list(), deps.state.entries()]);
  return planSync({ local, remote, entries, isSyncable: deps.isSyncable, ...opts });
}

/** `노트.md` → `노트 (충돌 2026-10-12).md`, 이미 있으면 ` 2`, ` 3` … */
export async function conflictCopyPath(path: SyncPath, date: Date, exists: (p: SyncPath) => Promise<boolean>): Promise<SyncPath> {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  const hasExt = dot > slash + 1;
  const stem = hasExt ? path.slice(0, dot) : path;
  const ext = hasExt ? path.slice(dot) : '';
  for (let n = 1; ; n++) {
    const candidate = `${stem} (충돌 ${day}${n > 1 ? ` ${n}` : ''})${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
}

/** 계획을 실행한다. 작업 하나가 실패해도 나머지는 계속하고, 각 작업의 결과를 보고서에 담는다. */
export async function executePlan(plan: SyncPlan, deps: SyncDeps, opts: { force?: boolean } = {}): Promise<SyncReport> {
  if (plan.blocked && !opts.force) throw new Error(`동기화를 멈췄어요: ${plan.blocked}`);
  const isText = deps.isText ?? defaultIsText;
  const now = deps.now ?? (() => new Date());
  const entries = new Map((await deps.state.entries()).map((e) => [e.path, e]));
  const results: OpResult[] = [];

  const saveEntry = async (path: SyncPath, driveId: string, hash: string, revision: string, bytes?: Uint8Array) => {
    await deps.state.put({ path, driveId, hash, revision });
    if (bytes && isText(path)) await deps.state.putBase(path, bytes);
    else await deps.state.removeBase(path);
  };

  /** 로컬이 계획 이후로 바뀌었는지(덮어써도 되는지) — 기록한 해시와 같아야 안전하다 */
  const localUnchanged = async (path: SyncPath): Promise<boolean> => {
    const e = entries.get(path);
    if (!(await deps.local.exists(path))) return !e;
    return !!e && sha256Hex(await deps.local.read(path)) === e.hash;
  };

  const run = async (op: SyncOp): Promise<Partial<OpResult>> => {
    switch (op.type) {
      case 'push': {
        const bytes = await deps.local.read(op.path);
        const hash = sha256Hex(bytes);
        const r = await deps.drive.upload({ path: op.path, bytes, hash, existing: op.existing });
        await saveEntry(op.path, r.id, hash, r.revision, bytes);
        return {};
      }
      case 'pull': {
        if (op.reason !== 'new' && !(await localUnchanged(op.path)) && (await deps.local.exists(op.path))) return { status: 'skipped' };
        if (op.reason === 'new' && (await deps.local.exists(op.path))) return { status: 'skipped' };
        const bytes = await deps.drive.download(op.remote.id);
        const written = await deps.local.write(op.path, bytes);
        await saveEntry(op.path, op.remote.id, written.hash, op.remote.revision, bytes);
        return {};
      }
      case 'merge': {
        const localBytes = await deps.local.read(op.path);
        const remoteBytes = await deps.drive.download(op.remote.id);
        const localHash = sha256Hex(localBytes);
        const remoteHash = sha256Hex(remoteBytes);
        if (localHash === remoteHash) {
          await saveEntry(op.path, op.remote.id, localHash, op.remote.revision, localBytes);
          return {};
        }
        const base = op.entry ? await deps.state.getBase(op.path) : null;
        let merged: Uint8Array;
        let conflict = false;
        let copyPath: SyncPath | undefined;
        if (isText(op.path) && base) {
          const r = deps.merge(text(base), text(localBytes), text(remoteBytes));
          merged = utf8(r.text);
          conflict = !r.clean;
        } else {
          // 병합할 수 없다(바이너리이거나 base 가 없음): 로컬을 그대로 두고 원격본은 사본으로 보존한다.
          copyPath = await conflictCopyPath(op.path, now(), (p) => deps.local.exists(p));
          await deps.local.write(copyPath, remoteBytes);
          merged = localBytes;
          conflict = true;
        }
        if (copyPath === undefined && sha256Hex(merged) !== localHash) await deps.local.write(op.path, merged);
        const up = await deps.drive.upload({ path: op.path, bytes: merged, hash: sha256Hex(merged), existing: { id: op.remote.id, revision: op.remote.revision } });
        await saveEntry(op.path, up.id, sha256Hex(merged), up.revision, merged);
        return { conflict, copyPath };
      }
      case 'trashLocal': {
        if (!(await localUnchanged(op.path))) return { status: 'skipped' };
        if (await deps.local.exists(op.path)) await deps.local.trash(op.path);
        await deps.state.remove(op.path);
        await deps.state.removeBase(op.path);
        return {};
      }
      case 'trashRemote': {
        await deps.drive.trash(op.remote.id);
        await deps.state.remove(op.path);
        await deps.state.removeBase(op.path);
        return {};
      }
      case 'moveLocal': {
        if (!(await localUnchanged(op.from))) return { status: 'skipped' };
        await deps.local.move(op.from, op.to);
        const base = await deps.state.getBase(op.from);
        await deps.state.remove(op.from);
        await deps.state.removeBase(op.from);
        await saveEntry(op.to, op.remote.id, op.entry.hash, op.remote.revision, base ?? undefined);
        return {};
      }
      case 'moveRemote': {
        const r = await deps.drive.move(op.remote.id, op.to);
        const base = await deps.state.getBase(op.from);
        await deps.state.remove(op.from);
        await deps.state.removeBase(op.from);
        await saveEntry(op.to, r.id, op.hash, r.revision, base ?? undefined);
        return {};
      }
      case 'record': {
        const bytes = isText(op.path) ? await deps.local.read(op.path) : undefined;
        await saveEntry(op.path, op.remote.id, op.hash, op.remote.revision, bytes);
        return {};
      }
      case 'forget': {
        await deps.state.remove(op.path);
        await deps.state.removeBase(op.path);
        return {};
      }
    }
  };

  for (const op of plan.ops) {
    try {
      results.push({ op, status: 'done', ...(await run(op)) });
    } catch (e) {
      if (isFatal(e)) throw e;
      if (e instanceof RevisionConflictError) results.push({ op, status: 'skipped', error: e.message });
      else results.push({ op, status: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  }

  const done = (types: SyncOp['type'][]) => results.filter((r) => r.status === 'done' && types.includes(r.op.type)).length;
  return {
    results,
    pushed: done(['push']),
    pulled: done(['pull']),
    merged: done(['merge']),
    deleted: done(['trashLocal', 'trashRemote']),
    conflicts: results.filter((r) => r.conflict).length,
    failed: results.filter((r) => r.status === 'failed').length,
  };
}

/** 한 번의 동기화: 계획 → (막혔으면 중단) → 실행 */
export async function syncOnce(deps: SyncDeps, opts: { force?: boolean } = {}): Promise<{ plan: SyncPlan; report: SyncReport }> {
  const plan = await buildPlan(deps);
  const report = await executePlan(plan, deps, opts);
  return { plan, report };
}

export type { SyncEntry };
