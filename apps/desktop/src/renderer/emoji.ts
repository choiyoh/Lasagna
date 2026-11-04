import { getLocale, type Locale, type MessageKey } from '@nopsidian/i18n';
/** 표준 유니코드 이모지(한국어 이름·태그로 검색). 데이터는 처음 쓸 때만 불러온다. */
export interface EmojiItem {
  emoji: string;
  label: string;
  tags: string[];
  group: number;
}

/** emojibase 그룹 번호 → 이름(2 = 구성 요소는 쓰지 않는다) */
export const EMOJI_GROUPS: { group: number; labelKey: MessageKey; icon: string }[] = [
  { group: 0, labelKey: 'emoji.group.faces', icon: '😀' },
  { group: 1, labelKey: 'emoji.group.people', icon: '👋' },
  { group: 3, labelKey: 'emoji.group.nature', icon: '🐶' },
  { group: 4, labelKey: 'emoji.group.food', icon: '🍎' },
  { group: 5, labelKey: 'emoji.group.travel', icon: '🚗' },
  { group: 6, labelKey: 'emoji.group.activity', icon: '⚽' },
  { group: 7, labelKey: 'emoji.group.objects', icon: '💡' },
  { group: 8, labelKey: 'emoji.group.symbols', icon: '❤️' },
  { group: 9, labelKey: 'emoji.group.flags', icon: '🏳️' },
];

const caches = new Map<Locale, Promise<EmojiItem[]>>();

/** 이모지 이름·태그는 앱 언어 데이터셋에서 읽는다(ko·en 모두 emojibase). */
export function loadEmojis(locale: Locale = getLocale()): Promise<EmojiItem[]> {
  const cached = caches.get(locale);
  if (cached) return cached;
  const load = locale === 'ko' ? import('emojibase-data/ko/compact.json') : import('emojibase-data/en/compact.json');
  const result = load.then((m) =>
    (m.default as { unicode: string; label: string; tags?: string[]; group?: number }[])
      .filter((e) => e.group !== undefined && e.group !== 2)
      .map((e) => ({ emoji: e.unicode, label: e.label, tags: e.tags ?? [], group: e.group! })),
  );
  caches.set(locale, result);
  return result;
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
