import type { NoteSummary } from '@nopsidian/ipc-contract';
import { createLinkResolver, linkNameFor } from '@nopsidian/core/links';
import type { LinkQuery, LinkSuggestion, NopsLinkHost } from '@nopsidian/editor/nops';
import { quickSwitch } from '../workers/index/quick-switch';

const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export { linkNameFor };

interface Sources {
  notes: () => readonly NoteSummary[];
  assets: () => readonly string[];
  currentPath: () => string;
  headings: (path: string) => Promise<{ text: string; level: number }[]>;
  blocks: (path: string) => Promise<{ id: string | null; text: string; line: number; type: string }[]>;
  /** 대상 노트의 그 줄에 블록 ID를 붙이고 ID를 돌려준다 */
  ensureBlockId: (path: string, line: number) => Promise<string>;
}

/** `[[` 자동완성 후보를 만든다: 노트(제목·별칭·경로 초성 검색) → `#`이면 그 노트의 제목 → `![[`이면 첨부도 함께 */
export function createLinkHost(src: Sources): NopsLinkHost {
  return {
    async suggest(query: LinkQuery, embed: boolean): Promise<LinkSuggestion[]> {
      const notes = src.notes();
      const paths = notes.map((n) => n.path);

      // `[[노트#제목`: 그 노트의 제목 목록
      if (query.heading !== null || query.block !== null) {
        const resolver = createLinkResolver(
          notes.map((n, i) => ({ id: i, path: n.path, title: n.title })),
          notes.flatMap((n, i) => n.aliases.map((alias) => ({ pageId: i, alias }))),
        );
        const current = src.currentPath();
        const id = query.name ? resolver(query.name, current) : notes.findIndex((n) => n.path === current);
        const note = id === undefined || id < 0 ? undefined : notes[id];
        if (!note) return [];
        const target = query.name ? linkNameFor(note.path, paths) : '';

        // `[[노트#^`: 그 노트의 블록 목록. ID가 없는 블록은 고르는 순간 대상 노트에 ID를 붙인다
        // (이 노트 자신은 편집 중인 내용과 디스크의 줄 번호가 다를 수 있어 ID가 이미 있는 블록만 보인다)
        if (query.block !== null) {
          const sameNote = !query.name || note.path === current;
          const blocks = (await src.blocks(note.path)).filter((b) => !sameNote || b.id);
          const hits = quickSwitch(
            blocks.map((b) => ({ path: String(b.line), title: b.text, aliases: b.id ? [b.id] : [] })),
            query.block,
            8,
          );
          return hits.map((h) => {
            const b = blocks.find((x) => String(x.line) === h.path)!;
            return {
              label: b.text,
              detail: b.id ? `^${b.id}` : '링크용 ID를 새로 만들어요',
              target,
              block: b.id,
              ranges: h.field === 'title' ? h.ranges : [],
              kind: 'block' as const,
              ...(b.id ? {} : { prepare: async () => ({ block: await src.ensureBlockId(note.path, b.line) }) }),
            };
          });
        }

        const heads = await src.headings(note.path);
        const hits = quickSwitch(
          heads.map((h) => ({ path: h.text, title: h.text, aliases: [] })),
          query.heading ?? '',
          8,
        );
        return hits.map((h) => ({
          label: h.title,
          detail: query.name ? note.title : '이 노트',
          target,
          heading: h.title,
          ranges: h.field === 'title' ? h.ranges : [],
          kind: 'heading' as const,
        }));
      }

      const out: LinkSuggestion[] = quickSwitch(
        notes.map((n) => ({ path: n.path, title: n.title, aliases: n.aliases })),
        query.name,
        8,
      ).map((h) => ({
        label: h.field === 'title' ? h.title : h.matchedText,
        detail: h.field === 'alias' ? `${h.title} · ${h.path}` : h.path,
        target: linkNameFor(h.path, paths),
        ranges: h.field === 'path' ? [] : h.ranges,
        kind: 'note' as const,
      }));

      if (embed) {
        const q = query.name.toLowerCase();
        const files = src.assets().filter((a) => !q || baseOf(a).toLowerCase().includes(q)).slice(0, 8);
        const allAssets = src.assets();
        for (const a of files) {
          const base = baseOf(a);
          const unique = allAssets.filter((x) => baseOf(x).toLowerCase() === base.toLowerCase()).length <= 1;
          out.push({ label: base, detail: a, target: unique ? base : a, kind: 'asset' });
        }
      }

      const exact = out.some((o) => o.target.toLowerCase() === query.name.toLowerCase());
      if (query.name && !exact) {
        out.push({ label: `“${query.name}” 링크 만들기`, detail: '아직 없는 노트', target: query.name, kind: 'create' });
      }
      return out;
    },
  };
}
