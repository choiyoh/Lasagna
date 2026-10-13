import { describe, expect, it } from 'vitest';
import { dbEmbedSource, parseDbEmbed } from './embed.js';

describe('dbview 설정', () => {
  it('db·view·limit 을 읽는다', () => {
    expect(parseDbEmbed('db: 독서 목록\nview: 보드\nlimit: 20')).toEqual({ ok: true, config: { db: '독서 목록', view: '보드', limit: 20 } });
    expect(parseDbEmbed('db: 할일')).toEqual({ ok: true, config: { db: '할일' } });
  });
  it('잘못된 입력은 이유와 함께 거절한다', () => {
    expect(parseDbEmbed('')).toMatchObject({ ok: false });
    expect(parseDbEmbed('view: x')).toMatchObject({ ok: false, error: expect.stringContaining('db:') });
    expect(parseDbEmbed('a: [')).toMatchObject({ ok: false, error: expect.stringContaining('YAML') });
    expect(parseDbEmbed('- a')).toMatchObject({ ok: false });
  });
  it('limit 범위 정리', () => {
    expect(parseDbEmbed('db: a\nlimit: 99999')).toMatchObject({ config: { limit: 2000 } });
    expect(parseDbEmbed('db: a\nlimit: -3')).toEqual({ ok: true, config: { db: 'a' } });
  });
  it('dbEmbedSource 는 읽으면 같은 값이 되는 YAML 을 만든다', () => {
    for (const [db, view] of [['독서 목록', '보드'], ['a: b', 'x#y'], ['  앞뒤공백 ', undefined]] as const) {
      const r = parseDbEmbed(dbEmbedSource(db, view));
      expect(r).toEqual({ ok: true, config: { db: db.trim(), ...(view ? { view } : {}) } });
    }
  });
});
