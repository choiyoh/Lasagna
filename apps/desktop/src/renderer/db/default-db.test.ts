import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import { defaultDb } from './default-db';

afterEach(() => setLocale('ko'));

describe('defaultDb', () => {
  it('한국어에서는 지금까지의 기본 이름 그대로', () => {
    setLocale('ko');
    const db = defaultDb();
    expect(db.properties.map(([name]) => name)).toEqual(['상태', '날짜', '태그']);
    expect(db.properties[0]![1]).toMatchObject({ options: [{ name: '할 일' }, { name: '진행 중' }, { name: '완료' }] });
    expect(db.views.map((v) => v.name)).toEqual(['표', '보드', '캘린더']);
    expect(db.views[1]).toMatchObject({ groupBy: '상태' });
    expect(db.views[2]).toMatchObject({ dateProp: '날짜' });
  });

  it('영어에서는 영어 기본 이름으로 만든다(참조도 같은 이름을 가리킨다)', () => {
    setLocale('en');
    const db = defaultDb();
    expect(db.properties.map(([name]) => name)).toEqual(['Status', 'Date', 'Tags']);
    expect(db.properties[0]![1]).toMatchObject({ options: [{ name: 'To do' }, { name: 'In progress' }, { name: 'Done' }] });
    expect(db.views.map((v) => v.name)).toEqual(['Table', 'Board', 'Calendar']);
    expect(db.views[1]).toMatchObject({ groupBy: 'Status' });
    expect(db.views[2]).toMatchObject({ dateProp: 'Date' });
  });
});
