/**
 * Google Drive v3 REST 클라이언트 — `DriveClient` 인터페이스의 실제 HTTP 구현.
 *
 * - `fetch` 는 주입받는다(테스트에서 가짜 fetch 로 요청 모양을 검증한다).
 * - `drive.file` 스코프를 전제로 하므로 앱이 만든 파일만 보인다.
 * - 볼트 구분은 `appProperties.nopsVault` 로 한다(폴더 이름이 아니라 값이 열쇠). 폴더는
 *   `Nopsidian/<vaultName>/…` 에 만들되, 폴더 자신에도 `nopsVault` 를 붙여 볼트별로 격리한다.
 * - 파일 내용 해시는 `appProperties.contentHash`(sha256)에 저장하고 `md5Checksum` 과
 *   `appProperties.contentMd5` 를 대조해 Drive 웹에서 사람이 고친 파일을 감지한다.
 * - 생성 요청은 같은 이름·부모의 리소스가 이미 있는지 확인한 뒤에만 다시 보낸다(중복 폴더·파일 방지).
 */

import { createHash, randomUUID } from 'node:crypto';
import { t } from '@nopsidian/i18n';

import type { DriveClient, RemoteFile, SyncPath, VaultFolderInfo } from './types.js';
import { RevisionConflictError } from './types.js';

/** 메타데이터·목록 조회 기본 엔드포인트 */
const API_BASE = 'https://www.googleapis.com/drive/v3';
/** 업로드는 업로드 전용 호스트를 쓴다 */
const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3/files';
/** 이 크기 이하는 multipart 한 번, 초과하면 resumable 세션으로 올린다 */
const MULTIPART_LIMIT = 5 * 1024 * 1024;
/** 지수 백오프 상한 */
const MAX_BACKOFF_MS = 32_000;
/** `Retry-After` 로 기다릴 수 있는 상한(5분) — 서버가 몇 시간을 보내도 동기화가 그만큼 멈추지 않게 */
const MAX_RETRY_AFTER_MS = 5 * 60_000;
const FOLDER_MIME = 'application/vnd.google-apps.folder';
/** 목록 조회에서 필요한 필드만 받는다 */
const FILE_FIELDS = 'id,appProperties,headRevisionId,size';
/** 403 이어도 재시도해야 하는 reason */
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

/** 401 — 토큰이 만료·폐기됐다. 재시도해도 소용없다(토큰을 새로 받아야 한다). */
export class DriveAuthError extends Error {
  constructor(message = t('sync.err.driveAuth')) {
    super(message);
    this.name = 'DriveAuthError';
  }
}

/** 그 밖의 비정상 응답(재시도 소진 포함). 네트워크 예외는 status 0 으로 온다. */
export class DriveApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Google API 오류 사유(예: accessNotConfigured, storageQuotaExceeded) */
    public readonly reason?: string,
  ) {
    super(message);
    this.name = 'DriveApiError';
  }
}

export interface GoogleDriveOptions {
  /** Node 18+ 전역 fetch 시그니처. 테스트에서 가짜 fetch 를 넣는다. */
  fetch: typeof fetch;
  /** 호출마다 최신 토큰을 받는다(만료 직전 재발급 대응) */
  getAccessToken: () => Promise<string>;
  /** 볼트 식별자(appProperties.nopsVault 값). 폴더 이름과 무관하게 이 볼트의 파일을 찾는 열쇠 */
  vaultKey: string;
  /** Drive 폴더 이름: Nopsidian/<vaultName>/… */
  vaultName: string;
  /** 재시도 대기(테스트에서 주입). 기본 setTimeout */
  sleep?: (ms: number) => Promise<void>;
  /** 재시도 횟수(최초 시도 제외). 기본 5 */
  maxRetries?: number;
}

/**
 * 결과를 모르는 요청(POST 생성)을 다시 보내기 전에 "이미 만들어졌는지" 확인하는 훅.
 * 이미 있으면 그 리소스를 응답처럼 돌려주고, 없으면 null 을 돌려준다.
 */
type Reconcile = () => Promise<Response | null>;

/** 요청에 쓰는 최소 init — 헤더는 평범한 객체로만 넘긴다 */
interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: Uint8Array | string;
  /** 네트워크 오류·5xx 로 재시도하기 전에 부른다(중복 생성 방지) */
  reconcile?: Reconcile;
}

/**
 * Node 의 fetch 는 `Uint8Array` 본문을 그대로 받지만, lib.dom 의 `BodyInit`(=`BufferSource`)은
 * `ArrayBufferView<ArrayBuffer>` 만 허용해서 `Uint8Array<ArrayBufferLike>` 를 통과시키지 못한다.
 * 큰 파일을 복사하지 않으려면 여기서 한 번만 타입을 맞춰 준다.
 */
const asBody = (body: Uint8Array | string | undefined): BodyInit | undefined =>
  body as unknown as BodyInit | undefined;

interface DriveFile {
  id: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  headRevisionId?: string;
  size?: string;
  md5Checksum?: string;
}

interface FileList {
  nextPageToken?: string;
  files?: DriveFile[];
}

interface DriveErrorBody {
  error?: { errors?: Array<{ reason?: string }> };
}

interface AboutResponse {
  user?: { emailAddress?: string };
}

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const md5Hex = (bytes: Uint8Array): string => createHash('md5').update(bytes).digest('hex');

/** Drive 쿼리 문자열 안의 작은따옴표 리터럴용 이스케이프 */
const escapeQuery = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** 'a/b/c.md' → 'a/b' (루트면 '') */
const parentPath = (path: string): string => {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
};

/** 'a/b/c.md' → 'c.md' */
const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** multipart/related 본문 조립 — JSON 메타데이터 파트 + octet-stream 본문 파트 */
function buildMultipart(metadata: unknown, bytes: Uint8Array): { contentType: string; body: Uint8Array } {
  const boundary = `nopsidian-${randomUUID()}`;
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}` +
      `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  return { contentType: `multipart/related; boundary=${boundary}`, body };
}

export class GoogleDriveClient implements DriveClient {
  private readonly fetchImpl: typeof fetch;
  private readonly getAccessToken: () => Promise<string>;
  private readonly vaultKey: string;
  private readonly vaultName: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  /** 'Nopsidian/<vaultName>/…' 상대 폴더 경로 → 폴더 id */
  private readonly folderIds = new Map<string, string>();
  /** headRevisionId → 이미 계산해 둔 sha256(같은 revision 을 여러 번 받지 않는다) */
  private readonly hashesByRevision = new Map<string, string>();
  /** fileId → 마지막으로 안 내용 sha256(move 응답에 contentHash 가 없을 때 대비) */
  private readonly hashesById = new Map<string, string>();

  constructor(opts: GoogleDriveOptions) {
    this.fetchImpl = opts.fetch;
    this.getAccessToken = opts.getAccessToken;
    this.vaultKey = opts.vaultKey;
    this.vaultName = opts.vaultName;
    this.sleep = opts.sleep ?? defaultSleep;
    this.maxRetries = opts.maxRetries ?? 5;
  }

  /** Drive about.user 의 이메일(읽기 전용). 이 권한으로 볼 수 없으면 null. 인증 오류는 그대로 알린다. */
  async accountEmail(): Promise<string | null> {
    try {
      const res = await this.request(`${API_BASE}/about?fields=user`);
      const data = (await res.json()) as AboutResponse;
      const email = data.user?.emailAddress;
      return typeof email === 'string' && email.includes('@') ? email : null;
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      if (e instanceof DriveAuthError || name === 'AuthRevokedError' || name === 'OAuthError') throw e;
      return null;
    }
  }

  /**
   * 이 볼트의 `Nopsidian/<vaultName>` 폴더를 읽기 전용으로 확인한다.
   * 없으면 exists=false 로 돌려주고 절대 만들지 않는다('지금 확인'이 동기화 동작을 바꾸지 않게).
   */
  async inspectVaultFolder(): Promise<VaultFolderInfo> {
    const path = `Nopsidian/${this.vaultName}`;
    let parent = 'root';
    for (const name of ['Nopsidian', this.vaultName]) {
      const id = await this.findFolder(name, parent);
      if (id === undefined) return { name: this.vaultName, path, id: null, exists: false };
      parent = id;
    }
    return { name: this.vaultName, path, id: parent, exists: true };
  }

  async list(): Promise<RemoteFile[]> {
    const q =
      `appProperties has { key='nopsVault' and value='${escapeQuery(this.vaultKey)}' }` +
      ` and trashed=false and mimeType!='${FOLDER_MIME}'`;
    const params = new URLSearchParams({
      q,
      fields: 'nextPageToken,files(id,parents,appProperties,headRevisionId,size,md5Checksum)',
      pageSize: '1000',
      spaces: 'drive',
    });

    const result: RemoteFile[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams(params);
      if (pageToken) query.set('pageToken', pageToken);
      const res = await this.request(`${API_BASE}/files?${query}`);
      const page = (await res.json()) as FileList;
      for (const file of page.files ?? []) {
        const remote = await this.toRemoteFile(file);
        if (remote) result.push(remote);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return result;
  }

  async download(id: string): Promise<Uint8Array> {
    const res = await this.request(`${API_BASE}/files/${encodeURIComponent(id)}?alt=media`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async upload(args: {
    path: SyncPath;
    bytes: Uint8Array;
    hash: string;
    existing?: { id: string; revision: string };
  }): Promise<RemoteFile> {
    const { path, bytes, hash, existing } = args;
    const parentId = await this.ensureFolder(parentPath(path));
    const appProperties: Record<string, string> = {
      nopsVault: this.vaultKey,
      relPath: path,
      contentHash: hash,
      contentMd5: md5Hex(bytes),
    };

    // 새 파일인데 같은 부모에 같은 이름이 이미 있으면 새로 만들지 않는다 — 목록 조회와 업로드 사이의 경합이거나
    // Drive 웹에서 사람이 만든 파일이다. 우리 파일(relPath 일치)이면 그대로 덮어쓰고, 남의 파일이면
    // 중복을 만들지 않고 실패시킨다(MemoryDrive 도 같은 경로로의 새 업로드를 거부한다).
    let target = existing;
    if (!target) {
      const found = await this.findFileByName(baseName(path), parentId);
      if (found && found.appProperties?.nopsVault === this.vaultKey && found.appProperties.relPath === path) {
        target = { id: found.id, revision: found.headRevisionId ?? '' };
      } else if (found) {
        throw new Error(t('sync.err.nameExists', { path }));
      }
    }

    // 기존 파일 교체는 parents 를 건드리지 않는다(경로 이동은 move 담당).
    const metadata = target ? { appProperties } : { name: baseName(path), parents: [parentId], appProperties };

    if (target) {
      // 업로드 전에 현재 revision 을 확인 — 그 사이 원격이 바뀌었으면 이번 동기화에서는 건너뛴다.
      const current = await this.headRevision(target.id);
      if (current !== target.revision) throw new RevisionConflictError(path);
    }

    // 새 파일 POST 는 응답을 못 받았을 때(네트워크 오류·5xx) 이미 만들어졌는지 확인한 뒤 재시도한다.
    const reconcile: Reconcile | undefined = target
      ? undefined
      : async () => {
          const found = await this.findFileByName(baseName(path), parentId);
          const props = found?.appProperties;
          return found && props?.relPath === path && props.contentHash === hash ? jsonResponse(found) : null;
        };

    const res =
      bytes.length > MULTIPART_LIMIT
        ? await this.uploadResumable(target ? 'PATCH' : 'POST', target?.id, metadata, bytes, reconcile)
        : await this.uploadMultipart(target ? 'PATCH' : 'POST', target?.id, metadata, bytes, reconcile);

    const file = (await res.json()) as DriveFile;
    const revision = file.headRevisionId ?? '';
    if (revision) this.hashesByRevision.set(revision, hash);
    this.hashesById.set(file.id, hash);
    return {
      id: file.id,
      path: file.appProperties?.relPath ?? path,
      hash: file.appProperties?.contentHash ?? hash,
      revision,
      size: Number(file.size ?? 0),
    };
  }

  async move(id: string, to: SyncPath): Promise<RemoteFile> {
    const current = await this.request(`${API_BASE}/files/${encodeURIComponent(id)}?fields=parents`);
    const parents = ((await current.json()) as DriveFile).parents ?? [];
    const newParent = await this.ensureFolder(parentPath(to));

    const params = new URLSearchParams({ fields: FILE_FIELDS });
    // 부모가 이미 같으면 addParents/removeParents 를 보내지 않는다(불필요한 요청 변수 제거).
    if (!(parents.length === 1 && parents[0] === newParent)) {
      params.set('addParents', newParent);
      if (parents.length > 0) params.set('removeParents', parents.join(','));
    }

    const res = await this.request(`${API_BASE}/files/${encodeURIComponent(id)}?${params}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: baseName(to), appProperties: { relPath: to } }),
    });
    const file = (await res.json()) as DriveFile;
    const hash = file.appProperties?.contentHash ?? this.hashesById.get(id) ?? '';
    if (hash) this.hashesById.set(id, hash);
    return {
      id: file.id,
      path: file.appProperties?.relPath ?? to,
      hash,
      revision: file.headRevisionId ?? '',
      size: Number(file.size ?? 0),
    };
  }

  async trash(id: string): Promise<void> {
    await this.request(`${API_BASE}/files/${encodeURIComponent(id)}?fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ trashed: true }),
    });
  }

  /** Drive 파일 리소스 → RemoteFile. `relPath` 가 없으면 이 볼트의 파일이 아니므로 null. */
  private async toRemoteFile(file: DriveFile): Promise<RemoteFile | null> {
    const relPath = file.appProperties?.relPath;
    if (!relPath) return null;

    const revision = file.headRevisionId ?? '';
    let hash = file.appProperties?.contentHash ?? '';
    const md5 = file.md5Checksum;
    // Drive 웹에서 사람이 고치면 내용만 바뀌고 appProperties 는 그대로다.
    // md5Checksum 이 우리가 기록한 contentMd5 와 다르면 contentHash 를 믿지 않는다.
    if (md5 && md5 !== file.appProperties?.contentMd5) {
      const cached = revision ? this.hashesByRevision.get(revision) : undefined;
      if (cached !== undefined) {
        hash = cached;
      } else {
        hash = sha256Hex(await this.download(file.id));
        if (revision) this.hashesByRevision.set(revision, hash);
      }
    }
    this.hashesById.set(file.id, hash);
    return { id: file.id, path: relPath, hash, revision, size: Number(file.size ?? 0) };
  }

  /** 현재 revision(낙관적 동시성 검사용) */
  private async headRevision(id: string): Promise<string> {
    const res = await this.request(`${API_BASE}/files/${encodeURIComponent(id)}?fields=headRevisionId`);
    return ((await res.json()) as DriveFile).headRevisionId ?? '';
  }

  /** 경로의 상위 폴더들을 `Nopsidian` → `<vaultName>` → … 순서로 찾거나 만든다. 결과는 메모리 캐시. */
  private async ensureFolder(relDir: string): Promise<string> {
    const cached = this.folderIds.get(relDir);
    if (cached) return cached;

    const segments = relDir === '' ? [] : relDir.split('/').filter(Boolean);
    const chain = ['Nopsidian', this.vaultName, ...segments];
    let parent = 'root';
    let walked = '';
    for (const name of chain) {
      walked = walked === '' ? name : `${walked}/${name}`;
      let id = this.folderIds.get(walked);
      if (!id) {
        id = (await this.findFolder(name, parent)) ?? (await this.createFolder(name, parent));
        this.folderIds.set(walked, id);
      }
      parent = id;
    }
    return parent;
  }

  /** 같은 부모 아래 이 볼트의 폴더를 찾는다. 없으면 undefined. */
  private async findFolder(name: string, parent: string): Promise<string | undefined> {
    const q =
      `name='${escapeQuery(name)}' and '${escapeQuery(parent)}' in parents` +
      ` and mimeType='${FOLDER_MIME}' and trashed=false` +
      ` and appProperties has { key='nopsVault' and value='${escapeQuery(this.vaultKey)}' }`;
    const res = await this.request(`${API_BASE}/files?${new URLSearchParams({ q, fields: 'files(id)' })}`);
    const data = (await res.json()) as FileList;
    return data.files?.[0]?.id;
  }

  /** 같은 부모 아래 같은 이름의 파일(폴더 제외, 휴지통 제외)을 찾는다. 없으면 undefined. */
  private async findFileByName(name: string, parent: string): Promise<DriveFile | undefined> {
    const q =
      `name='${escapeQuery(name)}' and '${escapeQuery(parent)}' in parents` +
      ` and mimeType!='${FOLDER_MIME}' and trashed=false`;
    const res = await this.request(`${API_BASE}/files?${new URLSearchParams({ q, fields: `files(${FILE_FIELDS})` })}`);
    const data = (await res.json()) as FileList;
    return data.files?.[0];
  }

  private async createFolder(name: string, parent: string): Promise<string> {
    const res = await this.request(`${API_BASE}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        parents: [parent],
        appProperties: { nopsVault: this.vaultKey },
      }),
      // 응답을 못 받은 채 재시도할 때 같은 부모·이름의 폴더가 이미 있으면 그것을 쓴다(중복 폴더 방지).
      reconcile: async () => {
        const id = await this.findFolder(name, parent);
        return id === undefined ? null : jsonResponse({ id });
      },
    });
    return ((await res.json()) as DriveFile).id;
  }

  private async uploadMultipart(
    method: 'POST' | 'PATCH',
    fileId: string | undefined,
    metadata: unknown,
    bytes: Uint8Array,
    reconcile?: Reconcile,
  ): Promise<Response> {
    const { contentType, body } = buildMultipart(metadata, bytes);
    return this.request(this.uploadUrl(fileId, 'multipart'), {
      method,
      headers: { 'Content-Type': contentType, 'Content-Length': String(body.length) },
      body,
      ...(reconcile ? { reconcile } : {}),
    });
  }

  /** 큰 파일: 세션을 열고(메타데이터) Location 으로 본문을 PUT 한다 */
  private async uploadResumable(
    method: 'POST' | 'PATCH',
    fileId: string | undefined,
    metadata: unknown,
    bytes: Uint8Array,
    reconcile?: Reconcile,
  ): Promise<Response> {
    const session = await this.request(this.uploadUrl(fileId, 'resumable'), {
      method,
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(metadata),
    });
    const location = session.headers.get('location');
    if (!location) {
      throw new DriveApiError(t('sync.err.noLocation'), session.status);
    }
    // 세션 만들기(POST)는 리소스를 만들지 않으므로 확인 없이 재시도해도 되고, 본문 PUT 만 확인한다.
    return this.request(location, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length) },
      body: bytes,
      ...(reconcile ? { reconcile } : {}),
    });
  }

  private uploadUrl(fileId: string | undefined, uploadType: 'multipart' | 'resumable'): string {
    const params = new URLSearchParams({ uploadType, fields: FILE_FIELDS });
    return fileId ? `${UPLOAD_BASE}/${encodeURIComponent(fileId)}?${params}` : `${UPLOAD_BASE}?${params}`;
  }

  /**
   * 모든 요청의 공통 래퍼: Authorization 부착, 401 → DriveAuthError,
   * 429·5xx·403(rate limit) 및 네트워크 예외 → 지수 백오프 재시도 후 DriveApiError,
   * 그 밖의 4xx → 즉시 DriveApiError.
   * 생성(POST) 요청은 결과를 모른 채 다시 보내면 중복이 생기므로, 네트워크 예외·5xx 뒤에는
   * `reconcile` 로 이미 만들어졌는지 먼저 확인한다(`init.reconcile` 이 없으면 기존처럼 재시도만 한다).
   */
  private async request(url: string, init: FetchInit = {}): Promise<Response> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...init.headers };

    /** 이미 만들어졌으면 그 리소스를 응답처럼 돌려준다. 확인 실패는 재시도를 막지 않는다. */
    const alreadyCreated = async (): Promise<Response | null> => {
      if (!init.reconcile) return null;
      try {
        return await init.reconcile();
      } catch (err) {
        if (err instanceof DriveAuthError) throw err;
        return null;
      }
    };

    for (let attempt = 0; ; attempt++) {
      let res: Response | null = null;
      let failure: unknown;
      try {
        res = await this.fetchImpl(url, { method: init.method ?? 'GET', headers, body: asBody(init.body) });
      } catch (err) {
        failure = err;
      }

      if (!res) {
        const already = await alreadyCreated();
        if (already) return already;
        if (attempt >= this.maxRetries) {
          throw new DriveApiError(t('sync.err.network', { message: errorText(failure) }), 0);
        }
        await this.sleep(this.backoffMs(attempt, null));
        continue;
      }

      if (res.status === 401) throw new DriveAuthError();
      if (!(await isRetryable(res))) {
        if (!res.ok) throw await apiError(res);
        return res;
      }
      // 5xx 는 요청이 처리됐는지 알 수 없다(프록시·게이트웨이). 429·403 은 거부된 것이 확실하므로 확인하지 않는다.
      if (res.status >= 500) {
        const already = await alreadyCreated();
        if (already) return already;
      }
      if (attempt >= this.maxRetries) throw await apiError(res);
      await this.sleep(this.backoffMs(attempt, res.headers.get('retry-after')));
    }
  }

  /** 1s, 2s, 4s … 상한 32s. `Retry-After`(초 또는 HTTP-date)가 있으면 그 값을 우선하되 5분까지만 기다린다. */
  private backoffMs(attempt: number, retryAfter: string | null): number {
    const asked = retryAfter === null ? Number.NaN : retryAfterMs(retryAfter);
    if (Number.isFinite(asked) && asked >= 0) return Math.min(asked, MAX_RETRY_AFTER_MS);
    return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
  }
}

/** `Retry-After` 헤더 → 대기 밀리초. 초 단위(`3`)와 HTTP-date(`Wed, 21 Oct 2015 07:28:00 GMT`)를 받는다. 해석할 수 없으면 NaN. */
function retryAfterMs(value: string): number {
  const text = value.trim();
  if (text === '') return Number.NaN;
  const seconds = Number(text);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : Number.NaN;
  const at = Date.parse(text);
  return Number.isNaN(at) ? Number.NaN : Math.max(0, at - Date.now());
}

/** 재시도 전 확인(reconcile)에서 찾은 리소스를 업로드 응답처럼 돌려줄 때 쓴다 */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 429, 5xx, 그리고 403 중 rate limit 사유만 재시도 대상이다. */
async function isRetryable(res: Response): Promise<boolean> {
  if (res.status === 429 || res.status >= 500) return true;
  if (res.status !== 403) return false;
  try {
    const body = (await res.clone().json()) as DriveErrorBody;
    const reason = body.error?.errors?.[0]?.reason;
    return reason !== undefined && RATE_LIMIT_REASONS.has(reason);
  } catch {
    return false;
  }
}

async function apiError(res: Response): Promise<DriveApiError> {
  let detail = '';
  let reason: string | undefined;
  try {
    const bodyText = await res.text();
    detail = bodyText.slice(0, 300);
    try {
      const body = JSON.parse(bodyText) as DriveErrorBody;
      reason = body.error?.errors?.[0]?.reason;
    } catch {
      // JSON 이 아니면 사유를 알 수 없다
    }
  } catch {
    // 본문이 없거나 읽을 수 없으면 statusText 만 남긴다
  }
  return new DriveApiError(`Drive API ${res.status}: ${detail || res.statusText}`, res.status, reason);
}
