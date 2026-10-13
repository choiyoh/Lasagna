/** 수식 구문 트리. 모든 노드는 원문 위치(`pos` 시작, `end` 배타)를 가진다. */
interface Loc {
  pos: number;
  end: number;
}

export type Node =
  | (Loc & { kind: 'num'; value: number })
  | (Loc & { kind: 'str'; value: string })
  | (Loc & { kind: 'bool'; value: boolean })
  | (Loc & { kind: 'null' })
  | (Loc & { kind: 'list'; items: Node[] })
  /** `current` `index` 같은 이름(콜백 안의 변수, let 변수) */
  | (Loc & { kind: 'ident'; name: string })
  /** `f(a, b)` */
  | (Loc & { kind: 'call'; name: string; args: Node[] })
  /** `target.f(a, b)` — 평가는 `f(target, a, b)` 와 같다 */
  | (Loc & { kind: 'method'; target: Node; name: string; args: Node[] })
  | (Loc & { kind: 'unary'; op: '-' | '!'; arg: Node })
  | (Loc & { kind: 'binary'; op: BinaryOp; left: Node; right: Node })
  | (Loc & { kind: 'cond'; test: Node; then: Node; otherwise: Node });

export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '^' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||';
