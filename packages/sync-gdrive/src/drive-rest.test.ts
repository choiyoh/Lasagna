import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { DriveApiError, DriveAuthError, GoogleDriveClient, type GoogleDriveOptions } from './drive-rest.js';
import { RevisionConflictError, type RemoteFile } from './types.js';

const VAULT_KEY = 'vault-1';
const VAULT_NAME = 'MyVault';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MULTIPART_LIMIT = 5 * 1024 * 1024;
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const md5 = (bytes: Uint8Array): string => createHash('md5').update(bytes).digest('hex');
const utf8 = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array | string | null | undefined;
}

/** 요청 URL·메서드·헤더·본문을 그대로 넘겨주는 가짜 fetch */
function makeFetch(handler: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = async (input: unknown, init?: unknown): Promise<Response> => {
    const i = (init ?? {}) as { method?: string; headers?: Record<string, string>; body?: Call['body'] };
    const call: Call = { url: String(input), method: i.method ?? 'GET', headers: i.headers ?? {}, body: i.body };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { fetch: impl as unknown as typeof fetch, calls };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** Drive 파일 리소스 응답(기본적으로 md5Checksum == appProperties.contentMd5 라 재다운로드가 없다) */
function driveFile(id: string, relPath: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    parents: ['parent-1'],
    appProperties: { nopsVault: VAULT_KEY, relPath, contentHash: `hash-${id}`, contentMd5: 'md5-ok' },
    headRevisionId: `rev-${id}`,
    size: '12',
    md5Checksum: 'md5-ok',
    ...extra,
  };
}

function setup(fetchImpl: typeof fetch, extra: Partial<GoogleDriveOptions> = {}) {
  const sleeps: number[] = [];
  const client = new GoogleDriveClient({
    fetch: fetchImpl,
    getAccessToken: async () => 'tok',
    vaultKey: VAULT_KEY,
    vaultName: VAULT_NAME,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...extra,
  });
  return { client, sleeps };
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

/** 폴더 이름 조회 요청이면 그 이름, 아니면 undefined */
function folderQueryName(call: Call): string | undefined {
  const q = new URL(call.url).searchParams.get('q') ?? '';
  if (!q.includes(FOLDER_MIME)) return undefined;
  return /^name='((?:\\.|[^'])*)'/.exec(q)?.[1];
}

/** 폴더 찾기(Nopsidian, <vaultName>)를 id 로 응답하는 핸들러 조각 */
function foundFolders(call: Call): Response | undefined {
  const name = folderQueryName(call);
  if (name === 'Nopsidian') return json({ files: [{ id: 'folder-nopsidian' }] });
  if (name === VAULT_NAME) return json({ files: [{ id: 'folder-vault' }] });
  return undefined;
}

/** multipart/related 본문을 메타데이터 JSON 텍스트와 파일 바이트로 쪼갠다 */
function splitMultipart(contentType: string, body: Uint8Array): { metadata: string; file: Uint8Array } {
  const boundary = required(/boundary=(.+)$/.exec(contentType)?.[1], 'boundary 가 없어요');
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`;
  const sep = `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const end = `\r\n--${boundary}--`;
  // latin1 로 보면 1바이트 = 1문자라 인덱스를 그대로 바이트 오프셋으로 쓸 수 있다
  const text = new TextDecoder('latin1').decode(body);
  expect(text.startsWith(head)).toBe(true);
  const sepAt = text.indexOf(sep, head.length);
  expect(sepAt).toBeGreaterThan(head.length);
  const start = sepAt + sep.length;
  expect(text.endsWith(end)).toBe(true);
  return { metadata: text.slice(head.length, sepAt), file: body.slice(start, text.length - end.length) };
}

describe('list', () => {
  it('nextPageToken 을 따라 페이지를 이어 받고 필터·필드를 정확히 보낸다', async () => {
    const { fetch, calls } = makeFetch((call) => {
      const u = new URL(call.url);
      expect(`${u.origin}${u.pathname}`).toBe('https://www.googleapis.com/drive/v3/files');
      expect(u.searchParams.get('pageSize')).toBe('1000');
      expect(u.searchParams.get('spaces')).toBe('drive');
      expect(u.searchParams.get('fields')).toBe(
        'nextPageToken,files(id,parents,appProperties,headRevisionId,size,md5Checksum)',
      );
      expect(u.searchParams.get('q')).toBe(
        `appProperties has { key='nopsVault' and value='${VAULT_KEY}' }` +
          ` and trashed=false and mimeType!='${FOLDER_MIME}'`,
      );
      const pageToken = u.searchParams.get('pageToken');
      if (pageToken === null) return json({ nextPageToken: 'p2', files: [driveFile('id1', 'a.md')] });
      expect(pageToken).toBe('p2');
      return json({ files: [driveFile('id2', 'b.md')] });
    });
    const { client } = setup(fetch);

    const files = await client.list();

    expect(files).toEqual<RemoteFile[]>([
      { id: 'id1', path: 'a.md', hash: 'hash-id1', revision: 'rev-id1', size: 12 },
      { id: 'id2', path: 'b.md', hash: 'hash-id2', revision: 'rev-id2', size: 12 },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.headers.Authorization === 'Bearer tok')).toBe(true);
  });

  it('호출마다 토큰을 새로 받아 쓴다', async () => {
    let token = 0;
    const { fetch, calls } = makeFetch((call) => {
      const pageToken = new URL(call.url).searchParams.get('pageToken');
      return pageToken === null
        ? json({ nextPageToken: 'p2', files: [driveFile('id1', 'a.md')] })
        : json({ files: [driveFile('id2', 'b.md')] });
    });
    const { client } = setup(fetch, { getAccessToken: async () => `tok-${++token}` });

    await client.list();

    expect(calls.map((c) => c.headers.Authorization)).toEqual(['Bearer tok-1', 'Bearer tok-2']);
  });

  it('볼트 키의 작은따옴표·백슬래시를 쿼리 리터럴용으로 이스케이프한다', async () => {
    const { fetch, calls } = makeFetch(() => json({ files: [] }));
    const { client } = setup(fetch, { vaultKey: "v'1\\2" });

    await client.list();

    expect(new URL(required(calls[0], '요청이 없어요').url).searchParams.get('q')).toBe(
      "appProperties has { key='nopsVault' and value='v\\'1\\\\2' }" +
        ` and trashed=false and mimeType!='${FOLDER_MIME}'`,
    );
  });

  it('appProperties.relPath 가 없는 파일은 건너뛴다', async () => {
    const { fetch, calls } = makeFetch(() =>
      json({
        files: [
          { id: 'other', appProperties: { nopsVault: VAULT_KEY }, md5Checksum: 'm', headRevisionId: 'r' },
          driveFile('id2', 'b.md'),
        ],
      }),
    );
    const { client } = setup(fetch);

    const files = await client.list();

    expect(files.map((f) => f.id)).toEqual(['id2']);
    expect(calls.every((c) => !c.url.includes('alt=media'))).toBe(true);
  });

  it('md5Checksum 이 contentMd5 와 다르면 내려받아 sha256 을 다시 계산하고 revision 별로 캐시한다', async () => {
    const content = utf8('Drive 웹에서 고친 내용');
    let downloads = 0;
    const { fetch, calls } = makeFetch((call) => {
      if (call.url.includes('alt=media')) {
        downloads++;
        expect(call.method).toBe('GET');
        return new Response(content);
      }
      return json({
        files: [
          driveFile('id1', 'a.md', {
            appProperties: { nopsVault: VAULT_KEY, relPath: 'a.md', contentHash: '낡은해시', contentMd5: 'md5-old' },
            md5Checksum: 'md5-new',
          }),
        ],
      });
    });
    const { client } = setup(fetch);

    const first = await client.list();
    const second = await client.list();

    const expected = sha(content);
    expect(first[0]?.hash).toBe(expected);
    expect(second[0]?.hash).toBe(expected);
    expect(downloads).toBe(1);
    expect(calls.filter((c) => c.url.includes('alt=media'))).toHaveLength(1);
  });

  it('download 는 alt=media 로 받은 바이트를 그대로 돌려준다', async () => {
    const content = utf8('본문');
    const { fetch, calls } = makeFetch(() => new Response(content));
    const { client } = setup(fetch);

    expect(await client.download('id-1')).toEqual(content);
    expect(required(calls[0], '요청이 없어요').url).toBe(
      'https://www.googleapis.com/drive/v3/files/id-1?alt=media',
    );
  });
});

describe('upload', () => {
  it('새 파일(5MB 이하)은 multipart/related 한 번으로 올린다', async () => {
    const bytes = utf8('# hello');
    const uploaded: Call[] = [];
    const { fetch, calls } = makeFetch((call) => {
      if (folderQueryName(call) === 'notes') return json({ files: [{ id: 'folder-notes' }] });
      const found = foundFolders(call);
      if (found) return found;
      uploaded.push(call);
      return json({
        id: 'new-1',
        appProperties: { nopsVault: VAULT_KEY, relPath: 'notes/a.md', contentHash: sha(bytes), contentMd5: md5(bytes) },
        headRevisionId: 'rev-new',
        size: String(bytes.length),
      });
    });
    const { client } = setup(fetch);

    const file = await client.upload({ path: 'notes/a.md', bytes, hash: sha(bytes) });

    expect(file).toEqual<RemoteFile>({
      id: 'new-1',
      path: 'notes/a.md',
      hash: sha(bytes),
      revision: 'rev-new',
      size: bytes.length,
    });
    const up = required(uploaded[0], '업로드 요청이 없어요');
    const u = new URL(up.url);
    expect(`${u.origin}${u.pathname}`).toBe(UPLOAD_URL);
    expect(u.searchParams.get('uploadType')).toBe('multipart');
    expect(u.searchParams.get('fields')).toBe('id,appProperties,headRevisionId,size');
    expect(up.method).toBe('POST');
    expect(up.headers.Authorization).toBe('Bearer tok');

    const contentType = required(up.headers['Content-Type'], 'Content-Type 이 없어요');
    expect(contentType.startsWith('multipart/related; boundary=')).toBe(true);
    const { metadata, file: fileBytes } = splitMultipart(contentType, required(up.body, '본문이 없어요') as Uint8Array);
    expect(JSON.parse(metadata)).toEqual({
      name: 'a.md',
      parents: ['folder-notes'],
      appProperties: { nopsVault: VAULT_KEY, relPath: 'notes/a.md', contentHash: sha(bytes), contentMd5: md5(bytes) },
    });
    expect(fileBytes).toEqual(bytes);
    // 폴더는 찾기만 했고 만들지 않았다
    expect(calls.some((c) => c.method === 'POST' && new URL(c.url).pathname === '/drive/v3/files')).toBe(false);
  });

  it('없는 상위 폴더는 만들고, 만든 폴더는 캐시해 다시 찾지 않는다', async () => {
    const bytes = utf8('x');
    let folderFinds = 0;
    let folderCreates = 0;
    const creates: Call[] = [];
    const { fetch, calls } = makeFetch((call) => {
      // 폴더 생성은 POST /files?fields=id (q 없음)
      if (call.method === 'POST' && new URL(call.url).pathname === '/drive/v3/files') {
        folderCreates++;
        creates.push(call);
        const body = JSON.parse(required(call.body, '본문이 없어요') as string) as { name: string };
        return json({ id: `created-${body.name}` });
      }
      const name = folderQueryName(call);
      if (name !== undefined) {
        folderFinds++;
        // Nopsidian 만 없다 → 만들어진다
        return json({ files: name === 'Nopsidian' ? [] : [{ id: `found-${name}` }] });
      }
      return json({
        id: 'new-1',
        appProperties: { nopsVault: VAULT_KEY, relPath: 'notes/a.md', contentHash: sha(bytes), contentMd5: md5(bytes) },
        headRevisionId: 'rev-new',
        size: String(bytes.length),
      });
    });
    const { client } = setup(fetch);

    await client.upload({ path: 'notes/a.md', bytes, hash: sha(bytes) });
    expect(folderFinds).toBe(3);
    expect(folderCreates).toBe(1);
    expect(JSON.parse(required(creates[0], '폴더 생성 요청이 없어요').body as string)).toEqual({
      name: 'Nopsidian',
      mimeType: FOLDER_MIME,
      parents: ['root'],
      appProperties: { nopsVault: VAULT_KEY },
    });

    folderFinds = 0;
    folderCreates = 0;
    await client.upload({ path: 'notes/b.md', bytes, hash: sha(bytes) });

    expect(folderFinds).toBe(0);
    expect(folderCreates).toBe(0);
    expect(calls.filter((c) => c.url.includes('uploadType')).length).toBe(2);
  });

  it('5MB 초과는 resumable 세션을 열고 Location 으로 본문을 PUT 한다', async () => {
    const bytes = new Uint8Array(MULTIPART_LIMIT + 1);
    bytes[0] = 1;
    bytes[bytes.length - 1] = 2;
    const { fetch, calls } = makeFetch((call) => {
      const found = foundFolders(call);
      if (found) return found;
      if (call.url === 'https://upload.example/session-1') {
        return json({
          id: 'big-1',
          appProperties: { nopsVault: VAULT_KEY, relPath: 'big.bin', contentHash: sha(bytes), contentMd5: md5(bytes) },
          headRevisionId: 'rev-big',
          size: String(bytes.length),
        });
      }
      return new Response(null, { status: 200, headers: { location: 'https://upload.example/session-1' } });
    });
    const { client } = setup(fetch);

    const file = await client.upload({ path: 'big.bin', bytes, hash: sha(bytes) });

    const init = required(calls.find((c) => c.url.includes('uploadType=resumable')), '세션 요청이 없어요');
    const initUrl = new URL(init.url);
    expect(`${initUrl.origin}${initUrl.pathname}`).toBe(UPLOAD_URL);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json; charset=UTF-8');
    expect(JSON.parse(required(init.body, '세션 본문이 없어요') as string)).toEqual({
      name: 'big.bin',
      parents: ['folder-vault'],
      appProperties: { nopsVault: VAULT_KEY, relPath: 'big.bin', contentHash: sha(bytes), contentMd5: md5(bytes) },
    });

    const put = required(calls.find((c) => c.url === 'https://upload.example/session-1'), 'PUT 요청이 없어요');
    expect(put.method).toBe('PUT');
    expect(put.headers['Content-Type']).toBe('application/octet-stream');
    expect(put.headers['Content-Length']).toBe(String(bytes.length));
    expect(put.body).toBe(bytes);
    expect(file).toEqual<RemoteFile>({
      id: 'big-1',
      path: 'big.bin',
      hash: sha(bytes),
      revision: 'rev-big',
      size: bytes.length,
    });
  });

  it('기존 파일 교체는 revision 을 먼저 확인하고 parents 없이 appProperties 만 PATCH 한다', async () => {
    const bytes = utf8('고친 내용');
    const { fetch, calls } = makeFetch((call) => {
      if (call.url.includes('/drive/v3/files/old-1?fields=headRevisionId')) {
        expect(call.method).toBe('GET');
        return json({ headRevisionId: 'rev-1' });
      }
      const found = foundFolders(call);
      if (found) return found;
      return json({
        id: 'old-1',
        appProperties: { nopsVault: VAULT_KEY, relPath: 'notes/a.md', contentHash: sha(bytes), contentMd5: md5(bytes) },
        headRevisionId: 'rev-2',
        size: String(bytes.length),
      });
    });
    const { client } = setup(fetch);

    const file = await client.upload({
      path: 'notes/a.md',
      bytes,
      hash: sha(bytes),
      existing: { id: 'old-1', revision: 'rev-1' },
    });

    const up = required(calls.find((c) => c.url.includes('uploadType')), '업로드 요청이 없어요');
    const u = new URL(up.url);
    expect(`${u.origin}${u.pathname}`).toBe(`${UPLOAD_URL}/old-1`);
    expect(u.searchParams.get('uploadType')).toBe('multipart');
    expect(up.method).toBe('PATCH');
    const { metadata, file: fileBytes } = splitMultipart(
      required(up.headers['Content-Type'], 'Content-Type 이 없어요'),
      required(up.body, '본문이 없어요') as Uint8Array,
    );
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['appProperties']);
    expect(parsed.appProperties).toEqual({
      nopsVault: VAULT_KEY,
      relPath: 'notes/a.md',
      contentHash: sha(bytes),
      contentMd5: md5(bytes),
    });
    expect(fileBytes).toEqual(bytes);
    expect(file).toEqual<RemoteFile>({
      id: 'old-1',
      path: 'notes/a.md',
      hash: sha(bytes),
      revision: 'rev-2',
      size: bytes.length,
    });
  });

  it('기존 파일 교체 중 원격 revision 이 바뀌었으면 업로드하지 않고 RevisionConflictError', async () => {
    const bytes = utf8('내용');
    const { fetch, calls } = makeFetch((call) => {
      if (call.url.includes('/drive/v3/files/old-1?fields=headRevisionId')) return json({ headRevisionId: 'rev-9' });
      const found = foundFolders(call);
      if (found) return found;
      return json({});
    });
    const { client } = setup(fetch);

    await expect(
      client.upload({ path: 'notes/a.md', bytes, hash: sha(bytes), existing: { id: 'old-1', revision: 'rev-1' } }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    expect(calls.some((c) => c.url.includes('uploadType'))).toBe(false);
  });
});

describe('move', () => {
  it('부모가 다르면 새 폴더를 보장하고 addParents/removeParents 로 옮긴다', async () => {
    const { fetch, calls } = makeFetch((call) => {
      if (call.url.includes('/drive/v3/files/id-1?fields=parents')) return json({ parents: ['folder-old'] });
      const name = folderQueryName(call);
      if (name === 'new') return json({ files: [{ id: 'folder-new' }] });
      const found = foundFolders(call);
      if (found) return found;
      return json({
        id: 'id-1',
        parents: ['folder-new'],
        appProperties: { nopsVault: VAULT_KEY, relPath: 'new/dir.md', contentHash: 'hash-id-1' },
        headRevisionId: 'rev-move',
        size: '3',
      });
    });
    const { client } = setup(fetch);

    const file = await client.move('id-1', 'new/dir.md');

    const patch = required(calls.find((c) => c.method === 'PATCH' && c.url.includes('/drive/v3/files/id-1')), 'PATCH 가 없어요');
    const u = new URL(patch.url);
    expect(u.pathname).toBe('/drive/v3/files/id-1');
    expect(u.searchParams.get('addParents')).toBe('folder-new');
    expect(u.searchParams.get('removeParents')).toBe('folder-old');
    expect(u.searchParams.get('fields')).toBe('id,appProperties,headRevisionId,size');
    expect(JSON.parse(required(patch.body, '본문이 없어요') as string)).toEqual({
      name: 'dir.md',
      appProperties: { relPath: 'new/dir.md' },
    });
    expect(file).toEqual<RemoteFile>({
      id: 'id-1',
      path: 'new/dir.md',
      hash: 'hash-id-1',
      revision: 'rev-move',
      size: 3,
    });
  });

  it('부모가 같으면 addParents/removeParents 를 생략한다', async () => {
    const { fetch, calls } = makeFetch((call) => {
      if (call.url.includes('/drive/v3/files/id-2?fields=parents')) return json({ parents: ['folder-vault'] });
      const found = foundFolders(call);
      if (found) return found;
      return json({ id: 'id-2', appProperties: { relPath: 'renamed.md' }, headRevisionId: 'rev-2', size: '1' });
    });
    const { client } = setup(fetch);

    await client.move('id-2', 'renamed.md');

    const patch = required(calls.find((c) => c.method === 'PATCH'), 'PATCH 가 없어요');
    const u = new URL(patch.url);
    expect(u.searchParams.get('addParents')).toBeNull();
    expect(u.searchParams.get('removeParents')).toBeNull();
  });
});

describe('trash', () => {
  it('trashed:true 를 PATCH 한다', async () => {
    const { fetch, calls } = makeFetch(() => json({ id: 'id-1' }));
    const { client } = setup(fetch);

    await client.trash('id-1');

    const patch = required(calls[0], '요청이 없어요');
    expect(patch.method).toBe('PATCH');
    expect(patch.url).toBe('https://www.googleapis.com/drive/v3/files/id-1?fields=id');
    expect(JSON.parse(required(patch.body, '본문이 없어요') as string)).toEqual({ trashed: true });
  });
});

describe('오류 처리와 재시도', () => {
  it('401 은 재시도 없이 DriveAuthError', async () => {
    const { fetch, calls } = makeFetch(() => json({ error: { message: 'Invalid Credentials' } }, 401));
    const { client, sleeps } = setup(fetch);

    await expect(client.trash('id-1')).rejects.toBeInstanceOf(DriveAuthError);
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('429 는 Retry-After 초를 우선해 재시도한다', async () => {
    const { fetch, calls } = makeFetch((_call, index) =>
      index === 0 ? json({ error: {} }, 429, { 'retry-after': '3' }) : json({ id: 'id-1' }),
    );
    const { client, sleeps } = setup(fetch);

    await client.trash('id-1');

    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([3000]);
  });

  it('429(Retry-After 없음)는 1s, 2s, 4s … 로 재시도한다', async () => {
    const { fetch, calls } = makeFetch((_call, index) => (index < 3 ? json({ error: {} }, 429) : json({ id: 'id-1' })));
    const { client, sleeps } = setup(fetch);

    await client.trash('id-1');

    expect(calls).toHaveLength(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it('재시도를 소진하면 DriveApiError(status 429) 로 실패한다', async () => {
    const { fetch, calls } = makeFetch(() => json({ error: { message: 'rate' } }, 429));
    const { client, sleeps } = setup(fetch, { maxRetries: 3 });

    const error = await client.trash('id-1').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(DriveApiError);
    expect((error as DriveApiError).status).toBe(429);
    expect((error as DriveApiError).message).toContain('429');
    expect(calls).toHaveLength(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it('403 중 rateLimitExceeded 만 재시도한다', async () => {
    const { fetch } = makeFetch((_call, index) =>
      index === 0 ? json({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 403) : json({ id: 'id-1' }),
    );
    const { client, sleeps } = setup(fetch);

    await client.trash('id-1');

    expect(sleeps).toEqual([1000]);
  });

  it('403 이어도 다른 사유면 즉시 DriveApiError', async () => {
    const { fetch, calls } = makeFetch(() => json({ error: { errors: [{ reason: 'insufficientFilePermissions' }] } }, 403));
    const { client, sleeps } = setup(fetch);

    const error = await client.trash('id-1').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(DriveApiError);
    expect((error as DriveApiError).status).toBe(403);
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('5xx 는 재시도한다', async () => {
    const { fetch } = makeFetch((_call, index) => (index === 0 ? json({}, 503) : json({ id: 'id-1' })));
    const { client, sleeps } = setup(fetch);

    await client.trash('id-1');

    expect(sleeps).toEqual([1000]);
  });

  it('네트워크 예외도 같은 방식으로 재시도하고 소진하면 status 0 으로 실패한다', async () => {
    let attempts = 0;
    const first = setup(
      makeFetch(() => {
        attempts++;
        if (attempts <= 2) throw new TypeError('fetch failed');
        return json({ id: 'id-1' });
      }).fetch,
    );

    await first.client.trash('id-1');
    expect(attempts).toBe(3);
    expect(first.sleeps).toEqual([1000, 2000]);

    const always = setup(
      makeFetch(() => {
        throw new TypeError('fetch failed');
      }).fetch,
      { maxRetries: 1 },
    );
    const error = await always.client.trash('id-1').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(DriveApiError);
    expect((error as DriveApiError).status).toBe(0);
    expect(always.sleeps).toEqual([1000]);
  });

  it('일반 404 는 즉시 DriveApiError 로 실패하고 본문 요약을 담는다', async () => {
    const { fetch, calls } = makeFetch(() => json({ error: { message: 'File not found: id-1' } }, 404));
    const { client, sleeps } = setup(fetch);

    const error = await client.trash('id-1').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(DriveApiError);
    expect((error as DriveApiError).status).toBe(404);
    expect((error as DriveApiError).message).toContain('404');
    expect((error as DriveApiError).message).toContain('File not found');
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('resumable 응답에 Location 이 없으면 DriveApiError', async () => {
    const bytes = new Uint8Array(MULTIPART_LIMIT + 1);
    const { fetch } = makeFetch((call) => {
      const found = foundFolders(call);
      if (found) return found;
      return new Response(null, { status: 200 });
    });
    const { client } = setup(fetch);

    const error = await client.upload({ path: 'big.bin', bytes, hash: sha(bytes) }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(DriveApiError);
  });
});
