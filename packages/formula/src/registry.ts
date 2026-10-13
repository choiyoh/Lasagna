import type { Node } from './ast.js';
import type { FValue } from './value.js';

export interface FnCtx {
  /** 평가 시각(`now()`·`today()` 가 쓴다) */
  now: Date;
}

/** 인자를 먼저 모두 계산해서 받는 함수. 라이브러리(`fn-*.ts`)는 이 형태만 쓴다. */
export interface FunctionDef {
  min: number;
  /** 가변 인자는 `Infinity` */
  max: number;
  impl: (args: FValue[], ctx: FnCtx) => FValue;
}

/** 인자를 필요할 때만(또는 값마다 다시) 계산하는 함수: if, ifs, map, filter, let … 평가기가 직접 정의한다. */
export interface LazyFunctionDef {
  lazy: true;
  min: number;
  max: number;
  /** `callback` 인 인자 번호(0부터)는 `current`·`index` 를 볼 수 있다 */
  callbackArgs?: number[];
  impl: (args: Node[], ev: Evaluator, ctx: FnCtx) => FValue;
}

export interface Evaluator {
  /** 노드를 계산한다. `extra` 는 이 계산에만 보이는 이름(current, index, let 변수) */
  (node: Node, extra?: Record<string, FValue>): FValue;
}

export type AnyFunctionDef = FunctionDef | LazyFunctionDef;
export const isLazy = (d: AnyFunctionDef): d is LazyFunctionDef => (d as LazyFunctionDef).lazy === true;
