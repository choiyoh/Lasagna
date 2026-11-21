/**
 * 찾기·바꾸기 '조사 맞추기': 바꾼 말의 받침에 맞춰 바로 뒤따르는 조사를 고른다.
 * 예) '유리는' 에서 '유리' → '요한' 이면 '요한은'.
 *
 * 조사 꼴은 소스에 한글을 그대로 쓰지 않고 코드포인트로 만든다(한글 리터럴 가드 — UI 문구가 아니다).
 */

/** 한글 음절의 받침. `unknown` 은 마지막 글자가 한글이 아닐 때(영문·숫자·기호·빈 문자열)다. */
export type Batchim = 'none' | 'rieul' | 'other' | 'unknown';

const SYLLABLE_FIRST = 0xac00; // 가
const SYLLABLE_LAST = 0xd7a3; // 힣
const JONGSEONG_COUNT = 28;
const JONGSEONG_RIEUL = 8; // 종성 순서: 없음·ㄱ·ㄲ·ㄳ·ㄴ… 의 ㄹ 자리

const chars = (...codes: number[]): string => String.fromCodePoint(...codes);

interface ParticlePair {
  /** 받침이 있을 때 쓰는 꼴 */
  withBatchim: string;
  /** 받침이 없을 때 쓰는 꼴 */
  withoutBatchim: string;
  /** ㄹ 받침이면 받침 없는 꼴을 쓴다(으로/로 가족) */
  rieulTakesWithout?: boolean;
}

/** 맞추는 조사 짝. 아/야·서술형(이다/이에요/이며…)은 일부러 넣지 않는다. */
const PAIRS: readonly ParticlePair[] = [
  { withBatchim: chars(0xc740), withoutBatchim: chars(0xb294) }, // 은 / 는
  { withBatchim: chars(0xc774), withoutBatchim: chars(0xac00) }, // 이 / 가
  { withBatchim: chars(0xc744), withoutBatchim: chars(0xb97c) }, // 을 / 를
  { withBatchim: chars(0xacfc), withoutBatchim: chars(0xc640) }, // 과 / 와
  { withBatchim: chars(0xc73c, 0xb85c), withoutBatchim: chars(0xb85c), rieulTakesWithout: true }, // 으로 / 로
  { withBatchim: chars(0xc73c, 0xb85c, 0xc11c), withoutBatchim: chars(0xb85c, 0xc11c), rieulTakesWithout: true }, // 으로서 / 로서
  { withBatchim: chars(0xc73c, 0xb85c, 0xc368), withoutBatchim: chars(0xb85c, 0xc368), rieulTakesWithout: true }, // 으로써 / 로써
  {
    withBatchim: chars(0xc73c, 0xb85c, 0xbd80, 0xd130),
    withoutBatchim: chars(0xb85c, 0xbd80, 0xd130),
    rieulTakesWithout: true,
  }, // 으로부터 / 로부터
  { withBatchim: chars(0xc774, 0xb098), withoutBatchim: chars(0xb098) }, // 이나 / 나
  { withBatchim: chars(0xc774, 0xb791), withoutBatchim: chars(0xb791) }, // 이랑 / 랑
];

/** 조사로 볼 꼴 전부, 긴 꼴부터(으로부터 > 으로). */
const FORMS: readonly string[] = PAIRS.flatMap((pair) => [pair.withBatchim, pair.withoutBatchim]).sort((a, b) => b.length - a.length);

/** 조사 바로 뒤에 와도 조사로 보는 글자: 문장부호·닫는 따옴표·닫는 괄호. 공백과 문단 끝은 따로 본다. */
const BOUNDARY_PUNCTUATION = new Set(['.', ',', '!', '?', '…', '·', '"', '”', '’', '」', '』', ')']);

/** 마지막 글자가 한글 음절이면 받침 유무(ㄹ 인지 포함), 한글이 아니면 'unknown'. */
export function hasBatchim(word: string): Batchim {
  const last = Array.from(word).pop();
  if (!last) return 'unknown';
  const code = last.codePointAt(0) ?? 0;
  if (code < SYLLABLE_FIRST || code > SYLLABLE_LAST) return 'unknown';
  const jongseong = (code - SYLLABLE_FIRST) % JONGSEONG_COUNT;
  if (jongseong === 0) return 'none';
  return jongseong === JONGSEONG_RIEUL ? 'rieul' : 'other';
}

/**
 * 조사 `particle` 을 새 말 `word` 에 맞는 쪽으로 고른다.
 * 받침을 모르면(영문·숫자로 끝남)이나 짝 표에 없는 조사면 그대로 둔다.
 */
export function adjustParticle(word: string, particle: string): string {
  const batchim = hasBatchim(word);
  if (batchim === 'unknown') return particle;
  const pair = PAIRS.find((candidate) => candidate.withBatchim === particle || candidate.withoutBatchim === particle);
  if (!pair) return particle;
  const without = batchim === 'none' || (batchim === 'rieul' && !!pair.rieulTakesWithout);
  return without ? pair.withoutBatchim : pair.withBatchim;
}

/**
 * 일치 바로 뒤 문단 텍스트 `following` 이 조사로 시작하면 그 조사 자리를 알려 준다.
 * 조사 뒤가 공백·문장부호·문단 끝일 때만 조사로 본다('유리가게'·'유리는요' 는 건드리지 않는다).
 */
export function adjustParticleAt(word: string, following: string): { length: number; text: string } | null {
  for (const form of FORMS) {
    if (!following.startsWith(form)) continue;
    const next = following[form.length];
    if (next !== undefined && !/\s/.test(next) && !BOUNDARY_PUNCTUATION.has(next)) continue;
    return { length: form.length, text: adjustParticle(word, form) };
  }
  return null;
}
