import type { Node } from './ast.js';
import { REGISTRY, evaluate, type Env } from './eval.js';
import { parseFormula } from './parse.js';
import { isLazy } from './registry.js';
import { t } from '@nopsidian/i18n';
import { FormulaError, formulaError, type FValue } from './value.js';
import type { MessageKey, TranslateParams } from '@nopsidian/i18n';

export interface Compiled {
  source: string;
  ast: Node;
  /** `prop("…")` 로 읽는 속성 이름(중복 없이, 등장 순서) */
  deps: string[];
}

export interface FormulaIssue {
  message: string;
  pos: number;
  end: number;
  /** 사전 키면 표시 시점에 지금 언어로 다시 만든다(캐시에 문구가 박히지 않게) */
  key?: MessageKey;
  params?: TranslateParams;
}
export type CompileResult = { ok: true; compiled: Compiled } | { ok: false; error: FormulaIssue };

const CALLBACK_VARS = ['current', 'index'];

const issueOf = (e: FormulaError): FormulaIssue => ({
  message: e.message,
  pos: e.pos ?? 0,
  end: e.end ?? e.pos ?? 0,
  ...(e.key ? { key: e.key, params: e.params } : {}),
});

/** 파싱 + 정적 검사(없는 함수·인자 개수·prop() 인자·이름 범위). 실행하지 않는다. */
export function compileFormula(source: string): CompileResult {
  try {
    const ast = parseFormula(source);
    const deps: string[] = [];
    const walk = (n: Node, names: ReadonlySet<string>): void => {
      switch (n.kind) {
        case 'num':
        case 'str':
        case 'bool':
        case 'null':
          return;
        case 'list':
          return n.items.forEach((i) => walk(i, names));
        case 'ident':
          if (!names.has(n.name)) throw CALLBACK_VARS.includes(n.name)
              ? formulaError('formula.err.unknownNameCallback', { name: n.name }, n.pos, n.end)
              : formulaError('formula.err.unknownName', { name: n.name }, n.pos, n.end);
          return;
        case 'unary':
          return walk(n.arg, names);
        case 'binary':
          walk(n.left, names);
          return walk(n.right, names);
        case 'cond':
          walk(n.test, names);
          walk(n.then, names);
          return walk(n.otherwise, names);
        case 'call':
        case 'method': {
          const args = n.kind === 'method' ? [n.target, ...n.args] : n.args;
          if (n.kind === 'call' && n.name === 'prop') {
            const a = args[0];
            if (args.length !== 1 || !a || a.kind !== 'str') throw formulaError('formula.err.propSingleArg', {}, n.pos, n.end);
            if (!deps.includes(a.value)) deps.push(a.value);
            return;
          }
          const def = REGISTRY[n.name];
          if (!def) throw formulaError('formula.err.unknownFunction', { name: n.name }, n.pos, n.end);
          if (args.length < def.min || args.length > def.max) {
            const range = def.min === def.max ? t('formula.arity.exact', { n: def.min }) : def.max === Infinity ? t('formula.arity.atLeast', { min: def.min }) : t('formula.arity.between', { min: def.min, max: def.max });
            throw formulaError('formula.err.arity', { name: n.name, range, count: args.length }, n.pos, n.end);
          }
          if (!isLazy(def)) return args.forEach((a) => walk(a, names));
          if (n.name === 'let' || n.name === 'lets') return walkLet(args, names, n.name === 'lets', walk);
          args.forEach((a, i) => walk(a, def.callbackArgs?.includes(i) ? new Set([...names, ...CALLBACK_VARS]) : names));
          return;
        }
      }
    };
    walk(ast, new Set());
    return { ok: true, compiled: { source, ast, deps } };
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, error: issueOf(e) };
    throw e;
  }
}

function walkLet(args: Node[], names: ReadonlySet<string>, many: boolean, walk: (n: Node, names: ReadonlySet<string>) => void) {
  let scope = new Set(names);
  if (!many) {
    const [name, value, body] = args as [Node, Node, Node];
    if (name.kind !== 'ident') throw formulaError('formula.err.letFirstArg', {}, name.pos, name.end);
    walk(value, names);
    return walk(body, new Set([...names, name.name]));
  }
  let i = 0;
  for (; i + 1 < args.length; i += 2) {
    const name = args[i]!;
    if (name.kind !== 'ident') throw formulaError('formula.err.letsName', {}, name.pos, name.end);
    walk(args[i + 1]!, scope);
    scope = new Set([...scope, name.name]);
  }
  if (i >= args.length) throw formulaError('formula.err.letsBody', {}, args[args.length - 1]!.pos, args[args.length - 1]!.end);
  walk(args[i]!, scope);
}

/** 컴파일된 수식을 계산한다. 계산 오류는 `FormulaError` 로 던진다. */
export function evalFormula(c: Compiled, env: Env): FValue {
  return evaluate(c.ast, env);
}

/** 컴파일 + 계산을 한 번에(오류는 값으로 돌려준다). 편집기 미리보기용. */
export function tryFormula(source: string, env: Env): { ok: true; value: FValue } | { ok: false; error: FormulaIssue } {
  const r = compileFormula(source);
  if (!r.ok) return r;
  try {
    return { ok: true, value: evalFormula(r.compiled, env) };
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, error: issueOf(e) };
    throw e;
  }
}
