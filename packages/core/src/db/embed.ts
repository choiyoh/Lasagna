import { t, type MessageKey } from '@nopsidian/i18n';
import { parse as parseYaml } from 'yaml';

/** ```` ```dbview ```` 펜스 안의 YAML: 어떤 데이터베이스의 어떤 보기를 보여 줄지 */
export interface DbEmbedConfig {
  /** 데이터베이스 제목 또는 폴더 경로 */
  db: string;
  /** 보기 이름 또는 id(없으면 첫 보기) */
  view?: string;
  /** 보여 줄 최대 행 수(기본 100) */
  limit?: number;
}

export type DbEmbedParse =
  | { ok: true; config: DbEmbedConfig }
  | { ok: false; error: string; /** 코드+params(추가 필드) — 표시 시점에 번역한다 */ key?: MessageKey; params?: Record<string, string | number> };

export function parseDbEmbed(text: string): DbEmbedParse {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: t('db.issue.yaml', { message }), key: 'db.issue.yaml', params: { message } };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    return { ok: false, error: t('core.err.dbviewShape'), key: 'core.err.dbviewShape', params: {} };
  const o = raw as Record<string, unknown>;
  const db = typeof o.db === 'string' ? o.db.trim() : '';
  if (!db) return { ok: false, error: t('core.err.dbviewName'), key: 'core.err.dbviewName', params: {} };
  const view = typeof o.view === 'string' && o.view.trim() ? o.view.trim() : undefined;
  const limit = typeof o.limit === 'number' && o.limit > 0 ? Math.min(2000, Math.floor(o.limit)) : undefined;
  return { ok: true, config: { db, ...(view ? { view } : {}), ...(limit ? { limit } : {}) } };
}

/** 펜스에 넣을 YAML 한 덩어리 */
export function dbEmbedSource(db: string, view?: string): string {
  const quote = (s: string) => (/^[\p{L}\p{N}_ ./-]+$/u.test(s) && !/^\s|\s$/.test(s) ? s : JSON.stringify(s));
  return `db: ${quote(db)}${view ? `\nview: ${quote(view)}` : ''}`;
}
