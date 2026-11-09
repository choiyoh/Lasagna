/**
 * 집중 모드 타자기 스크롤 계산(순수 함수).
 * 커서 줄을 스크롤 영역 높이의 `ratio`(기본 0.42) 위치에 두되, 문서 처음/끝에서는 과한 빈 공간을 만들지 않게 클램프한다.
 */
export interface TypewriterInput {
  /** 스크롤 영역의 화면상 top */
  containerTop: number;
  containerHeight: number;
  /** 커서 줄의 화면상 top */
  caretTop: number;
  scrollTop: number;
  scrollHeight: number;
}

export function typewriterScrollTop(input: TypewriterInput, ratio = 0.42): number {
  const target = input.scrollTop + (input.caretTop - (input.containerTop + input.containerHeight * ratio));
  const max = Math.max(0, input.scrollHeight - input.containerHeight);
  return Math.max(0, Math.min(max, Math.round(target)));
}

/** 집중 모드 본문 폭 — 920px 이하면 560, 아니면 680. */
export function focusContentWidth(viewportWidth: number): number {
  return viewportWidth <= 920 ? 560 : 680;
}
