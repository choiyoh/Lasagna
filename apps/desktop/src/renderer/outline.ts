/** 개요 패널 ↔ 에디터 사이의 창 이벤트(같은 창 안에서만 쓴다) */
export interface OutlineItem {
  text: string;
  level: number;
  /** 문서 안 위치(ProseMirror) */
  pos: number;
}
export interface OutlineEvent {
  path: string;
  items: OutlineItem[];
}
/** 에디터 → 패널: 제목 목록이 바뀌었다 */
export const OUTLINE_EVENT = 'nops:outline';
/** 패널 → 에디터: 지금 목록을 보내 달라 */
export const OUTLINE_REQUEST = 'nops:outline-request';
/** 패널 → 에디터: 이 위치로 이동 */
export const OUTLINE_JUMP = 'nops:outline-jump';

/** 댓글 패널 → 에디터: 지금 선택한 글을 알려 달라(인용용) */
export const SELECTION_REQUEST = 'nops:selection-request';
/** 에디터 → 댓글 패널: 선택한 글 */
export const SELECTION_REPLY = 'nops:selection-reply';
