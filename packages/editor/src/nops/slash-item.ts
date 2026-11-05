import { t, type MessageKey } from '@nopsidian/i18n';
import type { SlashItemSpec } from '@oh-new-editor/core';

/** 라벨·설명을 메뉴를 그릴 때 읽는 슬래시 항목 — 언어를 바꾸면 다음에 메뉴를 열 때 새 언어가 나온다. */
export function lazySlashItem(
  base: Omit<SlashItemSpec, 'label' | 'description'>,
  labelKey: MessageKey,
  descriptionKey: MessageKey,
): SlashItemSpec {
  const item = { ...base } as SlashItemSpec;
  Object.defineProperties(item, {
    label: { enumerable: true, get: () => t(labelKey) },
    description: { enumerable: true, get: () => t(descriptionKey) },
  });
  return item;
}
