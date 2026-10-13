import type { Node } from './ast.js';
import { FormulaError, compareValues, isDate, toDisplayString, typeOf, valuesEqual, type FValue } from './value.js';
import { DATE_FNS } from './fn-date.js';
import { LIST_FNS } from './fn-list.js';
import { MATH_FNS } from './fn-math.js';
import { TEXT_FNS } from './fn-text.js';
import { isLazy, type AnyFunctionDef, type Evaluator, type FnCtx, type LazyFunctionDef } from './registry.js';

export interface Env {
  /** `prop("이름")` 의 값. 없는 속성이면 FormulaError 를 던진다 */
  prop(name: string): FValue;
  now?: Date;
}

export const truthy = (v: FValue): boolean => !(v === null || v === false || v === 0 || v === '' || (Array.isArray(v) && v.length === 0));

const err = (n: Node, msg: string) => new FormulaError(msg, n.pos, n.end);

function num(v: FValue, n: Node, what: string): number {
  if (v === null) return 0; // 빈 값은 산술에서 0
  if (typeof v === 'number') return v;
  throw err(n, `${what}: 숫자가 필요한데 ${typeName(v)} 이에요`);
}
const typeName = (v: FValue) => ({ null: '빈 값', number: '숫자', string: '문자열', boolean: '불리언', date: '날짜', list: '목록' })[typeOf(v)];

/** 콜백을 쓰는 목록 함수와 제어 함수 */
const LAZY: Record<string, LazyFunctionDef> = {
  if: { lazy: true, min: 3, max: 3, impl: (a, ev) => (truthy(ev(a[0]!)) ? ev(a[1]!) : ev(a[2]!)) },
  ifs: {
    lazy: true,
    min: 3,
    max: Infinity,
    impl: (a, ev) => {
      // ifs(조건1, 값1, 조건2, 값2, …, 기본값)
      let i = 0;
      for (; i + 1 < a.length; i += 2) if (truthy(ev(a[i]!))) return ev(a[i + 1]!);
      return i < a.length ? ev(a[i]!) : null;
    },
  },
  let: {
    lazy: true,
    min: 3,
    max: 3,
    impl: (a, ev) => {
      const name = a[0]!;
      if (name.kind !== 'ident') throw err(name, 'let 의 첫 인자는 이름이어야 해요');
      return ev(a[2]!, { [name.name]: ev(a[1]!) });
    },
  },
  lets: {
    lazy: true,
    min: 3,
    max: Infinity,
    impl: (a, ev) => {
      // lets(이름1, 값1, 이름2, 값2, …, 본문)
      const scope: Record<string, FValue> = {};
      let i = 0;
      for (; i + 1 < a.length; i += 2) {
        const name = a[i]!;
        if (name.kind !== 'ident') throw err(name, 'lets 의 이름 자리에는 이름이 와야 해요');
        scope[name.name] = ev(a[i + 1]!, scope);
      }
      if (i >= a.length) throw err(a[a.length - 1]!, 'lets 의 마지막 인자는 본문이어야 해요');
      return ev(a[i]!, scope);
    },
  },
};

function listArg(v: FValue, n: Node, fn: string): FValue[] {
  if (v === null) return [];
  if (!Array.isArray(v)) throw err(n, `${fn}: 목록이 필요한데 ${typeName(v)} 이에요`);
  return v;
}

function callbackFn(name: string, kind: 'map' | 'filter' | 'find' | 'findIndex' | 'some' | 'every'): LazyFunctionDef {
  return {
    lazy: true,
    min: 2,
    max: 2,
    callbackArgs: [1],
    impl: (a, ev) => {
      const list = listArg(ev(a[0]!), a[0]!, name);
      const each = (cur: FValue, index: number) => ev(a[1]!, { current: cur, index });
      switch (kind) {
        case 'map':
          return list.map(each);
        case 'filter':
          return list.filter((c, i) => truthy(each(c, i)));
        case 'find':
          return list.find((c, i) => truthy(each(c, i))) ?? null;
        case 'findIndex':
          return list.findIndex((c, i) => truthy(each(c, i)));
        case 'some':
          return list.some((c, i) => truthy(each(c, i)));
        case 'every':
          return list.every((c, i) => truthy(each(c, i)));
      }
    },
  };
}
for (const k of ['map', 'filter', 'find', 'findIndex', 'some', 'every'] as const) LAZY[k] = callbackFn(k, k);

/** `prop` 는 평가기가 직접 처리한다(인자는 문자열 리터럴). */
export const REGISTRY: Record<string, AnyFunctionDef> = { ...TEXT_FNS, ...MATH_FNS, ...LIST_FNS, ...DATE_FNS, ...LAZY };

function binary(op: Node & { kind: 'binary' }, l: FValue, r: FValue): FValue {
  switch (op.op) {
    case '+':
      if (typeof l === 'string' || typeof r === 'string') return toDisplayString(l) + toDisplayString(r);
      if (Array.isArray(l) && Array.isArray(r)) return [...l, ...r];
      return num(l, op.left, '+') + num(r, op.right, '+');
    case '-':
      return num(l, op.left, '-') - num(r, op.right, '-');
    case '*':
      return num(l, op.left, '*') * num(r, op.right, '*');
    case '/': {
      const d = num(r, op.right, '/');
      if (d === 0) throw err(op, '0으로 나눌 수 없어요');
      return num(l, op.left, '/') / d;
    }
    case '%': {
      const d = num(r, op.right, '%');
      if (d === 0) throw err(op, '0으로 나눌 수 없어요');
      return num(l, op.left, '%') % d;
    }
    case '^': {
      const v = num(l, op.left, '^') ** num(r, op.right, '^');
      if (!Number.isFinite(v)) throw err(op, '계산 결과가 숫자가 아니에요');
      return v;
    }
    case '==':
      return valuesEqual(l, r);
    case '!=':
      return !valuesEqual(l, r);
    case '<':
    case '<=':
    case '>':
    case '>=': {
      if (l === null || r === null) return false;
      const ok = (typeof l === typeof r && typeof l !== 'object') || (isDate(l) && isDate(r));
      if (!ok) throw err(op, `${typeName(l)} 와 ${typeName(r)} 는 비교할 수 없어요`);
      const c = compareValues(l, r);
      return op.op === '<' ? c < 0 : op.op === '<=' ? c <= 0 : op.op === '>' ? c > 0 : c >= 0;
    }
    case '&&':
    case '||':
      throw err(op, '내부 오류'); // 아래에서 단락 평가로 처리한다
  }
}

/** 컴파일된 구문 트리를 계산한다. 오류는 `FormulaError`(위치 포함)로 던진다. */
export function evaluate(root: Node, env: Env): FValue {
  const ctx: FnCtx = { now: env.now ?? new Date() };
  const run = (node: Node, scope: Record<string, FValue>): FValue => {
    const ev: Evaluator = (n, extra) => run(n, extra ? { ...scope, ...extra } : scope);
    switch (node.kind) {
      case 'num':
      case 'str':
      case 'bool':
        return node.value;
      case 'list':
        return node.items.map((i) => run(i, scope));
      case 'ident':
        if (node.name in scope) return scope[node.name]!;
        throw err(node, `알 수 없는 이름: ${node.name}`);
      case 'unary': {
        const v = run(node.arg, scope);
        return node.op === '!' ? !truthy(v) : -num(v, node.arg, '-');
      }
      case 'binary':
        if (node.op === '&&') return truthy(run(node.left, scope)) && truthy(run(node.right, scope));
        if (node.op === '||') return truthy(run(node.left, scope)) || truthy(run(node.right, scope));
        return binary(node, run(node.left, scope), run(node.right, scope));
      case 'cond':
        return truthy(run(node.test, scope)) ? run(node.then, scope) : run(node.otherwise, scope);
      case 'call':
      case 'method': {
        const argNodes = node.kind === 'method' ? [node.target, ...node.args] : node.args;
        if (node.name === 'prop' && node.kind === 'call') {
          const a = argNodes[0];
          if (!a || a.kind !== 'str') throw err(node, 'prop() 에는 속성 이름을 문자열로 직접 써야 해요');
          try {
            return env.prop(a.value);
          } catch (e) {
            if (e instanceof FormulaError) throw new FormulaError(e.message, a.pos, a.end);
            throw e;
          }
        }
        const def = REGISTRY[node.name];
        if (!def) throw err(node, `알 수 없는 함수: ${node.name}`);
        if (argNodes.length < def.min || argNodes.length > def.max) throw err(node, `${node.name}() 의 인자 개수가 맞지 않아요`);
        if (isLazy(def)) return def.impl(argNodes, ev, ctx);
        const args = argNodes.map((a) => run(a, scope));
        try {
          return def.impl(args, ctx);
        } catch (e) {
          if (e instanceof FormulaError && e.pos === undefined) throw new FormulaError(e.message, node.pos, node.end);
          throw e;
        }
      }
    }
  };
  return run(root, {});
}
