import { describe, expect, it, vi } from 'vitest';
import { notifySelfSave, saveWithSelfNotification, type SelfSaveSender } from './self-save';

const sender = () => {
  const send = vi.fn();
  return { sender: { send } as unknown as SelfSaveSender, send };
};

describe('자기 저장 알림', () => {
  it('저장 성공 뒤 origin 창에 external=false 를 한 번만 보낸다', () => {
    const { sender: s, send } = sender();
    let after = 0;
    const result = saveWithSelfNotification(() => 'saved', () => {
      after += 1;
      notifySelfSave(s, '노트.md');
    });
    expect(result).toBe('saved');
    expect(after).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('note.changed', { path: '노트.md', kind: 'change', external: false });
  });

  it('저장이 실패하면 알림을 보내지 않고 오류를 그대로 전달한다', () => {
    const { sender: s, send } = sender();
    expect(() =>
      saveWithSelfNotification(
        () => {
          throw new Error('disk full');
        },
        () => notifySelfSave(s, '노트.md'),
      ),
    ).toThrow('disk full');
    expect(send).not.toHaveBeenCalled();
  });
});
