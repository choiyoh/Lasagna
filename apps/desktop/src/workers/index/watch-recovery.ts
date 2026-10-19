/** 연속 실패 횟수별 복구 대기(ms): 첫 실패는 바로, 그다음은 5초, 그 뒤로는 30초. */
export const RECOVER_DELAYS_MS: readonly number[] = [0, 5_000, 30_000];

export function recoverDelayMs(failures: number): number {
  return RECOVER_DELAYS_MS[Math.min(failures, RECOVER_DELAYS_MS.length - 1)];
}

export interface WatchRecoveryOptions {
  /** 실제 복구 작업(다시 구독 + 증분 스캔). 던지면 실패로 보고 다시 예약한다. */
  run: () => Promise<void>;
  /** 오류 하나를 알린다(워커 이벤트로 내보내는 용도) */
  onError?: (message: string) => void;
}

/**
 * 감시 오류 복구 스케줄러.
 * 복구는 한 번에 하나만 돌리고(도는 동안 온 오류는 세기만 한다),
 * 실패가 이어지면 대기 시간을 늘려 촘촘한 재시도로 CPU 를 태우지 않는다.
 */
export class WatchRecovery {
  private failures = 0;
  private running = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly opts: WatchRecoveryOptions) {}

  /** 오류 하나를 기록한다. 복구가 이미 돌고 있으면 세기만 하고 돌아온다. */
  fail(message: string): void {
    if (this.stopped) return;
    this.opts.onError?.(message);
    const delay = recoverDelayMs(this.failures);
    this.failures++;
    if (this.running) return;
    this.running = true;
    if (delay > 0) this.timer = setTimeout(() => void this.execute(), delay);
    else void this.execute();
  }

  /** 닫을 때: 예약된 복구를 취소하고 더는 다시 시도하지 않는다 */
  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async execute(): Promise<void> {
    this.timer = undefined;
    const seen = this.failures;
    try {
      await this.opts.run();
      // 복구 중에 새 오류가 없었을 때만 성공으로 친다(있었으면 다음 오류는 더 물러나서 재시도)
      if (this.failures === seen) this.failures = 0;
    } catch (e) {
      this.running = false;
      this.fail(e instanceof Error ? e.message : String(e));
      return;
    }
    this.running = false;
  }
}
