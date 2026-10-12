import { z } from 'zod';

/** 볼트 루트 기준 상대 경로. 절대 경로·`..` 탈출은 main의 경로 가드가 한 번 더 검사한다. */
export const relPath = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => !p.includes('\0'), 'NUL 문자는 허용되지 않음');

export const vaultInfo = z.object({ id: z.string(), name: z.string(), path: z.string() });
export type VaultInfo = z.infer<typeof vaultInfo>;

export const saveResult = z.object({
  status: z.enum(['saved', 'merged', 'conflict', 'copy']),
  /** 저장 후 디스크에 있는 내용 — 병합·충돌이면 에디터가 이 내용으로 다시 불러와야 한다 */
  content: z.string(),
  hash: z.string(),
  copyPath: relPath.optional(),
});
export type SaveResult = z.infer<typeof saveResult>;

export const assetInfo = z.object({ path: relPath, size: z.number() });
export type AssetInfo = z.infer<typeof assetInfo>;

/** 한 번에 저장할 수 있는 첨부 크기 상한(IPC로 통째로 보내므로 제한한다) */
export const MAX_ASSET_BYTES = 200 * 1024 * 1024;

export const movePlan = z.object({
  moves: z.array(z.object({ from: relPath, to: relPath })),
  /** 링크가 바뀌는 노트(이동 전 경로) */
  edits: z.array(z.object({ path: relPath, newPath: relPath, changes: z.number() })),
  totalChanges: z.number(),
});
export type MovePlanInfo = z.infer<typeof movePlan>;

export const backlinkContext = z.object({
  path: relPath,
  title: z.string(),
  kind: z.string(),
  line: z.number(),
  snippet: z.string(),
});
export const outgoingLink = z.object({
  target: z.string(),
  resolvedPath: relPath.nullable(),
  kind: z.string(),
  heading: z.string().nullable(),
  block: z.string().nullable(),
  line: z.number(),
});
export const unlinkedMention = z.object({ path: relPath, title: z.string(), line: z.number(), snippet: z.string() });
export type BacklinkContext = z.infer<typeof backlinkContext>;
export type OutgoingLink = z.infer<typeof outgoingLink>;
export type UnlinkedMention = z.infer<typeof unlinkedMention>;

export const noteSummary = z.object({
  path: relPath,
  title: z.string(),
  aliases: z.array(z.string()).default([]),
  mtime: z.number(),
  size: z.number(),
});
export type NoteSummary = z.infer<typeof noteSummary>;

export const searchHit = z.object({
  path: relPath,
  title: z.string(),
  snippet: z.string(),
});
export type SearchHit = z.infer<typeof searchHit>;

/**
 * 렌더러가 호출할 수 있는 모든 채널의 단일 정의.
 * 여기에 없는 채널은 main이 등록하지 않고, preload도 노출하지 않는다.
 */
export const contract = {
  'vault.listRecent': { input: z.undefined(), output: z.array(vaultInfo) },
  'vault.current': { input: z.undefined(), output: vaultInfo.nullable() },
  /** 폴더 선택 대화상자를 띄워 볼트로 연다. 취소하면 null. */
  'vault.pick': { input: z.undefined(), output: vaultInfo.nullable() },
  'vault.open': { input: z.object({ id: z.string() }), output: vaultInfo },
  'note.list': { input: z.undefined(), output: z.array(noteSummary) },
  'note.read': {
    input: z.object({ path: relPath }),
    output: z.object({ content: z.string(), hash: z.string() }),
  },
  /**
   * baseHash = 앱이 마지막으로 읽거나 저장한 디스크 내용의 해시(새 노트는 null).
   * 디스크가 그 사이 바뀌었으면 main이 3-way 병합하거나 충돌 사본을 만든다.
   */
  'note.save': {
    input: z.object({
      path: relPath,
      content: z.string().max(20_000_000),
      baseHash: z.string().nullable(),
    }),
    output: saveResult,
  },
  /** 이름 변경/이동 미리보기: 파일은 건드리지 않고 어떤 링크가 몇 개 바뀌는지만 계산한다. `from`은 노트·첨부 파일 또는 폴더. */
  'note.renamePlan': { input: z.object({ from: relPath, to: relPath }), output: movePlan },
  /** 이름 변경/이동을 실행하고 볼트 전체의 링크를 갱신한다. 되돌릴 수 있도록 기록을 남긴다. */
  'note.rename': {
    input: z.object({ from: relPath, to: relPath }),
    output: movePlan.extend({ undoId: z.string() }),
  },
  'note.undoRename': {
    input: z.object({ undoId: z.string().regex(/^[0-9a-z-]+$/) }),
    output: z.object({ restored: z.number(), skipped: z.array(relPath) }),
  },
  'link.backlinks': { input: z.object({ path: relPath }), output: z.array(backlinkContext) },
  'link.outgoing': { input: z.object({ path: relPath }), output: z.array(outgoingLink) },
  'link.unlinked': { input: z.object({ path: relPath }), output: z.array(unlinkedMention) },
  'link.headings': {
    input: z.object({ path: relPath }),
    output: z.array(z.object({ text: z.string(), level: z.number(), line: z.number() })),
  },
  'tag.list': { input: z.undefined(), output: z.array(z.object({ tag: z.string(), count: z.number() })) },
  'tag.notes': {
    input: z.object({ tag: z.string().max(200) }),
    output: z.array(z.object({ path: relPath, title: z.string() })),
  },
  /** 오늘 날짜의 데일리 노트를 열고(없으면 만들고) 그 경로를 돌려준다. */
  'daily.open': { input: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), output: z.object({ path: relPath, created: z.boolean() }) },
  'search.query': {
    input: z.object({ q: z.string().max(500), limit: z.number().int().min(1).max(200).default(50) }),
    output: z.array(searchHit),
  },
  'asset.list': { input: z.undefined(), output: z.array(assetInfo) },
  /** 첨부를 볼트의 첨부 폴더에 저장한다. 같은 이름·같은 내용이면 기존 파일을 재사용한다. */
  'asset.save': {
    input: z.object({
      name: z.string().max(255),
      data: z.instanceof(Uint8Array).refine((d) => d.byteLength <= MAX_ASSET_BYTES, '파일이 너무 큽니다'),
    }),
    output: z.object({ path: relPath, reused: z.boolean() }),
  },
  /** 안전한 문서 형식은 기본 앱으로 열고, 그 외(실행 파일 등)는 Finder에서 위치만 보여 준다. */
  'asset.open': { input: z.object({ path: relPath }), output: z.enum(['opened', 'revealed']) },
  'app.openExternal': { input: z.object({ url: z.string().url() }), output: z.undefined() },
} as const;

export type Contract = typeof contract;
export type Channel = keyof Contract;
export type ChannelInput<C extends Channel> = z.input<Contract[C]['input']>;
export type ChannelOutput<C extends Channel> = z.output<Contract[C]['output']>;

/** main → renderer 브로드캐스트 이벤트(수신 전용). */
export const events = {
  'note.changed': z.object({
    path: relPath,
    kind: z.enum(['add', 'change', 'unlink']),
    /** 앱이 방금 쓴 내용이면 false (에디터를 다시 불러올 필요 없음) */
    external: z.boolean().default(true),
  }),
  'asset.changed': z.object({ path: relPath, kind: z.enum(['add', 'change', 'unlink']) }),
  'index.progress': z.object({ done: z.number(), total: z.number() }),
} as const;
export type EventName = keyof typeof events;

type Namespace<C extends string> = C extends `${infer N}.${string}` ? N : never;
type Method<C extends string> = C extends `${string}.${infer M}` ? M : never;
type Fn<C extends Channel> = undefined extends ChannelInput<C>
  ? (input?: ChannelInput<C>) => Promise<ChannelOutput<C>>
  : (input: ChannelInput<C>) => Promise<ChannelOutput<C>>;

/** preload가 `window.nops`로 노출하는 API 형태. 채널 `a.b`는 `nops.a.b()`가 된다. */
export type NopsApi = {
  [N in Namespace<Channel>]: { [C in Channel as Method<C & `${N}.${string}`>]: Fn<C> };
} & {
  on<E extends EventName>(event: E, cb: (payload: z.output<(typeof events)[E]>) => void): () => void;
};
