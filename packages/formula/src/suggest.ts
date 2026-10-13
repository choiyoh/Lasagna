import { REGISTRY } from './eval.js';

export interface Suggestion {
  /** 목록에 보이는 이름 */
  label: string;
  /** 바꿔 넣을 텍스트 */
  insert: string;
  /** 보조 설명(인자 개수 등) */
  detail: string;
  kind: 'function' | 'property';
}
export interface SuggestResult {
  /** 바꿀 구간(원문 오프셋, to 는 배타) */
  from: number;
  to: number;
  items: Suggestion[];
}

const WORD = /[\p{L}\p{N}_$]*$/u;

const arity = (min: number, max: number) => (min === max ? `${min}개` : max === Infinity ? `${min}개 이상` : `${min}~${max}개`);

/**
 * 커서 위치에서 쓸 만한 자동 완성 후보.
 *  - `prop("` 안이면 속성 이름(`props`) 을 부분 일치로.
 *  - 그 밖에는 커서 앞의 단어로 시작하는 함수 이름(점 뒤라면 메서드로 쓸 수 있는 함수 전부).
 * 후보가 없으면 `null`.
 */
export function suggestAt(src: string, caret: number, props: string[], limit = 8): SuggestResult | null {
  const before = src.slice(0, caret);
  const inProp = /prop\(\s*(["'])([^"']*)$/.exec(before);
  if (inProp) {
    const typed = inProp[2]!;
    const from = caret - typed.length;
    const closing = src[caret] === inProp[1] ? 0 : 1;
    const items = props
      .filter((p) => p.toLowerCase().includes(typed.toLowerCase()))
      .slice(0, limit)
      .map((p) => ({ label: p, insert: closing ? `${p}${inProp[1]})` : p, detail: '속성', kind: 'property' as const }));
    return items.length ? { from, to: caret, items } : null;
  }
  const word = WORD.exec(before)![0];
  const from = caret - word.length;
  const afterDot = before[from - 1] === '.';
  if (!word && !afterDot) return null;
  const items = Object.entries(REGISTRY)
    .filter(([name]) => name.toLowerCase().startsWith(word.toLowerCase()) && name !== word)
    .sort(([a], [b]) => a.length - b.length || a.localeCompare(b))
    .slice(0, limit)
    .map(([name, def]) => ({ label: name, insert: def.min === 0 && def.max === 0 ? `${name}()` : `${name}(`, detail: arity(def.min, def.max), kind: 'function' as const }));
  return items.length ? { from, to: caret, items } : null;
}
