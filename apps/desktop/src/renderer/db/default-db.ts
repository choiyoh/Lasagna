import { t } from '@nopsidian/i18n';
import type { Property, View } from '@nopsidian/core/db';

export interface DefaultDb {
  properties: [string, Property][];
  views: View[];
}

/** '/'→새 데이터베이스 프롬프트의 기본 이름(만드는 시점 언어, 저장되는 폴더 이름). */
export const defaultDbName = (): string => t('default.option.todo');

/**
 * 노션처럼 바로 쓸 수 있게 새 데이터베이스에 넣는 기본 속성·보기.
 * 이름은 **만드는 시점**의 앱 언어를 따르고, 저장된 뒤에는 바꾸지 않는다(기존 데이터 불변).
 */
export function defaultDb(): DefaultDb {
  const status = t('default.prop.status');
  const date = t('default.prop.date');
  return {
    properties: [
      [
        status,
        {
          type: 'select',
          options: [
            { name: t('default.option.todo'), color: 'gray' },
            { name: t('default.option.doing'), color: 'blue' },
            { name: t('default.option.done'), color: 'green' },
          ],
        },
      ],
      [date, { type: 'date' }],
      [t('default.prop.tags'), { type: 'multi_select', options: [] }],
    ],
    views: [
      { id: 'v1', name: t('db.view.table'), type: 'table', sort: [] },
      { id: 'v2', name: t('db.view.board'), type: 'board', groupBy: status, sort: [] },
      { id: 'v3', name: t('db.view.calendar'), type: 'calendar', dateProp: date, sort: [] },
    ],
  };
}
