/**
 * 작가 모드 쓰기 통계 파일(userData/writer-stats.json)의 순수 로직.
 *
 * - 앱 에디터에서 입력·삭제한 **문서별 순변화의 합**. 외부 편집·동기화는 렌더러가 보내지 않는다.
 * - 하루의 시작은 기기 로컬 자정. 날짜가 바뀌면 그날의 합계를 `history` 에 **닫아서 보존**하고 오늘은 비운다.
 * - 하루의 확정 값 = 그날 볼트 합계(0 미만 없음)와 작품별 합계(각각 0 미만 없음).
 * - 작품별 키는 작품 폴더 이름, 작품 밖 노트는 `:outside`(폴더 이름이 될 수 없는 키).
 * - 파일이 깨졌거나 형식이 다르면 빈 값으로 복구한다(앱이 통계 때문에 뜨지 않으면 안 된다).
 */

export interface WriterHistoryDay {
  /** 그날 볼트 합계(0 미만 없음) */
  total: number;
  /** 작품 이름 → 그날 작품 합계(0 미만 없음) */
  works: Record<string, number>;
}

export interface WriterDailyFile {
  version: 2;
  /** 오늘의 문서별 순변화(자정에 history 로 닫힌다) */
  today: { date: string; vaults: Record<string, Record<string, number>> };
  /** 볼트 id → 날짜 → 확정 하루 합계 */
  history: Record<string, Record<string, WriterHistoryDay>>;
}

/** 작품 폴더 밖에서 쓴 글자수의 키. `:` 는 Windows 폴더 이름에 쓸 수 없어 실제 작품 이름과 겹치지 않는다. */
export const OUTSIDE_WORK = ':outside';

/** 보존 상한(약 10년). 넘으면 오래된 날짜부터 버린다. */
const MAX_DAYS = 3650;

export type WorkResolver = (vaultId: string, notePath: string) => string;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const emptyFile = (date: string): WriterDailyFile => ({ version: 2, today: { date, vaults: {} }, history: {} });

/** 기기 로컬 날짜 키(UTC 아님 — 작가의 하루는 자정에 바뀐다). */
export function dayKey(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** `YYYY-MM-DD` 를 그날 0시(로컬)로. 형식·날짜가 틀리면 null. */
function parseDay(value: string): Date | null {
  if (!DAY.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y ?? 0, (m ?? 1) - 1, d ?? 0);
  return dayKey(date) === value ? date : null;
}

function isFiniteInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.trunc(value) === value;
}

/** 볼트 id → 노트 경로 → 순변화 (0 은 버린다). */
function cleanVaults(raw: unknown): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [vaultId, docs] of Object.entries(raw as Record<string, unknown>)) {
    if (!docs || typeof docs !== 'object' || Array.isArray(docs)) continue;
    const clean: Record<string, number> = {};
    for (const [path, delta] of Object.entries(docs as Record<string, unknown>)) {
      if (isFiniteInt(delta) && delta !== 0) clean[path] = delta;
    }
    if (Object.keys(clean).length > 0) out[vaultId] = clean;
  }
  return out;
}

function cleanDay(raw: unknown): WriterHistoryDay | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as { total?: unknown; works?: unknown };
  const total = isFiniteInt(value.total) ? Math.max(0, value.total) : 0;
  const works: Record<string, number> = {};
  if (value.works && typeof value.works === 'object' && !Array.isArray(value.works)) {
    for (const [work, chars] of Object.entries(value.works as Record<string, unknown>)) {
      if (!work || !isFiniteInt(chars)) continue;
      const n = Math.max(0, chars);
      if (n > 0) works[work] = n;
    }
  }
  if (total === 0 && Object.keys(works).length === 0) return null;
  return { total, works };
}

/**
 * 파일 내용을 읽는다. `valid` 가 false 면 깨졌거나 모르는 형식이라 호출자가 원문을 `.bak` 으로 남긴다.
 * v1 파일은 지난 날짜여도 **그 날짜의 문서별 값을 그대로** 읽는다(호출자가 `closeWriterDay` 로 닫는다).
 */
export function parseWriterDailyFile(raw: string | null, today: string): { file: WriterDailyFile; valid: boolean } {
  if (!raw) return { file: emptyFile(today), valid: true };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { file: emptyFile(today), valid: false };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { file: emptyFile(today), valid: false };
  const obj = data as { version?: unknown; date?: unknown; vaults?: unknown; today?: unknown; history?: unknown };

  // v1: 오늘 하루치만 있던 형식 — 날짜가 무엇이든 그 날의 값으로 이어받는다.
  if (obj.version === 1) {
    if (typeof obj.date !== 'string' || !DAY.test(obj.date)) return { file: emptyFile(today), valid: false };
    return { file: { version: 2, today: { date: obj.date, vaults: cleanVaults(obj.vaults) }, history: {} }, valid: true };
  }

  if (obj.version !== 2) return { file: emptyFile(today), valid: false };
  const live = obj.today as { date?: unknown; vaults?: unknown } | undefined;
  if (!live || typeof live !== 'object' || typeof live.date !== 'string' || !DAY.test(live.date)) {
    return { file: emptyFile(today), valid: false };
  }
  const history: Record<string, Record<string, WriterHistoryDay>> = {};
  if (obj.history && typeof obj.history === 'object' && !Array.isArray(obj.history)) {
    for (const [vaultId, days] of Object.entries(obj.history as Record<string, unknown>)) {
      if (!days || typeof days !== 'object' || Array.isArray(days)) continue;
      const clean: Record<string, WriterHistoryDay> = {};
      for (const [date, day] of Object.entries(days as Record<string, unknown>)) {
        if (!DAY.test(date)) continue;
        const value = cleanDay(day);
        if (value) clean[date] = value;
      }
      if (Object.keys(clean).length > 0) history[vaultId] = clean;
    }
  }
  return { file: { version: 2, today: { date: live.date, vaults: cleanVaults(live.vaults) }, history }, valid: true };
}

/** 파일 내용을 읽는다. 깨졌거나 모르는 형식이면 오늘 기준 빈 값. */
export function parseWriterDaily(raw: string | null, today: string): WriterDailyFile {
  return parseWriterDailyFile(raw, today).file;
}

/** 오늘 쓴 글자수(볼트별 문서 순변화 합, 0 미만 없음). */
export function todayChars(file: WriterDailyFile, vaultId: string): number {
  const docs = file.today.vaults[vaultId] ?? {};
  const sum = Object.values(docs).reduce((acc, n) => acc + n, 0);
  return Math.max(0, Math.trunc(sum));
}

/** 한 벌의 문서별 순변화를 볼트 합계·작품별 합계로 접는다(각각 0 미만 없음). */
function foldDay(docs: Record<string, number>, vaultId: string, resolve: WorkResolver | null): WriterHistoryDay {
  const works: Record<string, number> = {};
  let sum = 0;
  for (const [path, delta] of Object.entries(docs)) {
    sum += delta;
    const work = resolve ? resolve(vaultId, path) : OUTSIDE_WORK;
    works[work] = (works[work] ?? 0) + delta;
  }
  const cleanWorks: Record<string, number> = {};
  for (const [work, chars] of Object.entries(works)) {
    const n = Math.max(0, Math.trunc(chars));
    if (n > 0) cleanWorks[work] = n;
  }
  return { total: Math.max(0, Math.trunc(sum)), works: cleanWorks };
}

/**
 * 문서 순변화를 더한다. 날짜가 바뀌었으면 그 날짜 기준으로 오늘을 비운 뒤 더한다
 * (호출자는 먼저 `closeWriterDay` 로 지난 날을 보존한다).
 */
export function addDailyDelta(file: WriterDailyFile, today: string, vaultId: string, path: string, delta: number): WriterDailyFile {
  if (!Number.isFinite(delta) || Math.trunc(delta) === 0) {
    return file.today.date === today ? file : { ...file, today: { date: today, vaults: {} } };
  }
  const base = file.today.date === today ? file : { ...file, today: { date: today, vaults: {} } };
  const docs = { ...(base.today.vaults[vaultId] ?? {}) };
  const next = (docs[path] ?? 0) + Math.trunc(delta);
  if (next === 0) delete docs[path];
  else docs[path] = next;
  const vaults = { ...base.today.vaults };
  if (Object.keys(docs).length > 0) vaults[vaultId] = docs;
  else delete vaults[vaultId];
  return { ...base, today: { date: today, vaults } };
}

/** 오래된 날짜(약 10년 초과)를 버린다. */
function prune(history: Record<string, Record<string, WriterHistoryDay>>, today: string): Record<string, Record<string, WriterHistoryDay>> {
  const now = parseDay(today);
  if (!now) return history;
  const cutoffDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - MAX_DAYS);
  const cutoff = dayKey(cutoffDate);
  const out: Record<string, Record<string, WriterHistoryDay>> = {};
  for (const [vaultId, days] of Object.entries(history)) {
    const kept: Record<string, WriterHistoryDay> = {};
    for (const [date, day] of Object.entries(days)) if (date >= cutoff) kept[date] = day;
    if (Object.keys(kept).length > 0) out[vaultId] = kept;
  }
  return out;
}

/**
 * 날짜가 바뀌었으면(자정·시계 변경) 그 날짜의 합계를 history 로 닫고 오늘을 비운다.
 * 같은 날짜가 이미 기록돼 있으면 **줄이지 않는다**(항목별 max).
 */
export function closeWriterDay(file: WriterDailyFile, today: string, resolve: WorkResolver | null = null): WriterDailyFile {
  if (file.today.date === today) return file;
  const history: Record<string, Record<string, WriterHistoryDay>> = { ...file.history };
  for (const [vaultId, docs] of Object.entries(file.today.vaults)) {
    const day = foldDay(docs, vaultId, resolve);
    if (day.total === 0 && Object.keys(day.works).length === 0) continue;
    const days = { ...(history[vaultId] ?? {}) };
    const prev = days[file.today.date];
    days[file.today.date] = prev
      ? {
          total: Math.max(prev.total, day.total),
          works: { ...prev.works, ...Object.fromEntries(Object.entries(day.works).map(([w, n]) => [w, Math.max(n, prev.works[w] ?? 0)])) },
        }
      : day;
    history[vaultId] = days;
  }
  return { version: 2, today: { date: today, vaults: {} }, history: prune(history, today) };
}

/**
 * 기간(from~to, 포함)의 날짜별 합계. `today` 를 주면 그 날짜는 **아직 저장 전인 오늘 값**을 계산해 넣는다.
 * 기록이 없는 날짜는 키가 없다(화면은 '기록 없음').
 */
export function historyRange(
  file: WriterDailyFile,
  vaultId: string,
  from: string,
  to: string,
  today: string,
  resolve: WorkResolver | null = null,
): Record<string, WriterHistoryDay> {
  const out: Record<string, WriterHistoryDay> = {};
  for (const [date, day] of Object.entries(file.history[vaultId] ?? {})) {
    if (date >= from && date <= to) out[date] = day;
  }
  if (today >= from && today <= to && today === file.today.date) {
    const live = foldDay(file.today.vaults[vaultId] ?? {}, vaultId, resolve);
    if (live.total > 0 || Object.keys(live.works).length > 0) out[today] = live;
  }
  return out;
}

/**
 * 작품 폴더 이름이 바뀌었을 때 모든 날짜의 작품 키를 옮긴다.
 * 그 날짜에 새 이름 키가 이미 있으면 **그 날짜는 건드리지 않는다**(덮어쓰기 없음).
 * `dates` 를 주면 그 날짜들만 옮긴다(undo 정확 복원용). 옮긴 날짜 목록을 돌려준다.
 */
export function moveWorkHistory(
  file: WriterDailyFile,
  vaultId: string,
  from: string,
  to: string,
  dates: readonly string[] | null = null,
): { file: WriterDailyFile; moved: string[] } {
  const days = file.history[vaultId];
  if (!from || !to || from === to || !days) return { file, moved: [] };
  const only = dates ? new Set(dates) : null;
  const nextDays: Record<string, WriterHistoryDay> = { ...days };
  const moved: string[] = [];
  for (const [date, day] of Object.entries(days)) {
    if (only && !only.has(date)) continue;
    if (!(from in day.works) || to in day.works) continue;
    const works = { ...day.works, [to]: day.works[from]! };
    delete works[from];
    nextDays[date] = { ...day, works };
    moved.push(date);
  }
  if (moved.length === 0) return { file, moved };
  return { file: { ...file, history: { ...file.history, [vaultId]: nextDays } }, moved };
}
