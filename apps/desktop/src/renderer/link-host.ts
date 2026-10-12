import type { NoteSummary } from '@nopsidian/ipc-contract';
import { createLinkResolver } from '@nopsidian/core/links';
import type { LinkQuery, LinkSuggestion, NopsLinkHost } from '@nopsidian/editor/nops';
import { quickSwitch } from '../workers/index/quick-switch';

const stripMd = (p: string) => (p.toLowerCase().endsWith('.md') ? p.slice(0, -3) : p);
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** 링크에 쓸 이름: 파일 이름이 볼트에서 유일하면 파일 이름만, 아니면 경로(확장자 제외) */
export function linkNameFor(path: string, allPaths: readonly string[]): string {
  const base = stripMd(baseOf(path)).toLowerCase();
  const same = allPaths.filter((p) => stripMd(baseOf(p)).toLowerCase() === base).length;
  return same <= 1 ? stripMd(baseOf(path)) : stripMd(path);
}

interface Sources {
  notes: () => readonly NoteSummary[];
  assets: () => readonly string[];
  currentPath: () => string;
  headings: (path: string) => Promise<{ text: string; level: number }[]>;
}

/** `[[` 자동완성 후보를 만든다: 노트(제목·별칭·경로 초성 검색) → `#`이면 그 노트의 제목 → `![[`이면 첨부도 함께 */
export function createLinkHost(src: Sources): NopsLinkHost {
  return {
    async suggest(query: LinkQuery, embed: boolean): Promise<LinkSuggestion[]> {
      const notes = src.notes();
      const paths = notes.map((n) => n.path);

      // `[[노트#제목`: 그 노트의 제목 목록
      if (query.heading !== null || query.block !== null) {
        if (query.block !== null) return []; // 블록 ID는 직접 입력한다
        const resolver = createLinkResolver(
          notes.map((n, i) => ({ id: i, path: n.path, title: n.title })),
          notes.flatMap((n, i) => n.aliases.map((alias) => ({ pageId: i, alias }))),
        );
        const current = src.currentPath();
        const id = query.name ? resolver(query.name, current) : notes.findIndex((n) => n.path === current);
        const note = id === undefined || id < 0 ? undefined : notes[id];
        if (!note) return [];
        const heads = await src.headings(note.path);
        const hits = quickSwitch(
          heads.map((h) => ({ path: h.text, title: h.text, aliases: [] })),
          query.heading ?? '',
          8,
        );
        const target = query.name ? linkNameFor(note.path, paths) : '';
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
