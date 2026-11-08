/**
 * 작가 모드 '오늘 쓴 글자수' 통계 파일(userData/writer-stats.json)의 순수 로직.
 *
 * - 앱 에디터에서 입력·삭제한 **문서별 순변화의 합**. 외부 편집·동기화는 렌더러가 보내지 않는다.
 * - 하루의 시작은 기기 로컬 자정. 다른 날짜의 기록은 버리고(초기화) 오늘 것만 남긴다.
 * - 합계는 0 미만으로 내려가지 않는다(문서별 음수는 그대로 두어 다시 늘리면 상쇄된다).
 * - 파일이 깨졌거나 형식이 다르면 빈 값으로 복구한다(앱이 통계 때문에 뜨지 않으면 안 된다).
 */

export interface WriterDailyFile {
  version: 1;
  /** 'YYYY-MM-DD' (기기 로컬) */
  date: string;
  /** 볼트 id → 노트 경로 → 오늘의 순변화 */
  vaults: Record<string, Record<string, number>>;
}

const EMPTY = (date: string): WriterDailyFile => ({ version: 1, date, vaults: {} });
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** 기기 로컬 날짜 키(UTC 아님 — 작가의 하루는 자정에 바뀐다). */
export function dayKey(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isFiniteInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.trunc(value) === value;
}

/** 파일 내용을 읽는다. 깨졌거나 모르는 형식이면 오늘 기준 빈 값. */
export function parseWriterDaily(raw: string | null, today: string): WriterDailyFile {
  if (!raw) return EMPTY(today);
  try {
    const data = JSON.parse(raw) as { version?: unknown; date?: unknown; vaults?: unknown } | null;
    if (!data || data.version !== 1 || typeof data.date !== 'string' || !DAY.test(data.date)) return EMPTY(today);
    // 다른 날짜의 파일은 자정이 지난 것 — 초기화한다.
    if (data.date !== today) return EMPTY(today);
    const vaults: Record<string, Record<string, number>> = {};
    if (data.vaults && typeof data.vaults === 'object' && !Array.isArray(data.vaults)) {
      for (const [vaultId, docs] of Object.entries(data.vaults as Record<string, unknown>)) {
        if (!docs || typeof docs !== 'object' || Array.isArray(docs)) continue;
        const clean: Record<string, number> = {};
        for (const [path, delta] of Object.entries(docs as Record<string, unknown>)) {
          if (isFiniteInt(delta) && delta !== 0) clean[path] = delta;
        }
        if (Object.keys(clean).length > 0) vaults[vaultId] = clean;
      }
    }
    return { version: 1, date: today, vaults };
  } catch {
    return EMPTY(today);
  }
}

/** 오늘 쓴 글자수(볼트별 문서 순변화 합, 0 미만 없음). */
export function todayChars(file: WriterDailyFile, vaultId: string): number {
  const docs = file.vaults[vaultId] ?? {};
  const sum = Object.values(docs).reduce((acc, n) => acc + n, 0);
  return Math.max(0, Math.trunc(sum));
}

/**
 * 문서 순변화를 더한다. 날짜가 바뀌었으면(자정·시계 변경) 그 날짜 기준으로 초기화한 뒤 더한다.
 * 변화 0 은 아무 것도 하지 않는다(파일을 다시 쓰지 않게).
 */
export function addDailyDelta(file: WriterDailyFile, today: string, vaultId: string, path: string, delta: number): WriterDailyFile {
  if (!Number.isFinite(delta) || Math.trunc(delta) === 0) return file.date === today ? file : EMPTY(today);
  const base = file.date === today ? file : EMPTY(today);
  const docs = { ...(base.vaults[vaultId] ?? {}) };
  const next = (docs[path] ?? 0) + Math.trunc(delta);
  if (next === 0) delete docs[path];
  else docs[path] = next;
  return { version: 1, date: today, vaults: { ...base.vaults, ...(Object.keys(docs).length ? { [vaultId]: docs } : {}) } };
}
