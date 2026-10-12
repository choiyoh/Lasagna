// 라운드트립·변환기 테스트용 합성 노트 생성기 (테스트 전용)
/** 재현 가능한 난수(mulberry32) */
export function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['클린', '코드', '리팩터링', 'note', '노트', '😀', '한글과 English', 'a_b_c', '*강조*', '**굵게**', '~~취소~~', '==형광펜==', '$x^2$', '`code`', '<b>html</b>', '\\*escaped\\*', '100%', 'a|b'];
const LINKS = ['[[노트]]', '[[노트|별칭]]', '[[노트#제목]]', '![[img.png|400]]', '[[노트#^id1]]', '[x](a/b.md#h)', '![이미지](a.png)', '#태그', '#중첩/태그', '#123'];

export function generateNote(seed: number): string {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const eol = r() < 0.15 ? '\r\n' : '\n';
  const sentence = () =>
    Array.from({ length: 1 + Math.floor(r() * 8) }, () => (r() < 0.3 ? pick(LINKS) : pick(WORDS))).join(' ') +
    (r() < 0.15 ? '  ' : '') +
    (r() < 0.1 ? ` ^${Math.floor(r() * 1e6).toString(36)}` : '');
  const gap = () => eol.repeat(1 + Math.floor(r() * 3));

  const parts: string[] = [];
  if (r() < 0.6) {
    const fm = ['id: 01JA7Z3K9V6Q8M2N4P5R7S9T0W'];
    if (r() < 0.7) fm.push(`title: ${pick(WORDS).replace(/[:#[\]{}*&!|>'"%@`]/g, '')}`);
    if (r() < 0.5) fm.push(`aliases: [A, B]`);
    if (r() < 0.5) fm.push(`tags: [a, b]`);
    if (r() < 0.3) fm.push(`관련: ["[[노트]]"]`);
    parts.push(`---${eol}${fm.join(eol)}${eol}---${gap()}`);
  }
  const n = 1 + Math.floor(r() * 12);
  for (let i = 0; i < n; i++) {
    const t = r();
    let b: string;
    if (t < 0.25) b = sentence();
    else if (t < 0.4) b = `${'#'.repeat(1 + Math.floor(r() * 4))} ${sentence()}`;
    else if (t < 0.55) b = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, k) => `${r() < 0.5 ? '-' : `${k + 1}.`} ${r() < 0.3 ? '[ ] ' : ''}${sentence()}`).join(eol);
    else if (t < 0.62) b = '```ts' + eol + 'const a = "[[코드]]"; // #nottag' + eol + '```';
    else if (t < 0.7) b = `> [!${pick(['note', 'tip', 'warning'])}]${pick(['', '-', '+'])} ${sentence()}${eol}> ${sentence()}`;
    else if (t < 0.77) b = `> ${sentence()}`;
    else if (t < 0.83) b = `| a | b |${eol}| - | - |${eol}| ${sentence().replace(/\|/g, '/')} | 2 |`;
    else if (t < 0.87) b = '---';
    else if (t < 0.9) b = `$$${eol}x^2${eol}$$`;
    else if (t < 0.93) b = `:::${pick(['columns', 'column', ''])}`;
    else if (t < 0.96) b = `<div>${eol}${sentence()}${eol}</div>`;
    else b = `    ${sentence()}`; // 들여쓰기 코드 블록
    parts.push(b + (i === n - 1 && r() < 0.5 ? '' : gap()));
  }
  return parts.join('');
}

export function randomGarbage(seed: number): string {
  const r = rng(seed);
  const chars = ['#', '[', ']', '(', ')', '`', '*', '_', '>', '-', '|', ':', '^', '!', '$', '\n', '\r\n', ' ', '\t', '가', 'a', '1', '<', '{', '}', '=', '~', '---\n', '[[', ']]', ':::'];
  return Array.from({ length: Math.floor(r() * 120) }, () => chars[Math.floor(r() * chars.length)]!).join('');
}

