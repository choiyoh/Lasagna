import type { BinaryOp, Node } from './ast.js';
import { FormulaError } from './value.js';

type Tok =
  | { t: 'num'; v: number; pos: number; end: number }
  | { t: 'str'; v: string; pos: number; end: number }
  | { t: 'id'; v: string; pos: number; end: number }
  | { t: 'op'; v: string; pos: number; end: number }
  | { t: 'eof'; pos: number; end: number };

const ID_START = /[\p{L}_$]/u;
const ID_PART = /[\p{L}\p{N}_$]/u;
const OPS2 = ['==', '!=', '<=', '>=', '&&', '||'];
const OPS1 = '+-*/%^<>!?:(),.[]';

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'" };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const pos = i;
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) {
      const m = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      i += m[0].length;
      out.push({ t: 'num', v: Number(m[0]), pos, end: i });
      continue;
    }
    if (c === '"' || c === "'") {
      let s = '';
      i++;
      for (;;) {
        if (i >= src.length) throw new FormulaError('문자열이 닫히지 않았어요', pos, src.length);
        const ch = src[i]!;
        if (ch === c) {
          i++;
          break;
        }
        if (ch === '\\') {
          const e = src[i + 1];
          if (e === undefined) throw new FormulaError('문자열이 닫히지 않았어요', pos, src.length);
          s += ESCAPES[e] ?? e;
          i += 2;
        } else {
          s += ch;
          i++;
        }
      }
      out.push({ t: 'str', v: s, pos, end: i });
      continue;
    }
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < src.length && ID_PART.test(src[j]!)) j++;
      out.push({ t: 'id', v: src.slice(i, j), pos, end: j });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (OPS2.includes(two)) {
      out.push({ t: 'op', v: two, pos, end: i + 2 });
      i += 2;
      continue;
    }
    if (OPS1.includes(c)) {
      out.push({ t: 'op', v: c, pos, end: i + 1 });
      i++;
      continue;
    }
    throw new FormulaError(`알 수 없는 문자: ${c}`, pos, pos + 1);
  }
  out.push({ t: 'eof', pos: src.length, end: src.length });
  return out;
}

/** 이항 연산자 우선순위(클수록 강하게 묶인다). `^` 는 오른쪽 결합. */
const BINARY: Record<string, { prec: number; right?: boolean; op: BinaryOp }> = {
  '||': { prec: 1, op: '||' },
  '&&': { prec: 2, op: '&&' },
  '==': { prec: 3, op: '==' },
  '!=': { prec: 3, op: '!=' },
  '<': { prec: 4, op: '<' },
  '<=': { prec: 4, op: '<=' },
  '>': { prec: 4, op: '>' },
  '>=': { prec: 4, op: '>=' },
  '+': { prec: 5, op: '+' },
  '-': { prec: 5, op: '-' },
  '*': { prec: 6, op: '*' },
  '/': { prec: 6, op: '/' },
  '%': { prec: 6, op: '%' },
  '^': { prec: 8, right: true, op: '^' },
};
const UNARY_PREC = 7; // 단항은 `^` 보다 약하다: -2^2 = -(2^2)
const WORD_OPS: Record<string, string> = { and: '&&', or: '||' };

class Parser {
  private i = 0;
  constructor(
    private readonly toks: Tok[],
    private readonly src: string,
  ) {}

  private get cur(): Tok {
    return this.toks[this.i]!;
  }
  private next(): Tok {
    return this.toks[this.i++]!;
  }
  private isOp(v: string): boolean {
    return this.cur.t === 'op' && this.cur.v === v;
  }
  private expectOp(v: string, what: string): Tok {
    if (!this.isOp(v)) throw new FormulaError(`${what}`, this.cur.pos, Math.max(this.cur.end, this.cur.pos + 1));
    return this.next();
  }

  parseAll(): Node {
    if ((this.cur as Tok).t === 'eof') throw new FormulaError('수식이 비어 있어요', 0, 0);
    const n = this.expr(0);
    const rest = this.cur as Tok;
    if (rest.t !== 'eof') throw new FormulaError(rest.t === 'op' && rest.v === ')' ? '짝이 맞지 않는 )' : '여기서는 수식이 끝나야 해요', rest.pos, rest.end);
    return n;
  }

  /** 삼항(`?:`)은 가장 약하다. */
  private expr(minPrec: number): Node {
    let left = this.unary();
    for (;;) {
      const t = this.cur;
      let key: string | undefined;
      if (t.t === 'op' && BINARY[t.v]) key = t.v;
      else if (t.t === 'id' && WORD_OPS[t.v]) key = WORD_OPS[t.v];
      if (key === undefined) break;
      const info = BINARY[key]!;
      if (info.prec < minPrec) break;
      this.next();
      const right = this.expr(info.right ? info.prec : info.prec + 1);
      left = { kind: 'binary', op: info.op, left, right, pos: left.pos, end: right.end };
    }
    if (minPrec === 0 && this.isOp('?')) {
      this.next();
      const then = this.expr(0);
      this.expectOp(':', '`?` 뒤에는 `:` 로 나뉜 두 번째 값이 필요해요');
      const otherwise = this.expr(0);
      return { kind: 'cond', test: left, then, otherwise, pos: left.pos, end: otherwise.end };
    }
    return left;
  }

  private unary(): Node {
    const t = this.cur;
    if ((t.t === 'op' && (t.v === '-' || t.v === '!')) || (t.t === 'id' && t.v === 'not')) {
      this.next();
      const arg = this.expr(UNARY_PREC);
      return { kind: 'unary', op: t.t === 'op' && t.v === '-' ? '-' : '!', arg, pos: t.pos, end: arg.end };
    }
    return this.postfix(this.primary());
  }

  private postfix(base: Node): Node {
    let n = base;
    while (this.isOp('.')) {
      this.next();
      const id = this.cur;
      if (id.t !== 'id') throw new FormulaError('`.` 뒤에는 함수 이름이 필요해요', id.pos, Math.max(id.end, id.pos + 1));
      this.next();
      if (!this.isOp('(')) throw new FormulaError(`\`${id.v}\` 뒤에 ( 가 필요해요 — 속성 접근은 지원하지 않아요`, id.pos, id.end);
      const { args, end } = this.args();
      n = { kind: 'method', target: n, name: id.v, args, pos: n.pos, end };
    }
    return n;
  }

  private args(): { args: Node[]; end: number } {
    this.expectOp('(', '( 가 필요해요');
    const args: Node[] = [];
    if (!this.isOp(')')) {
      for (;;) {
        args.push(this.expr(0));
        if (this.isOp(',')) {
          this.next();
          continue;
        }
        break;
      }
    }
    const close = this.expectOp(')', '인자 목록은 ) 로 닫아야 해요');
    return { args, end: close.end };
  }

  private primary(): Node {
    const t = this.next();
    switch (t.t) {
      case 'num':
        return { kind: 'num', value: t.v, pos: t.pos, end: t.end };
      case 'str':
        return { kind: 'str', value: t.v, pos: t.pos, end: t.end };
      case 'id': {
        if (t.v === 'true' || t.v === 'false') return { kind: 'bool', value: t.v === 'true', pos: t.pos, end: t.end };
        if (this.isOp('(')) {
          const { args, end } = this.args();
          return { kind: 'call', name: t.v, args, pos: t.pos, end };
        }
        return { kind: 'ident', name: t.v, pos: t.pos, end: t.end };
      }
      case 'op': {
        if (t.v === '(') {
          const inner = this.expr(0);
          this.expectOp(')', '( 를 ) 로 닫아야 해요');
          return inner;
        }
        if (t.v === '[') {
          const items: Node[] = [];
          if (!this.isOp(']')) {
            for (;;) {
              items.push(this.expr(0));
              if (this.isOp(',')) {
                this.next();
                continue;
              }
              break;
            }
          }
          const close = this.expectOp(']', '목록은 ] 로 닫아야 해요');
          return { kind: 'list', items, pos: t.pos, end: close.end };
        }
        throw new FormulaError(`여기에는 값이 와야 해요: ${t.v}`, t.pos, t.end);
      }
      case 'eof':
        throw new FormulaError('수식이 갑자기 끝났어요', this.src.length, this.src.length);
    }
  }
}

/** 수식 문자열을 구문 트리로. 문법 오류는 위치와 함께 `FormulaError` 로 던진다. */
export function parseFormula(src: string): Node {
  return new Parser(lex(src), src).parseAll();
}
