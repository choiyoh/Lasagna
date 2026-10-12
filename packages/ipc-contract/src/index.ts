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
  'search.query': {
    input: z.object({ q: z.string().max(500), limit: z.number().int().min(1).max(200).default(50) }),
    output: z.array(searchHit),
  },
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
