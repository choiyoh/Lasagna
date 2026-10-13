import { compileFormula, evalFormula, FormulaError, type Compiled, type FDate, type FValue } from '@nopsidian/formula';
import { isRollupFn, rollupValues, type CellValue, type DateValue, type DbRow, type DbSchema, type Property } from '@nopsidian/core/db';

/** 한 번의 질의 동안 쓰는 계산 문맥. 데이터베이스마다 한 번만 계산하고 결과를 나눠 쓴다. */
export interface ComputeHost {
  /** 폴더의 행(저장된 속성만 채워진 상태)과 스키마. 없으면 null */
  baseDb(folder: string): { schema: DbSchema; rows: DbRow[] } | null;
  /** 노트가 속한 데이터베이스 폴더 */
  dbFolderOf(path: string): string | null;
  /** 관계 값(`[[이름]]`)을 노트 경로로 */
  resolve(raw: string, fromPath: string): string | undefined;
  now: Date;
}

export interface ComputedDb {
  schema: DbSchema;
  rows: DbRow[];
  byPath: Map<string, DbRow>;
  /** 행 경로 → 속성 이름 → 오류 메시지 */
  errors: Record<string, Record<string, string>>;
}

const CIRCULAR = '순환 참조: 서로를 계산에 쓰고 있어요';

/** `[[이름|별칭#제목]]` → 이름 */
export const relationName = (raw: string): string => {
  const m = /^\[\[(.+)\]\]$/.exec(raw.trim());
  const s = m ? m[1]! : raw;
  return s.split('|')[0]!.split('#')[0]!.trim();
};

const parseIsoLocal = (s: string): { ms: number; hasTime: boolean } | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return null;
  const d = new Date(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  return Number.isNaN(d.getTime()) ? null : { ms: d.getTime(), hasTime: m[4] !== undefined };
};

/** 셀 값 → 수식 값 */
export function cellToFormula(prop: Property | undefined, v: CellValue): FValue {
  if (v === null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    if (prop?.type === 'date' || prop?.type === 'created_time' || prop?.type === 'updated_time') {
      const p = parseIsoLocal(String(v));
      return p ? ({ kind: 'date', ms: p.ms, hasTime: p.hasTime } satisfies FDate) : null;
    }
    return v;
  }
  if (Array.isArray(v)) return prop?.type === 'relation' ? v.map(relationName) : v;
  const a = parseIsoLocal(v.start);
  if (!a) return null;
  const b = v.end ? parseIsoLocal(v.end) : null;
  return { kind: 'date', ms: a.ms, hasTime: a.hasTime, ...(b ? { endMs: b.ms } : {}) };
}

const iso = (ms: number, hasTime: boolean) => {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const day = `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return hasTime ? `${day}T${p(d.getHours())}:${p(d.getMinutes())}` : day;
};

/** 수식 결과 → 셀 값 */
export function formulaToCell(v: FValue): CellValue {
  if (v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    const out = v.map((x) => (x === null ? '' : typeof x === 'object' && !Array.isArray(x) ? iso(x.ms, x.hasTime) : String(x))).filter((s) => s !== '');
    return out.length ? out : null;
  }
  const start = iso(v.ms, v.hasTime);
  return v.endMs !== undefined ? ({ start, end: iso(v.endMs, v.hasTime) } satisfies DateValue) : { start };
}

export class ComputeContext {
  private done = new Map<string, ComputedDb>();
  private compiled = new Map<string, Compiled | { error: string }>();

  constructor(private readonly host: ComputeHost) {}

  /** 데이터베이스의 모든 행에 롤업·수식 값을 채워 돌려준다(질의 한 번 안에서는 한 번만 계산). */
  db(folder: string): ComputedDb | null {
    const hit = this.done.get(folder);
    if (hit) return hit;
    const base = this.host.baseDb(folder);
    if (!base) return null;
    const out: ComputedDb = { schema: base.schema, rows: base.rows, byPath: new Map(base.rows.map((r) => [r.path, r])), errors: {} };
    this.done.set(folder, out); // 순환 참조가 다시 들어와도 지금까지 계산된 상태를 본다
    const computed = Object.entries(base.schema.properties).filter(([, p]) => p.type === 'rollup' || p.type === 'formula');
    if (computed.length === 0) return out;
    for (const name of this.order(folder, base.schema, computed.map(([n]) => n), out)) this.computeProp(out, name);
    return out;
  }

  private formula(expr: string): Compiled | { error: string } {
    let c = this.compiled.get(expr);
    if (!c) {
      const r = compileFormula(expr);
      c = r.ok ? r.compiled : { error: r.error.message };
      this.compiled.set(expr, c);
    }
    return c;
  }

  /** 속성끼리의 의존 순서(위상 정렬). 순환에 걸린 속성은 모든 행에 오류를 남기고 건너뛴다. */
  private order(folder: string, schema: DbSchema, names: string[], out: ComputedDb): string[] {
    const set = new Set(names);
    const deps = new Map<string, string[]>();
    for (const n of names) {
      const p = schema.properties[n]!;
      let d: string[] = [];
      if (p.type === 'formula') {
        const f = this.formula(p.expr);
        d = 'deps' in f ? f.deps : [];
      } else if (p.type === 'rollup') {
        const rel = schema.properties[p.relation];
        // 같은 데이터베이스를 가리키는 관계의 롤업은 그 속성(이 계산된 값이면)에 의존한다
        if (rel?.type === 'relation' && (rel.target === '*' || rel.target === folder || rel.target === (schema.title ?? ''))) d = [p.property];
      }
      deps.set(n, d.filter((x) => set.has(x)));
    }
    const order: string[] = [];
    const state = new Map<string, 1 | 2>();
    const visit = (n: string): boolean => {
      if (state.get(n) === 2) return true;
      if (state.get(n) === 1) return false;
      state.set(n, 1);
      let ok = true;
      for (const d of deps.get(n)!) if (!visit(d)) ok = false;
      state.set(n, 2);
      if (ok) order.push(n);
      else this.fail(out, n, CIRCULAR);
      return ok;
    };
    for (const n of names) if (!visit(n)) this.fail(out, n, CIRCULAR);
    return order.filter((n, i) => order.indexOf(n) === i);
  }

  private fail(out: ComputedDb, prop: string, message: string, rowPath?: string) {
    const rows = rowPath ? [rowPath] : out.rows.map((r) => r.path);
    for (const p of rows) (out.errors[p] ??= {})[prop] = message;
  }

  private computeProp(out: ComputedDb, name: string) {
    const prop = out.schema.properties[name]!;
    for (const row of out.rows) {
      try {
        row.values[name] = prop.type === 'formula' ? this.runFormula(prop.expr, out, row) : prop.type === 'rollup' ? this.runRollup(prop, out, row) : null;
      } catch (e) {
        row.values[name] = null;
        this.fail(out, name, e instanceof FormulaError ? e.message : e instanceof Error ? e.message : String(e), row.path);
      }
    }
  }

  private runFormula(expr: string, out: ComputedDb, row: DbRow): CellValue {
    const f = this.formula(expr);
    if ('error' in f) throw new FormulaError(f.error);
    return formulaToCell(
      evalFormula(f, {
        now: this.host.now,
        prop: (n) => {
          if (n === 'title') return row.title;
          const p = out.schema.properties[n];
          if (!p) throw new FormulaError(`없는 속성: ${n}`);
          return cellToFormula(p, row.values[n] ?? null);
        },
      }),
    );
  }

  private runRollup(p: Extract<Property, { type: 'rollup' }>, out: ComputedDb, row: DbRow): CellValue {
    const rel = out.schema.properties[p.relation];
    if (!rel || rel.type !== 'relation') throw new FormulaError(`관계 속성이 아니에요: ${p.relation}`);
    if (!isRollupFn(p.fn)) throw new FormulaError(`지원하지 않는 집계: ${p.fn}`);
    const raws = (row.values[p.relation] as string[] | null) ?? [];
    const values: CellValue[] = [];
    for (const raw of raws) {
      const target = this.host.resolve(raw, row.path);
      if (!target) continue; // 없는 노트는 세지 않는다
      const folder = this.host.dbFolderOf(target);
      const tdb = folder === null ? null : this.db(folder);
      const trow = tdb?.byPath.get(target);
      values.push(!trow ? null : p.property === 'title' ? trow.title : (trow.values[p.property] ?? null));
    }
    return rollupValues(p.fn, values);
  }
}
