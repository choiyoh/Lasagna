import type { LocalFile, RemoteFile, SyncEntry, SyncOp, SyncPath, SyncPlan } from './types.js';

export interface PlanInput {
  local: LocalFile[];
  remote: RemoteFile[];
  entries: SyncEntry[];
  /** 동기화 대상 판별(기본: 모두). 대상이 아닌 경로는 계획에서 완전히 빠진다. */
  isSyncable?: (path: SyncPath) => boolean;
  /** 삭제 비율 상한(기록된 파일 수 대비). 기본 0.2 */
  maxDeleteRatio?: number;
  /** 이 개수 미만으로 추적 중이면 삭제 안전장치를 적용하지 않는다. 기본 5 */
  guardMinTracked?: number;
}

/**
 * 로컬·원격·마지막 동기화 기록(base 해시) 세 가지를 비교해 계획을 세운다. 순수 함수 — 아무것도 읽거나 쓰지 않는다.
 *
 * 경로마다 (L=로컬 해시, R=원격 해시, B=기록 해시)로 판단한다.
 *  - 기록이 없으면: 한쪽만 있으면 새 파일(push/pull), 양쪽이 같으면 기록만, 다르면 병합(기록이 없어 충돌 사본).
 *  - 기록이 있으면: 안 바뀐 쪽은 바뀐 쪽을 따라간다(삭제 포함). 양쪽이 바뀌었으면 같으면 기록만,
 *    한쪽이 삭제면 수정된 쪽을 살리고, 둘 다 수정이면 병합.
 *  - 이름 변경: fileId(원격)와 같은 해시(로컬)로 추적해 업로드·삭제 대신 이동으로 처리한다.
 */
export function planSync(input: PlanInput): SyncPlan {
  const ok = input.isSyncable ?? (() => true);
  const L = new Map(input.local.filter((f) => ok(f.path)).map((f) => [f.path, f]));
  const R = new Map(input.remote.filter((f) => ok(f.path)).map((f) => [f.path, f]));
  const E = new Map(input.entries.filter((e) => ok(e.path)).map((e) => [e.path, e]));
  const remoteById = new Map([...R.values()].map((f) => [f.id, f]));

  const ops: SyncOp[] = [];
  const handled = new Set<SyncPath>();

  // 1) 원격에서 이름이 바뀐 파일: 로컬은 그대로이고 새 경로에 로컬 파일이 없을 때만 이동으로 따라간다.
  for (const e of E.values()) {
    const r = remoteById.get(e.driveId);
    if (!r || r.path === e.path) continue;
    const l = L.get(e.path);
    if (l && l.hash === e.hash && r.hash === e.hash && !L.has(r.path) && !E.has(r.path)) {
      ops.push({ type: 'moveLocal', from: e.path, to: r.path, remote: r, entry: e });
      handled.add(e.path).add(r.path);
    }
  }

  // 2) 로컬에서 이름이 바뀐 파일: 기록은 있는데 로컬에서 사라졌고, 같은 해시의 새 파일이 (유일하게) 나타난 경우.
  const added = new Map<string, LocalFile[]>();
  for (const l of L.values()) {
    if (E.has(l.path) || R.has(l.path) || handled.has(l.path)) continue;
    (added.get(l.hash) ?? added.set(l.hash, []).get(l.hash)!).push(l);
  }
  const vanished = new Map<string, SyncEntry[]>();
  for (const e of E.values()) {
    if (L.has(e.path) || handled.has(e.path)) continue;
    const r = R.get(e.path);
    if (r && r.id === e.driveId && r.hash === e.hash) (vanished.get(e.hash) ?? vanished.set(e.hash, []).get(e.hash)!).push(e);
  }
  for (const [hash, gone] of vanished) {
    const now = added.get(hash);
    if (gone.length !== 1 || !now || now.length !== 1) continue;
    const e = gone[0]!;
    const r = R.get(e.path)!;
    ops.push({ type: 'moveRemote', from: e.path, to: now[0]!.path, remote: r, entry: e, hash });
    handled.add(e.path).add(now[0]!.path);
  }

  // 3) 나머지는 경로별로 판단한다.
  const paths = new Set<SyncPath>([...L.keys(), ...R.keys(), ...E.keys()]);
  for (const path of [...paths].sort()) {
    if (handled.has(path)) continue;
    const l = L.get(path);
    const r = R.get(path);
    const e = E.get(path);

    if (!e) {
      if (l && r) {
        if (l.hash === r.hash) ops.push({ type: 'record', path, remote: r, hash: l.hash });
        else ops.push({ type: 'merge', path, remote: r, entry: null });
      } else if (l) ops.push({ type: 'push', path, reason: 'new' });
      else if (r) ops.push({ type: 'pull', path, remote: r, reason: 'new' });
      continue;
    }

    const lc = (l?.hash ?? null) !== e.hash;
    const rc = (r?.hash ?? null) !== e.hash;
    const existing = r ? { id: r.id, revision: r.revision } : undefined;
    if (!lc && !rc) continue;
    if (lc && !rc) {
      if (l) ops.push({ type: 'push', path, existing, reason: 'changed' });
      else if (r) ops.push({ type: 'trashRemote', path, entry: e, remote: r });
      else ops.push({ type: 'forget', path });
    } else if (!lc && rc) {
      if (r) ops.push({ type: 'pull', path, remote: r, reason: 'changed' });
      else ops.push({ type: 'trashLocal', path, entry: e });
    } else if (l && r) {
      if (l.hash === r.hash) ops.push({ type: 'record', path, remote: r, hash: l.hash });
      else ops.push({ type: 'merge', path, remote: r, entry: e });
    } else if (r) {
      ops.push({ type: 'pull', path, remote: r, reason: 'restore' }); // 로컬은 지웠지만 원격은 고쳤다 → 살린다
    } else if (l) {
      ops.push({ type: 'push', path, reason: 'restore' }); // 원격은 지웠지만 로컬은 고쳤다 → 살린다
    } else {
      ops.push({ type: 'forget', path });
    }
  }

  ops.sort((a, b) => priority(a) - priority(b));

  const deletes = ops.filter((o) => o.type === 'trashLocal' || o.type === 'trashRemote').length;
  const tracked = E.size;
  const ratio = input.maxDeleteRatio ?? 0.2;
  const blocked =
    tracked >= (input.guardMinTracked ?? 5) && deletes / tracked > ratio
      ? `파일 ${tracked}개 중 ${deletes}개(${Math.round((deletes / tracked) * 100)}%)를 지우려 해요. 의도한 게 맞는지 확인해 주세요.`
      : null;
  return { ops, deletes, tracked, blocked, firstSync: E.size === 0 };
}

function priority(op: SyncOp): number {
  switch (op.type) {
    case 'moveLocal':
    case 'moveRemote':
      return 0;
    case 'record':
    case 'forget':
      return 1;
    case 'trashLocal':
    case 'trashRemote':
      return 3;
    default:
      return 2;
  }
}
