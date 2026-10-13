export type DiffOp = { type: 'same' | 'add' | 'del'; text: string };

/** 줄 단위 diff(공통 앞뒤를 자른 뒤 LCS). 아주 큰 입력은 가운데를 통째로 바뀐 것으로 본다. */
export function lineDiff(a: string, b: string): DiffOp[] {
  const x = a.split('\n');
  const y = b.split('\n');
  let s = 0;
  while (s < x.length && s < y.length && x[s] === y[s]) s++;
  let ex = x.length;
  let ey = y.length;
  while (ex > s && ey > s && x[ex - 1] === y[ey - 1]) {
    ex--;
    ey--;
  }
  const out: DiffOp[] = x.slice(0, s).map((text) => ({ type: 'same', text }));
  const mx = x.slice(s, ex);
  const my = y.slice(s, ey);
  if (mx.length * my.length > 4_000_000) {
    out.push(...mx.map((text) => ({ type: 'del' as const, text })), ...my.map((text) => ({ type: 'add' as const, text })));
  } else {
    const n = mx.length;
    const m = my.length;
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = mx[i] === my[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (mx[i] === my[j]) {
        out.push({ type: 'same', text: mx[i]! });
        i++;
        j++;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ type: 'del', text: mx[i++]! });
      else out.push({ type: 'add', text: my[j++]! });
    }
    while (i < n) out.push({ type: 'del', text: mx[i++]! });
    while (j < m) out.push({ type: 'add', text: my[j++]! });
  }
  out.push(...x.slice(ex).map((text) => ({ type: 'same' as const, text })));
  return out;
}
