import { diff3Merge } from 'node-diff3';
import { parseNote } from './markdown/parse.js';

export const CONFLICT_START = '<!-- nopsidian:conflict:start -->';
export const CONFLICT_MIDDLE = '<!-- nopsidian:conflict:theirs -->';
export const CONFLICT_END = '<!-- nopsidian:conflict:end -->';

export interface MergeResult {
  text: string;
  /** 충돌 없이 병합됐는가 */
  clean: boolean;
  conflicts: number;
}

/**
 * 노트를 병합 단위로 나눈다. 단위 = (앞쪽 공백 + 블록 원문). 프런트매터는 첫 블록 단위에 포함되고,
 * 마지막 블록 뒤 꼬리(끝 줄바꿈 등)는 별도 단위다. 단위를 이어붙이면 항상 원문이 된다.
 */
export function splitUnits(source: string): string[] {
  const note = parseNote(source);
  const units: string[] = [];
  let pos = 0;
  for (const b of note.blocks) {
    units.push(source.slice(pos, b.end));
    pos = b.end;
  }
  if (pos < source.length) units.push(source.slice(pos));
  return units;
}

/**
 * 블록 단위 3-way 병합. base = 마지막 저장본, ours = 앱 편집본, theirs = 디스크(외부 편집)본.
 * 충돌 구간은 양쪽을 모두 남기고 HTML 주석 표식으로 감싼다(다른 앱에서도 보이지 않고, 앱이 감지할 수 있다).
 */
export function merge3(base: string, ours: string, theirs: string): MergeResult {
  if (ours === theirs) return { text: ours, clean: true, conflicts: 0 };
  if (base === ours) return { text: theirs, clean: true, conflicts: 0 };
  if (base === theirs) return { text: ours, clean: true, conflicts: 0 };

  const chunks = diff3Merge(splitUnits(ours), splitUnits(base), splitUnits(theirs), {
    excludeFalseConflicts: true,
  });
  let text = '';
  let conflicts = 0;
  for (const c of chunks) {
    if (c.ok) {
      text += c.ok.join('');
    } else if (c.conflict) {
      const resolved = resolveAdjacent(c.conflict.a, c.conflict.o, c.conflict.b);
      if (resolved) {
        text += resolved.join('');
        continue;
      }
      conflicts++;
      const a = c.conflict.a.join('');
      const b = c.conflict.b.join('');
      text += `\n${CONFLICT_START}\n${a.replace(/^\n+/, '')}\n${CONFLICT_MIDDLE}\n${b.replace(/^\n+/, '')}\n${CONFLICT_END}\n`;
    }
  }
  return { text, clean: conflicts === 0, conflicts };
}

/**
 * diff3는 서로 이웃한 블록을 각각 고치면 한 덩어리 충돌로 묶는다. 세 쪽의 길이가 같으면(블록 수가 안 바뀜)
 * 블록별로 다시 판정해서, 한쪽만 바꾼 블록은 그 변경을 채택하고 양쪽이 다르게 바꾼 블록이 있을 때만 충돌로 남긴다.
 */
function resolveAdjacent(a: string[], o: string[], b: string[]): string[] | undefined {
  if (a.length !== o.length || b.length !== o.length) return undefined;
  const out: string[] = [];
  for (let i = 0; i < o.length; i++) {
    const [x, y, z] = [a[i]!, o[i]!, b[i]!];
    if (x === z) out.push(x);
    else if (x === y) out.push(z);
    else if (z === y) out.push(x);
    else return undefined;
  }
  return out;
}
