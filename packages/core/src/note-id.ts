import { randomBytes } from 'node:crypto';
import { splitFrontmatter } from './markdown/frontmatter.js';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 26자 ULID (시간 48비트 + 난수 80비트). 노트 ID는 이름이 바뀌어도 변하지 않는다. */
export function newNoteId(now = Date.now()): string {
  let t = now;
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32]! + time;
    t = Math.floor(t / 32);
  }
  const rand = randomBytes(16);
  let r = '';
  for (let i = 0; i < 16; i++) r += CROCKFORD[rand[i]! % 32]!;
  return time + r;
}

const FM_START = /^---[ \t]*(\r?\n)/;

/**
 * 프런트매터에 `id:`가 없으면 최소한의 텍스트 삽입으로 넣는다(나머지 바이트는 그대로).
 * 프런트매터가 없으면 맨 앞에 새로 만든다. 이미 id가 있으면 원문을 그대로 돌려준다.
 */
export function ensureNoteId(source: string, id = newNoteId()): { source: string; id: string; added: boolean } {
  const m = FM_START.exec(source);
  if (!m) {
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    return { source: `---${eol}id: ${id}${eol}---${eol}${eol}${source}`, id, added: true };
  }
  const fmId = splitFrontmatter(source)?.data.id;
  if (typeof fmId === 'string' && fmId) return { source, id: fmId, added: false };
  const eol = m[1]!;
  const at = m[0].length;
  return { source: source.slice(0, at) + `id: ${id}${eol}` + source.slice(at), id, added: true };
}
