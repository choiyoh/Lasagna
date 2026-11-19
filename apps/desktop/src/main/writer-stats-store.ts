import { atomicWrite } from '@nopsidian/core';
import {
  OUTSIDE_WORK,
  addDailyDelta,
  closeWriterDay,
  dayKey,
  historyRange,
  moveWorkHistory,
  parseWriterDailyFile,
  todayChars,
  type WorkResolver,
  type WriterDailyFile,
  type WriterHistoryDay,
} from '@nopsidian/core';
import { copyFileSync, readFileSync } from 'node:fs';

/**
 * userData/writer-stats.json — 작가 모드 쓰기 통계(오늘 순변화 + 날짜별 확정 합계).
 * **볼트·노트에는 아무것도 쓰지 않는다.** 날짜가 바뀌면 지난 날을 history 로 닫아 보존하고,
 * 파일이 깨지면 원문을 `.bak` 으로 남긴 뒤 빈 값으로 복구하며, 쓰기는 원자적이다.
 */
export class WriterStatsStore {
  private file: WriterDailyFile | null = null;

  constructor(
    private readonly path: string,
    private readonly now: () => Date = () => new Date(),
    private readonly resolveWork: WorkResolver = () => OUTSIDE_WORK,
    /** 하루 목표(닫는 시점 값). 없으면 null — 과거 날짜의 달성 여부는 그때 목표로 고정된다. */
    private readonly dailyGoal: () => number | null = () => null,
  ) {}

  private todayKey(): string {
    return dayKey(this.now());
  }

  /** 깨진 원문은 덮어쓰기 전에 `.bak` 으로 남긴다(마지막 한 벌만). 실패해도 복구를 막지 않는다. */
  private backup(): void {
    try {
      copyFileSync(this.path, `${this.path}.bak`);
    } catch {
      // 원문을 읽지 못했으면 남길 것도 없다.
    }
  }

  private persist(file: WriterDailyFile): void {
    atomicWrite(this.path, `${JSON.stringify(file, null, 2)}\n`);
    this.file = file;
  }

  private load(): WriterDailyFile {
    const today = this.todayKey();
    if (this.file && this.file.today.date === today) return this.file;
    let raw: string | null = null;
    try {
      raw = readFileSync(this.path, 'utf8');
    } catch {
      raw = null;
    }
    const parsed = parseWriterDailyFile(raw, today);
    if (!parsed.valid && raw !== null) this.backup();
    const closed = closeWriterDay(parsed.file, today, this.resolveWork, this.dailyGoal());
    // 닫은 기록은 바로 남긴다(닫기 직후 앱이 죽어도 지난 날이 사라지지 않게). 실패해도 조회는 계속된다.
    if (closed !== parsed.file) {
      try {
        this.persist(closed);
        return closed;
      } catch {
        this.file = closed;
        return closed;
      }
    }
    this.file = closed;
    return closed;
  }

  /** 오늘 쓴 글자수와 오늘 날짜(자정을 넘겼으면 0). */
  todayStats(vaultId: string): { date: string; chars: number } {
    const file = this.load();
    return { date: file.today.date, chars: todayChars(file, vaultId) };
  }

  /** 문서 순변화를 더하고 저장한다. 저장 실패는 던진다(화면 값은 호출자가 유지). */
  add(vaultId: string, notePath: string, delta: number): { date: string; chars: number } {
    const today = this.todayKey();
    const loaded = this.load();
    const next = addDailyDelta(loaded, today, vaultId, notePath, delta);
    if (next !== loaded) this.persist(next);
    return { date: today, chars: todayChars(next, vaultId) };
  }

  /**
   * 기간(from~to)의 날짜별 합계. 오늘은 아직 저장 전인 현재 값을 계산해 넣는다.
   * 기록이 없는 날짜는 키가 없다.
   */
  range(vaultId: string, from: string, to: string): Record<string, WriterHistoryDay> {
    const file = this.load();
    return historyRange(file, vaultId, from, to, this.todayKey(), this.resolveWork);
  }

  /**
   * 작품 폴더 이름이 바뀌었을 때 지난 날짜의 작품별 키를 새 이름으로 옮긴다.
   * 옮긴 날짜 목록을 돌려준다(undo 가 그 날짜만 되돌린다). 옮길 것이 없으면 빈 배열.
   */
  move(vaultId: string, from: string, to: string): string[] {
    const loaded = this.load();
    const { file, moved } = moveWorkHistory(loaded, vaultId, from, to);
    if (moved.length > 0) this.persist(file);
    return moved;
  }

  /** 이름 바꾸기 취소 — 옮겼던 날짜만 역방향으로 되돌린다(경로 추정 없음). */
  undoMove(vaultId: string, from: string, to: string, dates: readonly string[]): string[] {
    const loaded = this.load();
    const { file, moved } = moveWorkHistory(loaded, vaultId, to, from, dates);
    if (moved.length > 0) this.persist(file);
    return moved;
  }
}
