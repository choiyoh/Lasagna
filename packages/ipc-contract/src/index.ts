import { z } from 'zod';

/** 볼트 루트 기준 상대 경로. 절대 경로·`..` 탈출은 main의 경로 가드가 한 번 더 검사한다. */
export const relPath = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => !p.includes('\0'), 'NUL 문자는 허용되지 않음');

export const noteSummary = z.object({
  path: relPath,
  title: z.string(),
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
  'vault.listRecent': {
    input: z.undefined(),
    output: z.array(z.object({ id: z.string(), name: z.string(), path: z.string() })),
  },
  'vault.open': { input: z.object({ path: z.string() }), output: z.object({ id: z.string() }) },
  'vault.create': { input: z.object({ path: z.string() }), output: z.object({ id: z.string() }) },
  'note.list': { input: z.undefined(), output: z.array(noteSummary) },
  'note.read': { input: z.object({ path: relPath }), output: z.object({ content: z.string() }) },
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
  'note.changed': z.object({ path: relPath, kind: z.enum(['add', 'change', 'unlink']) }),
  'index.progress': z.object({ done: z.number(), total: z.number() }),
} as const;
export type EventName = keyof typeof events;
