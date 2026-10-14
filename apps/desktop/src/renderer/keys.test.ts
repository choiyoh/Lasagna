import { describe, expect, it } from 'vitest';
import { keys } from './keys';

describe('keys', () => {
  it('맥은 그대로', () => expect(keys('노트 찾기 (⌘O)', true)).toBe('노트 찾기 (⌘O)'));
  it('윈도우는 Ctrl/Shift/Alt', () => {
    expect(keys('⌘O', false)).toBe('Ctrl+O');
    expect(keys('그래프 (⌘⇧G)', false)).toBe('그래프 (Ctrl+Shift+G)');
    expect(keys('⌘⌥D', false)).toBe('Ctrl+Alt+D');
    expect(keys('F2', false)).toBe('F2');
  });
});
