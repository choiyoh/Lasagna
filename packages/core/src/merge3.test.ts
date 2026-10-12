import { describe, expect, it } from 'vitest';
import { CONFLICT_END, CONFLICT_MIDDLE, CONFLICT_START, merge3, splitUnits } from './merge3.js';

const base = '# 제목\n\n첫 문단\n\n둘째 문단\n\n셋째 문단\n';

describe('splitUnits', () => {
  it('단위를 이으면 항상 원문이 된다', () => {
    for (const s of [base, '', '---\na: 1\n---\n본문', '끝 공백  \n\n\n', '# a\r\n\r\nb\r\n']) {
      expect(splitUnits(s).join('')).toBe(s);
    }
  });
});

describe('merge3', () => {
  it('서로 다른 블록을 고치면 자동 병합한다', () => {
    const ours = base.replace('첫 문단', '첫 문단(앱에서 수정)');
    const theirs = base.replace('셋째 문단', '셋째 문단(외부에서 수정)');
    const r = merge3(base, ours, theirs);
    expect(r.clean).toBe(true);
    expect(r.text).toBe('# 제목\n\n첫 문단(앱에서 수정)\n\n둘째 문단\n\n셋째 문단(외부에서 수정)\n');
  });

  it('같은 블록을 서로 다르게 고치면 양쪽을 모두 남기고 표식을 붙인다', () => {
    const ours = base.replace('둘째 문단', '앱 버전');
    const theirs = base.replace('둘째 문단', '외부 버전');
    const r = merge3(base, ours, theirs);
    expect(r.clean).toBe(false);
    expect(r.conflicts).toBe(1);
    expect(r.text).toContain(CONFLICT_START);
    expect(r.text).toContain('앱 버전');
    expect(r.text).toContain(CONFLICT_MIDDLE);
    expect(r.text).toContain('외부 버전');
    expect(r.text).toContain(CONFLICT_END);
    expect(r.text).toContain('첫 문단');
    expect(r.text).toContain('셋째 문단');
  });

  it('양쪽이 똑같이 고치면 충돌이 아니다', () => {
    const both = base.replace('둘째 문단', '같은 수정');
    expect(merge3(base, both, both)).toEqual({ text: both, clean: true, conflicts: 0 });
  });

  it('한쪽만 바뀌면 그대로 채택한다', () => {
    const edited = base + '\n추가 문단\n';
    expect(merge3(base, edited, base).text).toBe(edited);
    expect(merge3(base, base, edited).text).toBe(edited);
  });

  it('한쪽은 삭제, 다른 쪽은 다른 블록 수정이면 병합된다', () => {
    const ours = base.replace('\n첫 문단\n', '');
    const theirs = base.replace('셋째 문단', '셋째 수정');
    const r = merge3(base, ours, theirs);
    expect(r.clean).toBe(true);
    expect(r.text).not.toContain('첫 문단');
    expect(r.text).toContain('셋째 수정');
  });

  it('이웃한 블록을 각각 고쳐도 자동 병합한다', () => {
    const ours = base.replace('첫 문단', '첫(앱)');
    const theirs = base.replace('둘째 문단', '둘째(외부)');
    const r = merge3(base, ours, theirs);
    expect(r.clean).toBe(true);
    expect(r.text).toBe('# 제목\n\n첫(앱)\n\n둘째(외부)\n\n셋째 문단\n');
  });
});
