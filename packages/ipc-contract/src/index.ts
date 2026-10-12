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


export const graphNode = z.object({
  id: z.string(),
  kind: z.enum(['note', 'tag', 'unresolved']),
  label: z.string(),
  folder: z.string(),
  tags: z.array(z.string()),
  degree: z.number(),
  depth: z.number().optional(),
});
export const graphData = z.object({
  nodes: z.array(graphNode),
  edges: z.array(z.object({ source: z.string(), target: z.string(), kind: z.enum(['link', 'tag']) })),
});
export type GraphData = z.infer<typeof graphData>;

export const graphOptions = z.object({
  includeTags: z.boolean().optional(),
  includeUnresolved: z.boolean().optional(),
  includeOrphans: z.boolean().optional(),
});

/** `.nopsidian/graph.json` — 그래프 뷰 설정(볼트와 함께 동기화되는 쪽) */
export const graphSettings = z.object({
  filter: z.string().max(500),
  groups: z.array(z.object({ query: z.string().max(500), color: z.string().max(32) })).max(20),
  includeTags: z.boolean(),
  includeUnresolved: z.boolean(),
  includeOrphans: z.boolean(),
  arrows: z.boolean(),
  /** 0~1 슬라이더 값 */
  forces: z.object({ gravity: z.number(), repulsion: z.number(), linkDistance: z.number() }),
});
export type GraphSettings = z.infer<typeof graphSettings>;


export const syncStatus = z.object({
  /** Google 클라이언트 ID 가 저장돼 있다 */
  configured: z.boolean(),
  /** 계정이 연결돼 있다(토큰 보유) */
  connected: z.boolean(),
  /** 이 볼트에서 동기화를 켰다 */
  enabled: z.boolean(),
  /** 첫 동기화 계획을 확인하고 한 번 실행했다 — 그 뒤부터 자동 동기화 */
  confirmedFirst: z.boolean(),
  state: z.enum(['off', 'idle', 'syncing', 'offline', 'error', 'needsAuth', 'blocked']),
  lastSync: z.number().nullable(),
  message: z.string().nullable(),
  /** 충돌 표식이 남았거나 충돌 사본이 생긴 노트 */
  conflicts: z.array(z.string()),
});
export type SyncStatus = z.infer<typeof syncStatus>;

export const syncPlanSummary = z.object({
  firstSync: z.boolean(),
  blocked: z.string().nullable(),
  tracked: z.number(),
  counts: z.record(z.string(), z.number()),
  ops: z.array(z.object({ type: z.string(), path: z.string(), to: z.string().optional() })),
  truncated: z.boolean(),
});
export const syncRunSummary = z.object({
  pushed: z.number(),
  pulled: z.number(),
  merged: z.number(),
  deleted: z.number(),
  conflicts: z.number(),
  failed: z.number(),
  conflictPaths: z.array(z.string()),
  errors: z.array(z.object({ path: z.string(), message: z.string() })),
});

// ── 데이터베이스(폴더 + _db.yaml) ──
export const dbRowSchema = z.object({
  path: relPath,
  title: z.string(),
  values: z.record(z.string(), z.unknown()),
  created: z.string().optional(),
  updated: z.string().optional(),
});
export type DbRowDto = z.infer<typeof dbRowSchema>;
const dbGroup: z.ZodType<DbGroupDto> = z.lazy(() =>
  z.object({
    key: z.string().nullable(),
    label: z.string(),
    count: z.number(),
    hidden: z.number(),
    rows: z.array(dbRowSchema),
    sub: z.array(dbGroup).optional(),
  }),
);
export interface DbGroupDto {
  key: string | null;
  label: string;
  count: number;
  hidden: number;
  rows: DbRowDto[];
  sub?: DbGroupDto[];
}
export const dbInfo = z.object({ folder: z.string(), title: z.string(), rowCount: z.number(), issues: z.number() });
export const dbQueryInput = z.object({
  folder: z.string().max(1024),
  viewId: z.string().max(200).optional(),
  /** 저장하지 않은 임시 뷰(필터·정렬 UI) — main/worker 가 view 스키마로 다시 검증한다 */
  view: z.unknown().optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
  groupLimit: z.number().int().min(1).max(1000).optional(),
});
export const dbQueryOutput = z.object({
  folder: z.string(),
  /** `@nopsidian/core/db` 의 DbSchema — 렌더러가 core 스키마 타입으로 읽는다 */
  schema: z.unknown(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })),
  view: z.unknown(),
  total: z.number(),
  matched: z.number(),
  rows: z.array(dbRowSchema),
  groups: z.array(dbGroup).nullable(),
  calc: z.record(z.string(), z.unknown()),
});
export type DbQueryResult = z.infer<typeof dbQueryOutput>;

/** `_db.yaml` 편집 작업 — 값 검증은 main 이 core 스키마로 다시 한다 */
export const dbSchemaOp = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('setProperty'), name: z.string().min(1).max(100), def: z.unknown() }),
  z.object({ kind: z.literal('removeProperty'), name: z.string().min(1).max(100) }),
  z.object({ kind: z.literal('renameProperty'), from: z.string().min(1).max(100), to: z.string().min(1).max(100) }),
  z.object({ kind: z.literal('upsertView'), view: z.unknown() }),
  z.object({ kind: z.literal('removeView'), id: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('moveView'), id: z.string().min(1).max(200), toIndex: z.number().int().min(0) }),
  z.object({
    kind: z.literal('meta'),
    title: z.string().max(200).optional(),
    rowsFolder: z.string().max(200).optional(),
    defaultTemplate: z.string().max(1024).nullable().optional(),
  }),
]);

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
  'link.blocks': {
    input: z.object({ path: relPath }),
    output: z.array(z.object({ id: z.string().nullable(), text: z.string(), line: z.number(), type: z.string() })),
  },
  /** 그 노트의 `line`번째 줄이 속한 블록에 `^id`를 붙이고(이미 있으면 그대로) ID를 돌려준다. 파일을 직접 고친다. */
  'link.ensureBlockId': {
    input: z.object({ path: relPath, line: z.number().int().min(1) }),
    output: z.object({ id: z.string(), changed: z.boolean() }),
  },
  /** 언링크드 멘션 하나를 위키링크로 바꾼다(`path` 노트의 `line` 줄 블록에서 `targetPath` 노트의 제목·별칭이 나온 첫 곳). */
  'link.convertMention': {
    input: z.object({ path: relPath, line: z.number().int().min(1), targetPath: relPath }),
    output: z.object({ changed: z.boolean(), replaced: z.string().optional() }),
  },
  'template.list': { input: z.undefined(), output: z.array(z.object({ path: relPath, title: z.string() })) },
  /** 템플릿 노트를 읽어 변수를 채운 본문(프런트매터 제외)을 돌려준다. */
  'template.read': {
    input: z.object({ path: relPath, title: z.string().max(300) }),
    output: z.object({ content: z.string() }),
  },
  'graph.global': { input: graphOptions, output: graphData },
  'graph.local': {
    input: graphOptions.extend({
      path: relPath,
      depth: z.number().int().min(1).max(5),
      direction: z.enum(['both', 'out', 'in']),
    }),
    output: graphData,
  },
  'graph.getSettings': { input: z.undefined(), output: graphSettings.nullable() },
  'graph.setSettings': { input: graphSettings, output: z.undefined() },
  'sync.status': { input: z.undefined(), output: syncStatus },
  /** Google 클라이언트 ID(사용자 본인 GCP 프로젝트)를 OS 키체인으로 암호화해 저장한다. */
  'sync.setClient': {
    input: z.object({ clientId: z.string().min(10).max(300), clientSecret: z.string().max(300).optional() }),
    output: syncStatus,
  },
  /** 시스템 브라우저로 Google 로그인(PKCE + loopback)을 열고, 끝나면 연결 상태를 돌려준다. */
  'sync.connect': { input: z.undefined(), output: syncStatus },
  'sync.disconnect': { input: z.undefined(), output: syncStatus },
  /** 이 볼트의 동기화를 켜고 끈다. */
  'sync.enable': { input: z.object({ enabled: z.boolean() }), output: syncStatus },
  /** 아무것도 바꾸지 않고 무엇을 할지 계산만 한다(첫 동기화 확인용). */
  'sync.plan': { input: z.undefined(), output: syncPlanSummary },
  'sync.run': { input: z.object({ force: z.boolean().default(false) }), output: syncRunSummary },
  'db.list': { input: z.undefined(), output: z.array(dbInfo) },
  'db.query': { input: dbQueryInput, output: dbQueryOutput },
  /** 행 노트의 속성 하나를 고친다(프런트매터의 그 키만 바뀐다). value null = 비움. */
  'db.updateCell': {
    input: z.object({ path: relPath, prop: z.string().min(1).max(100), value: z.unknown() }),
    output: z.undefined(),
  },
  /** 새 행(노트)을 만든다. 템플릿이 있으면 그 본문·기본 속성을 쓴다. */
  'db.addRow': {
    input: z.object({
      folder: z.string().max(1024),
      title: z.string().min(1).max(200),
      values: z.record(z.string(), z.unknown()).optional(),
      template: relPath.optional(),
    }),
    output: z.object({ path: relPath }),
  },
  /** `_db.yaml` 을 고친다. renameProperty 는 모든 행의 프런트매터 키도 함께 바꾼다. */
  'db.editSchema': { input: z.object({ folder: z.string().max(1024), op: dbSchemaOp }), output: z.object({ touchedRows: z.number() }) },
  /** 폴더를 데이터베이스로 만든다(`_db.yaml` 생성). 폴더가 없으면 만든다. */
  'db.create': { input: z.object({ folder: z.string().max(1024), title: z.string().min(1).max(200) }), output: z.object({ folder: z.string() }) },
  /** 현재 뷰를 CSV 로 저장(저장 대화상자). 취소하면 null. */
  'db.exportCsv': { input: z.object({ folder: z.string().max(1024), viewId: z.string().max(200).optional() }), output: z.object({ path: z.string(), rows: z.number() }).nullable() },
  /** CSV 파일을 골라 새 데이터베이스로 만든다(열 형식 자동 추정). 취소하면 null. */
  'db.importCsv': { input: z.undefined(), output: z.object({ folder: z.string(), rows: z.number(), issues: z.array(z.string()) }).nullable() },
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
  'sync.changed': syncStatus,
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
