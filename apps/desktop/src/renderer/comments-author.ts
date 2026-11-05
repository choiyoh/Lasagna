import { SELF_AUTHOR } from '@nopsidian/core';
import { t } from '@nopsidian/i18n';

/** 댓글 작성자 표시 이름. 저장값이 `나` 이면 지금 언어의 '나'/'Me', 그 밖의 이름은 그대로. */
export function commentAuthorName(author: string, self = SELF_AUTHOR): string {
  return author === self ? t('comments.me') : author;
}
