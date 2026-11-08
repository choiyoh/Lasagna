import { atomicWrite } from '@nopsidian/core';
import { addDailyDelta, dayKey, parseWriterDaily, todayChars, type WriterDailyFile } from '@nopsidian/core';
import { readFileSync } from 'node:fs';

/**
 * userData/writer-stats.json — 작가 모드 '오늘 쓴 글자수'만 담는다.
 * **볼트·노트에는 아무것도 쓰지 않는다.** 파일이 깨지면 빈 값으로 복구하고, 쓰기는 원자적이다.
 */
export class WriterStatsStore {
  private file: WriterDailyFile | null = null;

  constructor(
    private readonly path: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private todayKey(): string {
    return dayKey(this.now());
  }

  private load(): WriterDailyFile {
    const today = this.todayKey();
    if (!this.file || this.file.date !== today) {
      let raw: string | null = null;
      try {
        raw = readFileSync(this.path, 'utf8');
      } catch {
        raw = null;
      }
      this.file = parseWriterDaily(raw, today);
    }
    return this.file;
  }

  /** 오늘 쓴 글자수와 오늘 날짜(자정을 넘겼으면 0). */
  todayStats(vaultId: string): { date: string; chars: number } {
    const file = this.load();
    return { date: file.date, chars: todayChars(file, vaultId) };
  }

  /** 문서 순변화를 더하고 저장한다. 저장 실패는 던진다(화면 값은 호출자가 유지). */
  add(vaultId: string, notePath: string, delta: number): { date: string; chars: number } {
    const today = this.todayKey();
    const next = addDailyDelta(this.load(), today, vaultId, notePath, delta);
    if (next !== this.file) {
      atomicWrite(this.path, `${JSON.stringify(next, null, 2)}\n`);
      this.file = next;
    }
    return { date: today, chars: todayChars(next, vaultId) };
  }
}
