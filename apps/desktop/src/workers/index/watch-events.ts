import path from 'node:path';

/** 큐에 넣을 변화 종류(인덱스에 반영하는 방식이 파일마다 같다) */
export type PendingKind = 'add' | 'change' | 'unlink';

/** @parcel/watcher 의 Event 와 같은 모양 — 테스트에서 실제 감시자 없이 쓰려고 최소한만 적는다 */
export interface WatchEvent {
  path: string;
  type: 'create' | 'update' | 'delete';
}

/** 폴더인지 보는 데만 쓰는 최소 표면(실제로는 `lstat` 을 넘겨 심볼릭 링크를 따라가지 않는다) */
export interface WatchStats {
  isDirectory(): boolean;
}

export interface WatchFs {
  stat(p: string): Promise<WatchStats>;
  readdir(p: string): Promise<string[]>;
}

/** 이벤트를 분류한 결과: 노트(.md)와 그 밖의 파일 */
export interface PendingBatch {
  notes: Map<string, PendingKind>;
  assets: Map<string, PendingKind>;
}

/** 인덱서의 폴더 훑기(`walkFiles`)와 같은 규칙: 점으로 시작하는 이름과 node_modules 는 건너뛴다. */
const isIgnoredName = (name: string) => name.startsWith('.') || name === 'node_modules';

const toRel = (root: string, p: string) => path.relative(root, p).split(path.sep).join('/');

/** 감시 대상이 아닌 경로(볼트 밖, 점 폴더 안, node_modules 안)인지 */
function isIgnored(rel: string) {
  return !rel || rel.split('/').some((seg) => seg.startsWith('.') || seg === 'node_modules');
}

/** 한 파일을 종류에 맞는 큐에 넣는다 — 폴더를 훑은 파일도 일반 이벤트와 같은 규칙을 쓴다. */
function queue(batch: PendingBatch, rel: string, kind: PendingKind) {
  if (rel.toLowerCase().endsWith('.md')) batch.notes.set(rel, kind);
  else if (!rel.includes('.nops-tmp-')) batch.assets.set(rel, kind);
}

/** 폴더 안의 파일을 모두 모은다. 저장 중인 임시 파일(`.nops-tmp-`)과 감시 제외 폴더는 건너뛴다. */
async function walkFiles(dir: string, fs: WatchFs, out: string[]): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return; // 읽을 수 없는 폴더는 그냥 넘어간다
  }
  for (const name of names) {
    if (isIgnoredName(name) || name.includes('.nops-tmp-')) continue;
    const full = path.join(dir, name);
    let st: WatchStats;
    try {
      st = await fs.stat(full);
    } catch {
      continue; // 그 사이에 사라진 파일
    }
    if (st.isDirectory()) await walkFiles(full, fs, out);
    else out.push(full);
  }
}

/**
 * 감시 이벤트를 인덱싱 큐(노트/첨부)로 나눈다.
 * Linux(inotify)는 폴더를 만들고 곧바로 파일을 채워도 폴더 create 이벤트만 준다 →
 * create/update 가 폴더를 가리키면 그 안을 직접 훑어 파일마다 add 로 넣는다.
 * 지워진 경로나 볼트 밖 경로는 무시한다.
 */
export async function classifyWatchEvents(events: WatchEvent[], watchRoot: string, fs: WatchFs): Promise<PendingBatch> {
  const batch: PendingBatch = { notes: new Map(), assets: new Map() };
  for (const e of events) {
    const rel = toRel(watchRoot, e.path);
    if (isIgnored(rel)) continue;
    if (e.type !== 'delete') {
      let st: WatchStats;
      try {
        st = await fs.stat(e.path);
      } catch {
        continue; // 없는 경로(이미 지워졌거나 다른 곳으로 옮겨짐)는 무시한다
      }
      if (st.isDirectory()) {
        const files: string[] = [];
        await walkFiles(e.path, fs, files);
        // 폴더 안에서 찾은 파일은 "폴더가 생기면서 같이 생긴 것"으로 보고 add 로 넣는다
        for (const f of files) {
          const childRel = toRel(watchRoot, f);
          if (!isIgnored(childRel)) queue(batch, childRel, 'add');
        }
        continue;
      }
    }
    queue(batch, rel, e.type === 'delete' ? 'unlink' : e.type === 'create' ? 'add' : 'change');
  }
  return batch;
}
