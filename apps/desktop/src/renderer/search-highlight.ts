/** 검색 결과에서 일치한 글자만 표시하기 위한 조각내기(원문은 그대로 두고 화면에서만 강조한다) */
export interface Part {
  text: string;
  hit: boolean;
}

const tokensOf = (query: string) =>
  query
    .trim()
    .split(/\s+/)
    // 제외어(-단어)는 결과를 좁히는 말이지 화면에서 강조할 말이 아니다
    .filter((t) => t.length > 0 && !t.startsWith('-'))
    .slice(0, 8);

/** 대소문자를 가리지 않고, 겹치는 구간은 하나로 합친다 */
function rangesOf(text: string, tokens: string[]): Array<[number, number]> {
  const lower = text.toLowerCase();
  const found: Array<[number, number]> = [];
  for (const token of tokens) {
    const needle = token.toLowerCase();
    let from = 0;
    while (needle && from <= lower.length) {
      const at = lower.indexOf(needle, from);
      if (at < 0) break;
      found.push([at, at + needle.length]);
      from = at + needle.length;
    }
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of found) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

export function matchParts(text: string, query: string): Part[] {
  const tokens = tokensOf(query);
  if (tokens.length === 0 || !text) return [{ text, hit: false }];
  const ranges = rangesOf(text, tokens);
  if (ranges.length === 0) return [{ text, hit: false }];
  const out: Part[] = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    if (s > pos) out.push({ text: text.slice(pos, s), hit: false });
    out.push({ text: text.slice(s, e), hit: true });
    pos = e;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), hit: false });
  return out;
}
