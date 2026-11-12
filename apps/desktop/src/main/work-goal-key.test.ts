import { describe, expect, it } from 'vitest';
import { workGoalKeyForRename } from './work-goal-key';

describe('작품 목표 키 이동 판정', () => {
  it('볼트 루트의 작품 폴더 이름 바꾸기만 옮긴다', () => {
    expect(workGoalKeyForRename('달빛', '달빛2')).toEqual({ from: '달빛', to: '달빛2' });
    expect(workGoalKeyForRename('Moon', '달빛')).toEqual({ from: 'Moon', to: '달빛' });
  });

  it('노트·하위 폴더·같은 이름은 옮기지 않는다', () => {
    expect(workGoalKeyForRename('달빛/회차', '달빛/원고')).toBeNull();
    expect(workGoalKeyForRename('달빛.md', '다른.md')).toBeNull();
    expect(workGoalKeyForRename('달빛', '달빛')).toBeNull();
    expect(workGoalKeyForRename('', '달빛')).toBeNull();
  });
});
