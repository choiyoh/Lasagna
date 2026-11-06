import type { MessageKey } from '@nopsidian/i18n';
/**
 * Drive 동기화 엔진의 경계 타입. 엔진은 Drive·파일시스템·상태 저장소를 이 인터페이스로만 만나므로
 * 순수 TS로 테스트할 수 있고(메모리 가짜 구현), 실제 구현은 Main/SyncWorker 쪽에서 끼워 넣는다.
 */

/** 볼트 루트 기준 상대 경로(슬래시 구분, NFC). */
export type SyncPath = string;

/** 로컬 파일 스캔 결과 */
export interface LocalFile {
  path: SyncPath;
  /** 내용 SHA-256(hex) */
  hash: string;
  size: number;
}

/** Drive 쪽 파일. 경로는 `appProperties.relPath` 에서 읽는다. */
export interface RemoteFile {
  /** Drive fileId — 이름이 바뀌어도 유지되므로 이동 추적에 쓴다 */
  id: string;
  path: SyncPath;
  /** `appProperties.contentHash` (SHA-256 hex) */
  hash: string;
  /** 내용이 바뀔 때마다 달라지는 값(headRevisionId). 낙관적 동시성 검사에 쓴다 */
  revision: string;
  size: number;
}

/** 마지막으로 동기화가 끝난 시점의 기록(기기별, 동기화 대상 아님) */
export interface SyncEntry {
  path: SyncPath;
  driveId: string;
  /** 그때 양쪽이 같았던 내용의 해시 — 3-way 병합의 base 해시 */
  hash: string;
  /** 그때의 Drive revision */
  revision: string;
}

/** 업로드 중 Drive 쪽이 이미 바뀌었을 때 던진다. 엔진은 이 작업을 건너뛰고 다음 동기화에 다시 계획한다. */
export class RevisionConflictError extends Error {
  readonly key: MessageKey = 'sync.err.remoteAhead';
  readonly params: Record<string, string | number>;
  constructor(public readonly path: SyncPath) {
    super('sync.err.remoteAhead');
    this.params = { path };
    this.name = 'RevisionConflictError';
  }
}

/** '지금 확인'용 — 네트워크에서 읽기만 하고 폴더를 만들지 않는다. */
export interface VaultFolderInfo {
  /** Drive 폴더 이름(볼트 이름) */
  name: string;
  /** 표시용 경로: Nopsidian/<볼트 이름> */
  path: string;
  id: string | null;
  exists: boolean;
}

export interface DriveClient {
  /** 이 볼트의 동기화 대상 파일 전체(휴지통 제외) */
  list(): Promise<RemoteFile[]>;
  download(id: string): Promise<Uint8Array>;
  /**
   * 새 파일(`existing` 없음) 또는 기존 파일 내용 교체. `existing.revision` 이 현재 Drive 의 revision 과
   * 다르면 `RevisionConflictError`. 필요한 상위 폴더는 구현이 만든다.
   */
  upload(args: { path: SyncPath; bytes: Uint8Array; hash: string; existing?: { id: string; revision: string } }): Promise<RemoteFile>;
  /** 같은 fileId 로 경로(이름·폴더)만 바꾼다. */
  move(id: string, to: SyncPath): Promise<RemoteFile>;
  /** Drive 휴지통으로 보낸다(영구 삭제 아님). */
  trash(id: string): Promise<void>;
}

export interface LocalStore {
  /** 동기화 대상 파일 전체 */
  scan(): Promise<LocalFile[]>;
  read(path: SyncPath): Promise<Uint8Array>;
  /** 원자적 쓰기(상위 폴더 생성 포함). 쓴 뒤의 LocalFile 을 돌려준다. */
  write(path: SyncPath, bytes: Uint8Array): Promise<LocalFile>;
  /** 볼트 휴지통(`.nopsidian/trash/`)으로 보낸다. */
  trash(path: SyncPath): Promise<void>;
  move(from: SyncPath, to: SyncPath): Promise<void>;
  exists(path: SyncPath): Promise<boolean>;
}

/** 동기화 상태 + 3-way 병합의 base 스냅샷 저장소 */
export interface SyncState {
  entries(): Promise<SyncEntry[]>;
  put(entry: SyncEntry): Promise<void>;
  remove(path: SyncPath): Promise<void>;
  /** base 스냅샷(마지막 동기화 시점의 내용). 텍스트 병합에만 쓴다. */
  getBase(path: SyncPath): Promise<Uint8Array | null>;
  putBase(path: SyncPath, bytes: Uint8Array): Promise<void>;
  removeBase(path: SyncPath): Promise<void>;
}

/** 텍스트 3-way 병합 — 주입한다(실제로는 `@nopsidian/core` 의 merge3). */
export type MergeText = (base: string, local: string, remote: string) => { text: string; clean: boolean; conflicts: number };

/** 계획의 한 단계. 경로 하나(또는 이동 한 쌍)에 대한 결정이다. */
export type SyncOp =
  | { type: 'push'; path: SyncPath; existing?: { id: string; revision: string }; reason: 'new' | 'changed' | 'restore' }
  | { type: 'pull'; path: SyncPath; remote: RemoteFile; reason: 'new' | 'changed' | 'restore' }
  | { type: 'merge'; path: SyncPath; remote: RemoteFile; entry: SyncEntry | null }
  | { type: 'trashLocal'; path: SyncPath; entry: SyncEntry }
  | { type: 'trashRemote'; path: SyncPath; entry: SyncEntry; remote: RemoteFile }
  | { type: 'moveLocal'; from: SyncPath; to: SyncPath; remote: RemoteFile; entry: SyncEntry }
  | { type: 'moveRemote'; from: SyncPath; to: SyncPath; remote: RemoteFile; entry: SyncEntry; hash: string }
  /** 양쪽이 이미 같은 내용: 기록만 맞춘다 */
  | { type: 'record'; path: SyncPath; remote: RemoteFile; hash: string }
  /** 양쪽에서 모두 사라짐: 기록만 지운다 */
  | { type: 'forget'; path: SyncPath };

export interface SyncPlan {
  ops: SyncOp[];
  /** 삭제(휴지통 이동) 작업 수 / 기록된 파일 수 — 안전장치 판단용 */
  deletes: number;
  tracked: number;
  /**
   * 삭제가 너무 많아 멈춘 사유. 있으면 `execute` 는 `force` 없이 실행을 거부한다.
   * @deprecated 화면 표시용 문자열(계획 시점 언어로 고정). 새 코드는 `blockedCode`+`blockedParams` 로 그린다.
   */
  blocked: string | null;
  /** 위 사유의 코드와 값 — 화면에서는 이 값으로 그때그때 번역해 그린다(추가 필드, 구버전은 `blocked` 만 읽는다). */
  blockedCode?: 'deleteRatio';
  blockedParams?: { tracked: number; deletes: number; percent: number };
  /** 첫 동기화(기록이 하나도 없음) — UI가 dry-run 확인을 받는다 */
  firstSync: boolean;
}

export interface OpResult {
  op: SyncOp;
  status: 'done' | 'skipped' | 'failed';
  /** 병합했는데 충돌 표식이 남은 경우 */
  conflict?: boolean;
  /** 충돌 사본을 만든 경우 그 경로 */
  copyPath?: SyncPath;
  /** 지금 언어로 만든 문구(레거시·복사용). 화면은 `errorKey` 가 있으면 그때그때 번역한다. */
  error?: string;
  /** 오류 코드+params(추가 필드) */
  errorKey?: string;
  errorParams?: Record<string, string | number>;
}

export interface SyncReport {
  results: OpResult[];
  pushed: number;
  pulled: number;
  merged: number;
  deleted: number;
  conflicts: number;
  failed: number;
}
