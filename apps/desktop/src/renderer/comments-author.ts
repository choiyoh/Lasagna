import { MAX_COMMENT_CHARS, SELF_AUTHOR } from '@nopsidian/core';
import { t } from '@nopsidian/i18n';

/** 댓글 작성자 표시 이름. 저장값이 `나` 이면 지금 언어의 '나'/'Me', 그 밖의 이름은 그대로. */
export function commentAuthorName(author: string, self = SELF_AUTHOR): string {
  return author === self ? t('comments.me') : author;
}

/**
 * 너무 긴 댓글은 IPC 입력 스키마(max)가 먼저 막아 raw 검증 오류가 화면에 뜬다 —
 * 보내기 전에 같은 한도로 확인해 사용자 문구를 돌려준다(괜찮으면 null).
 */
export function commentLengthError(text: string, max = MAX_COMMENT_CHARS): string | null {
  return text.trim().length > max ? t('core.err.commentTooLong', { max }) : null;
}
