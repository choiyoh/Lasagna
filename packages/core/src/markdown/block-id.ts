import { parseNote } from './parse.js';

export interface EnsureBlockIdResult {
  content: string;
  /** 그 줄의 블록에 붙어 있는(또는 방금 붙인) ID */
  id: string;
  changed: boolean;
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const LINE_ID = /(?:^|\s)\^([A-Za-z0-9-]+)[ \t]*$/;

/** 노트 안에서 겹치지 않는 6자 블록 ID */
export function newBlockId(existing: ReadonlySet<string>): string {
  for (;;) {
    // 브라우저(렌더러)와 Node 양쪽에서 쓰므로 Web Crypto를 쓴다
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
    let id = '';
    for (let i = 0; i < 6; i++) id += ID_CHARS[bytes[i]! % ID_CHARS.length];
    if (!existing.has(id)) return id;
  }
}

/**
 * `line`(1부터, 파일 전체 기준)이 속한 블록에 `^id`를 보장한다. 이미 있으면 그대로 돌려준다.
 *  - 문단·제목·목록 항목·인용·콜아웃: 그 줄(인용·콜아웃은 블록의 마지막 줄) 끝에 ` ^id`를 붙인다
 *  - 표·코드·수식 같이 줄 끝에 붙일 수 없는 블록: 바로 아래에 `^id` 한 줄을 따로 둔다(Obsidian과 같은 방식)
 * 나머지 바이트(줄바꿈 방식 포함)는 건드리지 않는다. 블록을 못 찾으면 null.
 */
export function ensureBlockIdAt(content: string, line: number, makeId?: (existing: Set<string>) => string): EnsureBlockIdResult | null {
  const note = parseNote(content);
  const block = note.blocks.find((b) => line >= b.lineStart && line <= b.lineEnd);
  if (!block) return null;
  const existing = new Set(note.meta.blockIds.map((b) => b.id));
  const eol = content.includes('\r\n') ? '\r\n' : '\n';

  const lines = block.source.split('\n').map((l) => l.replace(/\r$/, ''));
  const simpleKinds = new Set(['paragraph', 'heading', 'list', 'quote', 'callout']);

  if (simpleKinds.has(block.kind)) {
    // 목록은 가리킨 줄, 나머지는 블록의 마지막 줄
    const target = block.kind === 'list' ? Math.min(Math.max(line - block.lineStart, 0), lines.length - 1) : lines.length - 1;
    const found = LINE_ID.exec(lines[target]!);
    if (found) return { content, id: found[1]!, changed: false };
    const id = (makeId ?? newBlockId)(existing);
    // 줄 끝(\r 앞)에 붙인다
    let offset = block.start;
    for (let i = 0; i < target; i++) offset += lines[i]!.length + (block.source.split('\n')[i]!.endsWith('\r') ? 2 : 1);
    const at = offset + lines[target]!.length;
    return { content: `${content.slice(0, at).replace(/[ \t]+$/, '')} ^${id}${content.slice(at)}`, id, changed: true };
  }

  // 표·코드·수식 등: 아래에 단독 줄
  const nextBlock = note.blocks[block.index + 1];
  if (nextBlock && /^\^[A-Za-z0-9-]+\s*$/.test(nextBlock.source)) {
    return { content, id: nextBlock.source.trim().slice(1), changed: false };
  }
  const id = (makeId ?? newBlockId)(existing);
  const at = block.end;
  return { content: `${content.slice(0, at)}${eol}${eol}^${id}${content.slice(at)}`, id, changed: true };
}
