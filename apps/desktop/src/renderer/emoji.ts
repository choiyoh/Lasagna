/** 표준 유니코드 이모지(한국어 이름·태그로 검색). 데이터는 처음 쓸 때만 불러온다. */
export interface EmojiItem {
  emoji: string;
  label: string;
  tags: string[];
  group: number;
}

/** emojibase 그룹 번호 → 이름(2 = 구성 요소는 쓰지 않는다) */
export const EMOJI_GROUPS: { group: number; name: string; icon: string }[] = [
  { group: 0, name: '얼굴·감정', icon: '😀' },
  { group: 1, name: '사람', icon: '👋' },
  { group: 3, name: '동물·자연', icon: '🐶' },
  { group: 4, name: '음식', icon: '🍎' },
  { group: 5, name: '여행·장소', icon: '🚗' },
  { group: 6, name: '활동', icon: '⚽' },
  { group: 7, name: '사물', icon: '💡' },
  { group: 8, name: '기호', icon: '❤️' },
  { group: 9, name: '깃발', icon: '🏳️' },
];

let cache: Promise<EmojiItem[]> | null = null;

export function loadEmojis(): Promise<EmojiItem[]> {
  cache ??= import('emojibase-data/ko/compact.json').then((m) =>
    (m.default as { unicode: string; label: string; tags?: string[]; group?: number }[])
      .filter((e) => e.group !== undefined && e.group !== 2)
      .map((e) => ({ emoji: e.unicode, label: e.label, tags: e.tags ?? [], group: e.group! })),
  );
  return cache;
}

/** 이름·태그에 질의(공백으로 나눈 모든 낱말)가 들어 있는 이모지 */
export function searchEmojis(all: readonly EmojiItem[], query: string, limit = 120): EmojiItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const out: EmojiItem[] = [];
  for (const e of all) {
    const hay = `${e.label} ${e.tags.join(' ')}`.toLowerCase();
    if (words.every((w) => hay.includes(w))) {
      out.push(e);
      if (out.length >= limit) break;
    }
  }
  return out;
}

const RECENT_KEY = 'nops.emoji.recent';

export function recentEmojis(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 16) : [];
  } catch {
    return [];
  }
}

export function pushRecentEmoji(emoji: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...recentEmojis().filter((e) => e !== emoji)].slice(0, 16)));
  } catch {
    /* 기록은 없어도 된다 */
  }
}
