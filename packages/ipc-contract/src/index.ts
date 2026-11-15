import { t } from '@nopsidian/i18n';
import { z } from 'zod';

/** 볼트 루트 기준 상대 경로. 절대 경로·`..` 탈출은 main의 경로 가드가 한 번 더 검사한다. */
export const relPath = z
  .string()
  .min(1)
  .max(1024)
  // 문구는 검증(파싱) 시점에 지금 언어로 만든다(모듈 로드 시 t() 금지).
  .refine((p) => !p.includes('\0'), { error: () => t('ipc.err.nul') });

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

/** 탭·분할 배치. 칸은 1~2개 */
export const workspaceLayout = z.object({
  panes: z.array(z.object({ tabs: z.array(relPath).max(200), active: relPath.nullable() })).min(1).max(2),
  activePane: z.number().int().min(0).max(1),
  dir: z.enum(['row', 'col']),
});
export type WorkspaceLayout = z.infer<typeof workspaceLayout>;

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

/** `.nopsidian/graph-layout.json` — 마지막 그래프 배치. localStorage 가 재시작을 못 견뎌도 볼트 파일로 남긴다. */
export const graphLayout = z.object({
  v: z.literal(2),
  done: z.boolean(),
  pos: z.record(z.string().max(1024), z.tuple([z.number().finite(), z.number().finite()])),
});
export type GraphLayout = z.infer<typeof graphLayout>;


export const syncStatus = z.object({
  /** 사용할 Google 클라이언트가 있다(직접 입력 또는 앱 내장) */
  configured: z.boolean(),
  /** 현재 우선 적용되는 클라이언트 출처 */
  clientSource: z.enum(['builtin', 'custom', 'none']),
  /** 이 빌드에 사용자 전용 클라이언트가 내장돼 있다 */
  builtinClientAvailable: z.boolean(),
  /** 계정이 연결돼 있다(토큰 보유) */
  connected: z.boolean(),
  /** 이 볼트에서 동기화를 켰다 */
  enabled: z.boolean(),
  /** 첫 동기화 계획을 확인하고 한 번 실행했다 — 그 뒤부터 자동 동기화 */
  confirmedFirst: z.boolean(),
  state: z.enum(['off', 'idle', 'syncing', 'offline', 'error', 'needsAuth', 'blocked']),
  /** 마지막으로 성공한 동기화 시각(epoch ms) */
  lastSync: z.number().nullable(),
  /** 마지막으로 동기화를 실행하거나 계획을 세운 시각(epoch ms) */
  lastAttempt: z.number().nullable(),
  message: z.string().nullable(),
  /** 충돌 표식이 남았거나 충돌 사본이 생긴 노트 */
  conflicts: z.array(z.string()),
});
export type SyncStatus = z.infer<typeof syncStatus>;

/** 사용자에게 보여 줄 동기화 실패 한 건. 원문 오류·경로·토큰은 담지 않는다. */
export const syncFailure = z.object({
  at: z.number(),
  /** 접힌 상세에 보여 줄 기술 코드(HTTP 401, FOLDER_MISSING 등) */
  code: z.string(),
  title: z.string(),
  action: z.string(),
  /** 단계별 안내 문서의 앵커 주소 — 앱 언어에 따라 docs/sync-setup.md 또는 docs/sync-setup.en.md 로 간다(L5). */
  docs: z.string(),
  /** 실패 종류 키 — 있으면 화면·저장본이 지금 언어로 제목·행동을 다시 만든다 */
  kind: z.string().optional(),
});
export type SyncFailure = z.infer<typeof syncFailure>;

/** Drive 쪽 이 볼트 폴더의 읽기 전용 상태. */
export const syncFolder = z.object({
  name: z.string(),
  path: z.string(),
  id: z.string().nullable(),
  exists: z.boolean(),
  checkedAt: z.number().nullable(),
});
export type SyncFolder = z.infer<typeof syncFolder>;

/** '지금 확인'·대화상자 진단에 쓰는 값. 비밀·전체 이메일·노트 경로는 절대 담지 않는다. */
export const syncDiagnostics = z.object({
  clientIdSuffix: z.string().nullable(),
  hasClientSecret: z.boolean(),
  /** 마스킹된 계정 이메일(예: ab***@gmail.com) */
  accountEmail: z.string().nullable(),
  tokenExpiresAt: z.number().nullable(),
  /** 만료 시각이 지나지 않았고 토큰이 있다 */
  tokenValid: z.boolean(),
  lastRefreshFailure: syncFailure.nullable(),
  /** null = 아직 로컬 스캔 전 */
  pendingChanges: z.number().nullable(),
  folder: syncFolder,
  lastFailure: syncFailure.nullable(),
});
export type SyncDiagnostics = z.infer<typeof syncDiagnostics>;

export const syncPlanSummary = z.object({
  firstSync: z.boolean(),
  blocked: z.string().nullable(),
  // 추가 필드: 사유 코드·값(있으면 화면이 그때그때 번역해 그린다). 구버전은 blocked 만 쓴다.
  blockedCode: z.literal('deleteRatio').optional(),
  blockedParams: z.object({ tracked: z.number(), deletes: z.number(), percent: z.number() }).optional(),
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
  // key/params 는 추가 필드 — 있으면 화면이 표시 시점에 번역한다(구버전은 message 만 읽는다).
  errors: z.array(
    z.object({
      path: z.string(),
      message: z.string(),
      key: z.string().optional(),
      params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    }),
  ),
});

// ── 데이터베이스(폴더 + _db.yaml) ──
export const dbRowSchema = z.object({
  path: relPath,
  title: z.string(),
  values: z.record(z.string(), z.unknown()),
  created: z.string().optional(),
  updated: z.string().optional(),
  cover: z.string().optional(),
});
export type DbRowDto = z.infer<typeof dbRowSchema>;
const dbGroup: z.ZodType<DbGroupDto> = z.lazy(() =>
  z.object({
    key: z.string().nullable(),
    label: z.string(),
    labelKey: z.enum(['empty', 'checked', 'unchecked']).optional(),
    count: z.number(),
    hidden: z.number(),
    rows: z.array(dbRowSchema),
    sub: z.array(dbGroup).optional(),
  }),
);
export interface DbGroupDto {
  key: string | null;
  label: string;
  /** 화면 문구 라벨이면 그 종류 — 렌더러가 지금 언어로 번역한다 */
  labelKey?: 'empty' | 'checked' | 'unchecked';
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
  /** 글자수 자동 열 기준(작가 모드 설정) */
  spacing: z.enum(['include', 'exclude']).optional(),
});
export const dbQueryOutput = z.object({
  folder: z.string(),
  /** `@nopsidian/core/db` 의 DbSchema — 렌더러가 core 스키마 타입으로 읽는다 */
  schema: z.unknown(),
  issues: z.array(
    z.object({
      path: z.string(),
      message: z.string(),
      key: z.string().optional(),
      params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    }),
  ),
  view: z.unknown(),
  total: z.number(),
  matched: z.number(),
  rows: z.array(dbRowSchema),
  groups: z.array(dbGroup).nullable(),
  calc: z.record(z.string(), z.unknown()),
  /** 롤업·수식 계산 오류: 행 경로 → 속성 → 메시지 */
  errors: z.record(z.string(), z.record(z.string(), z.string())),
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
    templates: z.array(relPath).max(50).optional(),
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

export const commentItem = z.object({
  id: z.string(),
  author: z.string(),
  text: z.string(),
  quote: z.string().optional(),
  createdAt: z.string(),
  resolved: z.boolean().optional(),
});
export type CommentItem = z.infer<typeof commentItem>;

export const noteSummary = z.object({
  path: relPath,
  title: z.string(),
  aliases: z.array(z.string()).default([]),
  /** 문서 아이콘(이모지). 프런트매터 `icon` */
  icon: z.string().nullable().default(null),
  /** 노트 커버: 프런트매터 `cover`(볼트 안 이미지 경로/파일명 또는 `gradient:<id>`). 없으면 null */
  cover: z.string().nullable().default(null),
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

/** `.nopsidian/mcp-policy.json` — 앱이 정본으로 쓰는 MCP 쓰기 정책 */
export const mcpPolicyFile = z
  .object({
    version: z.literal(1),
    write: z.boolean(),
    writeFolders: z.array(z.string().max(1024)).max(50),
    maxWritesPerMinute: z.number().int().min(1).max(1000),
  })
  .strict();
export type McpPolicyFile = z.infer<typeof mcpPolicyFile>;

/**
 * 앱 언어 설정과 그 결과 로캘. 원본은 main 의 userData/app-settings.json 이고, 렌더러는 IPC 로만 바꾼다.
 * `setting` 은 무엇을 따를지(system|ko|en), `locale` 은 실제 표시 언어(ko|en)다.
 */
export const languageSetting = z.enum(['system', 'ko', 'en']);
export const localeCode = z.enum(['ko', 'en']);
export const workGoal = z.object({
  episodes: z.number().int().min(0).max(10_000),
  perEpisode: z.number().int().min(0).max(1_000_000),
  basis: z.enum(['include', 'exclude']),
  deadline: z.string().nullable(),
  preset: z.enum(['naver', 'kakao', 'ridi', 'custom']),
  genre: z.string().nullable().optional(),
});
export type WorkGoalDto = z.infer<typeof workGoal>;

export const appLanguage = z.object({
  setting: languageSetting,
  locale: localeCode,
  // 작가 모드 — 예전 렌더러/설정 파일과 호환되도록 선택 필드로만 더한다.
  writerMode: z.boolean().optional(),
  writerSpacing: z.enum(['include', 'exclude']).optional(),
  writerDailyGoal: z.number().int().min(0).nullable().optional(),
  writerFont: z.enum(['sans', 'serif', 'mono']).optional(),
  writerTypewriter: z.boolean().optional(),
  /** 원고지 매수 표시(작가 모드, 기본 꺼짐) */
  writerPaperCount: z.boolean().optional(),
});
export type LanguageSetting = z.infer<typeof languageSetting>;
export type AppLanguage = z.infer<typeof appLanguage>;

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
  /** 작가용 사이드바: 볼트 루트의 작품(회차+캐릭터 폴더를 가진 폴더)과 회차 수·글자수 합(메인 캐시). */
  'note.workList': {
    input: z.undefined(),
    output: z.array(
      z.object({
        name: relPath,
        episodes: z.number().int().min(0),
        characters: z.number().int().min(0),
        storyBible: z.number().int().min(0).nullable(),
        episodeFolder: relPath,
        characterFolder: relPath,
        storyBibleFolder: relPath.nullable(),
        chars: z.number().int().min(0),
        charsNoSpace: z.number().int().min(0),
        episodeRows: z.array(
          z.object({
            path: relPath,
            chars: z.number().int().min(0),
            charsNoSpace: z.number().int().min(0),
          }),
        ),
      }),
    ),
  },
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
  /** 볼트 안의 모든 폴더(숨김·`.nopsidian` 제외). 빈 폴더도 사이드바에 보이게 하려고 쓴다 */
  'folder.list': { input: z.undefined(), output: z.array(relPath) },
  /** 새 폴더를 만든다(이미 있으면 번호를 붙인다). 돌려주는 값은 만든 경로 */
  'folder.create': { input: z.object({ path: relPath }), output: z.object({ path: relPath }) },
  /** 휴지통 목록(최근 순) */
  'trash.list': { input: z.undefined(), output: z.array(z.object({ trashId: z.string(), path: z.string(), isFolder: z.boolean(), at: z.string() })) },
  /** 휴지통에서 영구 삭제(trashId 없으면 전부 비우기) */
  'trash.purge': { input: z.object({ trashId: z.string().max(300).optional() }), output: z.object({ removed: z.number() }) },
  /** 노트(또는 폴더)를 볼트의 `.nopsidian/trash/` 로 옮긴다(동기화 중이면 Drive 휴지통으로도 간다). */
  /** 같은 폴더에 `이름 (사본).md` 로 복제 */
  'note.duplicate': { input: z.object({ path: relPath }), output: z.object({ path: relPath }) },
  'note.trash': { input: z.object({ path: relPath }), output: z.object({ trashId: z.string(), isFolder: z.boolean() }) },
  /** 휴지통에서 되돌린다. 돌려주는 값은 되돌려진 경로 */
  'note.restore': { input: z.object({ trashId: z.string().max(300) }), output: z.object({ path: relPath }) },
  'note.rename': {
    input: z.object({ from: relPath, to: relPath }),
    output: movePlan.extend({ undoId: z.string() }),
  },
  'note.undoRename': {
    input: z.object({ undoId: z.string().regex(/^[0-9a-z-]+$/) }),
    output: z.object({
      restored: z.number(),
      skipped: z.array(relPath),
      /** 이력·스냅샷을 되돌려 옮기는 데 쓰는 이동 목록(이름 바꾸기 기록) */
      moves: z.array(z.object({ from: relPath, to: relPath })).optional(),
    }),
  },
  /** 노트의 버전 기록(저장 때마다 이전 내용을 남긴 스냅샷), 최신 순 */
  'history.list': { input: z.object({ path: relPath }), output: z.array(z.object({ id: z.string(), time: z.string(), size: z.number() })) },
  'history.read': { input: z.object({ path: relPath, id: z.string().max(100) }), output: z.object({ content: z.string() }) },
  /** 작가 모드 '이름 붙인 스냅샷' — 자동 이력과 별도 저장소(.nopsidian/snapshots). */
  'history.snapshotList': {
    input: z.object({ path: relPath }),
    output: z.array(z.object({ id: z.string(), name: z.string(), time: z.string(), size: z.number() })),
  },
  'history.snapshotSave': {
    input: z.object({ path: relPath, name: z.string().max(200), content: z.string().max(20_000_000) }),
    output: z.object({ id: z.string(), name: z.string(), time: z.string(), size: z.number() }),
  },
  'history.snapshotRead': {
    input: z.object({ path: relPath, id: z.string().max(100) }),
    output: z.object({ name: z.string(), time: z.string(), content: z.string() }),
  },
  'history.snapshotRename': {
    input: z.object({ path: relPath, id: z.string().max(100), name: z.string().max(200) }),
    output: z.object({ id: z.string(), name: z.string(), time: z.string(), size: z.number() }),
  },
  'history.snapshotDelete': { input: z.object({ path: relPath, id: z.string().max(100) }), output: z.object({ ok: z.boolean() }) },
  /** 노트를 HTML 또는 PDF 파일로 내보낸다(저장 대화상자). 취소하면 saved 가 null */
  'export.note': { input: z.object({ path: relPath, format: z.enum(['html', 'pdf']) }), output: z.object({ saved: z.string().nullable() }) },
  /** 작품 회차 여러 개를 .docx / .txt 한 파일로 합쳐 저장한다(작가 모드, 노트는 읽기만). */
  'export.merge': {
    input: z.object({
      work: z.string().min(1).max(300),
      format: z.enum(['docx', 'txt']),
      /** 저장 대화상자의 기본 파일 이름(확장자 포함) */
      defaultName: z.string().min(1).max(300),
      /** 맨 앞 글자수 요약(없으면 null) */
      summary: z.string().max(1000).nullable(),
      includeTitles: z.boolean(),
      separator: z.enum(['page', 'blank', 'rule']),
      /** 정렬된 회차(경로·표시 제목) — 본문은 main 이 디스크에서 읽는다 */
      episodes: z.array(z.object({ path: relPath, title: z.string().max(500) })).min(1).max(2000),
    }),
    output: z.object({ saved: z.string().nullable() }),
  },
  /** 볼트 전체를 정적 HTML 사이트로 폴더에 내보낸다(폴더 선택 대화상자) */
  'export.vault': { input: z.undefined(), output: z.object({ dir: z.string().nullable(), notes: z.number(), assets: z.number() }) },
  /** Notion 내보내기 ZIP(Markdown & CSV)을 골라 볼트의 새 폴더로 가져온다. 취소하면 folder 가 null */
  'import.notion': {
    input: z.undefined(),
    output: z.object({
      folder: z.string().nullable(),
      notes: z.number(),
      databases: z.number(),
      rows: z.number(),
      assets: z.number(),
      unresolvedLinks: z.number(),
      issues: z.array(z.string()),
    }),
  },
  /**
   * 컴퓨터의 Markdown 파일(`files`)·폴더(`folder`)를 골라 `into`(없으면 볼트 루트)로 복사한다.
   * `paths` 는 끌어 놓은 파일·폴더 경로(대화상자 없이 가져온다). 취소하면 imported 가 빈 배열
   */
  'import.markdown': {
    input: z.object({ mode: z.enum(['files', 'folder', 'paths']), paths: z.array(z.string().min(1).max(4096)).max(10_000).optional(), into: z.string().max(1024).optional() }),
    output: z.object({ notes: z.number(), assets: z.number(), renamed: z.number(), imported: z.array(z.string()), skipped: z.array(z.string()) }),
  },
  /** 이 기기의 탭·분할 배치(`.nopsidian/workspace.json`, 동기화하지 않음) */
  'workspace.get': { input: z.undefined(), output: workspaceLayout.nullable() },
  'workspace.set': { input: workspaceLayout, output: z.undefined() },
  /** 같은 볼트를 새 창에서 연다(`path` 가 있으면 그 노트를 연다) */
  'window.new': { input: z.object({ path: relPath.optional() }), output: z.undefined() },
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
  /** `.nopsidian/bookmarks.json` — 북마크한 노트 경로(볼트와 함께 동기화) */
  'bookmarks.get': { input: z.undefined(), output: z.array(relPath) },
  'bookmarks.set': { input: z.array(relPath).max(500), output: z.undefined() },
  /** `.nopsidian/order.json` — 사이드바에서 손으로 정한 순서. 폴더 경로('' = 볼트 맨 위) → 그 폴더 안 항목 이름 순서(볼트와 함께 동기화) */
  'order.get': { input: z.undefined(), output: z.record(z.string().max(1024), z.array(z.string().max(255)).max(5000)) },
  'order.set': { input: z.record(z.string().max(1024), z.array(z.string().max(255)).max(5000)), output: z.undefined() },
  'graph.getSettings': { input: z.undefined(), output: graphSettings.nullable() },
  'graph.setSettings': { input: graphSettings, output: z.undefined() },
  'graph.getLayout': { input: z.undefined(), output: graphLayout.nullable() },
  'graph.setLayout': { input: graphLayout, output: z.undefined() },
  'sync.status': { input: z.undefined(), output: syncStatus },
  /** Google 클라이언트 ID(사용자 본인 GCP 프로젝트)를 OS 키체인으로 암호화해 저장한다. */
  'sync.setClient': {
    input: z.object({ clientId: z.string().min(10).max(300), clientSecret: z.string().max(300).optional() }),
    output: syncStatus,
  },
  /** 시스템 브라우저로 Google 로그인(PKCE + loopback)을 열고, 끝나면 연결 상태를 돌려준다. */
  'sync.connect': { input: z.undefined(), output: syncStatus },
  'sync.disconnect': { input: z.undefined(), output: syncStatus },
  /** 직접 입력한 클라이언트를 지우고 앱 내장 클라이언트로 되돌린다. */
  'sync.useBuiltin': { input: z.undefined(), output: syncStatus },
  /** 이 볼트의 동기화를 켜고 끈다. */
  'sync.enable': { input: z.object({ enabled: z.boolean() }), output: syncStatus },
  /** 아무것도 바꾸지 않고 무엇을 할지 계산만 한다(첫 동기화 확인용). */
  'sync.plan': { input: z.undefined(), output: syncPlanSummary },
  'sync.run': { input: z.object({ force: z.boolean().default(false) }), output: syncRunSummary },
  /** 저장된 진단 값 + 로컬 대기 변경 수(네트워크 요청 없음) */
  'sync.diagnostics': { input: z.undefined(), output: syncDiagnostics },
  /** 토큰 갱신·Drive 폴더 접근을 읽기 전용으로 확인한다. 동기화·업로드·삭제는 하지 않는다. */
  'sync.check': { input: z.undefined(), output: syncDiagnostics },
  'db.list': { input: z.undefined(), output: z.array(dbInfo) },
  'db.query': { input: dbQueryInput, output: dbQueryOutput },
  /** 노트가 데이터베이스의 행이면 그 데이터베이스(스키마)와 계산이 끝난 행 값. 아니면 null */
  'db.row': {
    input: z.object({ path: relPath }),
    output: z.object({ folder: z.string(), schema: z.unknown(), row: dbRowSchema, errors: z.record(z.string(), z.string()) }).nullable(),
  },
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
      /** 빈 문자열 = 템플릿 없이(기본 템플릿도 쓰지 않음) */
      template: z.union([relPath, z.literal('')]).optional(),
    }),
    output: z.object({ path: relPath }),
  },
  /** `_db.yaml` 을 고친다. renameProperty 는 모든 행의 프런트매터 키도 함께 바꾼다. */
  'db.editSchema': { input: z.object({ folder: z.string().max(1024), op: dbSchemaOp }), output: z.object({ touchedRows: z.number() }) },
  /** 폴더를 데이터베이스로 만든다(`_db.yaml` 생성). 폴더가 없으면 만든다. */
  'db.create': { input: z.object({ folder: z.string().max(1024), title: z.string().min(1).max(200) }), output: z.object({ folder: z.string() }) },
  /** 현재 뷰를 CSV 로 저장(저장 대화상자). 취소하면 null. */
  'db.exportCsv': { input: z.object({ folder: z.string().max(1024), viewId: z.string().max(200).optional() }), output: z.object({ path: z.string(), rows: z.number() }).nullable() },
  /** CSV 파일을 고르고(대화상자) 열 이름·추정 형식·미리보기를 돌려준다. 취소하면 null. */
  'db.importCsvPreview': {
    input: z.undefined(),
    output: z
      .object({
        token: z.string(),
        fileName: z.string(),
        rowCount: z.number(),
        columns: z.array(z.object({ index: z.number(), header: z.string(), name: z.string(), type: z.string(), options: z.array(z.string()), sample: z.array(z.string()) })),
      })
      .nullable(),
  },
  /** 사용자가 고른 열 대응으로 새 데이터베이스를 만들거나 기존 데이터베이스에 행을 더한다. */
  'db.importCsvApply': {
    input: z.object({
      token: z.string().max(100),
      target: z.discriminatedUnion('mode', [z.object({ mode: z.literal('new'), name: z.string().max(200) }), z.object({ mode: z.literal('existing'), folder: z.string().max(1024) })]),
      columns: z.array(z.object({ index: z.number().int().min(0), name: z.string().min(1).max(100), type: z.string().max(40) })).max(200),
    }),
    output: z.object({ folder: z.string(), rows: z.number(), issues: z.array(z.string()) }),
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
      data: z.instanceof(Uint8Array).refine((d) => d.byteLength <= MAX_ASSET_BYTES, { error: () => t('ipc.err.tooLarge') }),
    }),
    output: z.object({ path: relPath, reused: z.boolean() }),
  },
  /** 안전한 문서 형식은 기본 앱으로 열고, 그 외(실행 파일 등)는 Finder에서 위치만 보여 준다. */
  'asset.open': { input: z.object({ path: relPath }), output: z.enum(['opened', 'revealed']) },
  /** AI 에이전트 연결(MCP): 번들된 서버 스크립트 경로(없으면 null), 열린 볼트 경로·이름·id, 데일리 노트 폴더, 앱 실행 파일 경로, 패키징 여부, 실행 파일을 MCP 모드로 띄우는 인자 */
  'mcp.info': {
    input: z.undefined(),
    output: z.object({
      script: z.string().nullable(),
      vault: z.string(),
      vaultName: z.string(),
      vaultId: z.string(),
      dailyFolder: z.string(),
      executable: z.string(),
      packaged: z.boolean(),
      launchArgs: z.array(z.string()),
    }),
  },
  /** 앱이 정본으로 쓰는 MCP 쓰기 정책 파일. 없으면 exists=false, 깨졌으면 policy=null + error */
  'mcp.policyGet': {
    input: z.undefined(),
    output: z.object({
      exists: z.boolean(),
      policy: mcpPolicyFile.nullable(),
      error: z.string().nullable(),
      /** 화면이 지금 언어로 다시 만들 오류 종류(있으면 error 대신 이걸로 표시) */
      errorCode: z.enum(['unreadable', 'invalidJson', 'invalidSchema', 'noFolders', 'badFolder']).nullable().optional(),
      errorParams: z.record(z.string(), z.string()).optional(),
    }),
  },
  /** 앱 설정 변경을 정책 파일에 원자적으로 저장한다. 폴더는 서버와 같은 규칙으로 검증된다. */
  'mcp.policySet': {
    input: z.object({
      write: z.boolean(),
      writeFolders: z.array(z.string().max(1024)).max(50),
      maxWritesPerMinute: z.number().int().min(1).max(1000),
    }),
    output: mcpPolicyFile,
  },
  /** 에이전트가 한 쓰기·거부된 시도의 감사 기록(최신순) */
  'mcp.audit': {
    input: z.object({ limit: z.number().int().min(1).max(200) }),
    output: z.array(
      z.object({
        t: z.string(),
        client: z.string().optional(),
        action: z.enum(['create', 'append', 'update', 'denied', 'revert', 'comment']),
        tool: z.string(),
        path: z.string(),
        hashBefore: z.string().nullable().optional(),
        hashAfter: z.string().optional(),
        bytes: z.number().optional(),
        note: z.string().optional(),
      }),
    ),
  },
  /** 에이전트가 한 작업 되돌리기: 덧붙이기·고치기는 이전 내용으로 복원, 새로 만든 노트는 휴지통으로. 그 뒤 바뀌었으면 거부 */
  'mcp.revert': {
    input: z.object({ t: z.string().max(40), path: relPath }),
    output: z.object({
      kind: z.enum(['restored', 'trashed', 'failed']),
      trashId: z.string().optional(),
      /** 되돌릴 수 없는 이유(화면이 지금 언어로 만든다) */
      code: z.enum(['not-found', 'not-revertable', 'already', 'missing', 'changed', 'no-snapshot']).optional(),
      message: z.string().optional(),
    }),
  },
  /** 노트 댓글(`.nopsidian/comments/`, 동기화 대상) */
  'comment.list': { input: z.object({ path: relPath }), output: z.array(commentItem) },
  'comment.add': { input: z.object({ path: relPath, text: z.string().min(1).max(5000), quote: z.string().max(300).optional() }), output: commentItem },
  'comment.resolve': { input: z.object({ path: relPath, id: z.string().max(40), resolved: z.boolean() }), output: z.object({ ok: z.boolean() }) },
  'comment.remove': { input: z.object({ path: relPath, id: z.string().max(40) }), output: z.object({ ok: z.boolean() }) },
  'app.openExternal': { input: z.object({ url: z.string().url() }), output: z.undefined() },
  /** 지금 언어 설정과 실제 로캘. */
  'settings.language': { input: z.undefined(), output: appLanguage },
  /** 언어 설정을 저장하고 모든 창에 알린다. */
  'settings.setLanguage': {
    // language 를 주지 않고 작가 모드 설정만 바꿀 수도 있다(기존 호출은 language 만 넘긴다).
    input: z.object({
      language: languageSetting.optional(),
      writerMode: z.boolean().optional(),
      writerSpacing: z.enum(['include', 'exclude']).optional(),
      writerDailyGoal: z.number().int().min(0).max(10_000_000).nullable().optional(),
      writerFont: z.enum(['sans', 'serif', 'mono']).optional(),
      writerTypewriter: z.boolean().optional(),
      writerPaperCount: z.boolean().optional(),
    }),
    output: appLanguage,
  },
  /** 작품 목표(작가 모드) — userData/writer-works.json. 볼트·노트에는 기록하지 않는다. */
  'settings.workGoals': { input: z.object({ vaultId: z.string().max(200) }), output: z.record(z.string().max(300), workGoal) },
  'settings.setWorkGoal': {
    input: z.object({ vaultId: z.string().max(200), work: z.string().max(300), goal: workGoal.nullable() }),
    output: z.record(z.string().max(300), workGoal),
  },
  /** 작가 모드 '오늘 쓴 글자수' — 오늘 날짜(로컬)와 볼트 합계. 통계는 userData/writer-stats.json 에만 있다. */
  'settings.writerToday': {
    input: z.object({ vaultId: z.string().max(200) }),
    output: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), chars: z.number().int().min(0) }),
  },
  /** 에디터에서 입력·삭제한 문서 순변화를 오늘 합계에 더한다(외부 편집은 보내지 않는다). */
  'settings.writerAddDelta': {
    input: z.object({ vaultId: z.string().max(200), path: relPath, delta: z.number().int().min(-10_000_000).max(10_000_000) }),
    output: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), chars: z.number().int().min(0) }),
  },
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
  /** 언어 설정이 바뀌었다(다른 창에서 바꿔도 따라간다). */
  'language.changed': appLanguage,
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
  /** 끌어 놓은 파일·폴더의 실제 경로(preload 가 webUtils 로 구한다) */
  pathForFile(file: File): string;
  on<E extends EventName>(event: E, cb: (payload: z.output<(typeof events)[E]>) => void): () => void;
};
