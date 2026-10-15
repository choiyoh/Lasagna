import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** 에이전트가 한 쓰기(와 거부된 시도)를 남기는 감사 기록. 볼트의 `.nopsidian/mcp-audit.jsonl` 에 한 줄씩 쌓인다. */
export interface AuditEntry {
  /** ISO 시각 */
  t: string;
  /** 연결한 MCP 클라이언트 이름(알 수 있으면) */
  client?: string;
  action: 'create' | 'append' | 'update' | 'denied';
  /** 도구 이름 */
  tool: string;
  path: string;
  hashBefore?: string | null;
  hashAfter?: string;
  bytes?: number;
  /** 거부 사유·병합 결과 등 */
  note?: string;
}

export const AUDIT_FILE = '.nopsidian/mcp-audit.jsonl';

export function appendAudit(root: string, entry: AuditEntry): void {
  const file = path.join(root, AUDIT_FILE);
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

/** 가장 최근 `limit` 개(최신순). 파일이 없거나 깨진 줄은 건너뛴다. */
export function readAudit(root: string, limit = 50): AuditEntry[] {
  const file = path.join(root, AUDIT_FILE);
  if (!existsSync(file)) return [];
  const out: AuditEntry[] = [];
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    const line = lines[i]!.trim();
    if (!line) continue;
    try {
      const e = JSON.parse(line) as AuditEntry;
      if (typeof e.t === 'string' && typeof e.path === 'string') out.push(e);
    } catch {
      /* 깨진 줄은 무시 */
    }
  }
  return out;
}
