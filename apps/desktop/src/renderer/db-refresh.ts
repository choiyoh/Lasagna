/**
 * DB 목록·화면의 다시 읽기 예약. 노트·첨부 변경은 잠깐 모아서(디바운스) 읽고,
 * 언어 변경은 화면이 곧바로 새 언어로 보여야 하므로 **즉시** 읽는다(대기 중인 예약은 취소).
 */
export function createReload(delayMs: number, run: () => void): { schedule: () => void; now: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return {
    schedule: () => {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        run();
      }, delayMs);
    },
    now: () => {
      // 대기 중인 예약을 취소해 같은 변경을 두 번 읽지 않는다.
      cancel();
      run();
    },
    cancel,
  };
}
