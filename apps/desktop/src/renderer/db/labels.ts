import { t, type MessageKey } from '@nopsidian/i18n';
import type { DbGroupDto } from '@nopsidian/ipc-contract';

const TYPE_KEYS: Record<string, MessageKey> = {
  // CSV 가져오기에서 제목 열을 고를 때도 쓴다.
  title: 'db.title',
  text: 'prop.type.text',
  number: 'prop.type.number',
  select: 'prop.type.select',
  multi_select: 'prop.type.multiSelect',
  status: 'prop.type.status',
  date: 'prop.type.date',
  checkbox: 'prop.type.checkbox',
  url: 'prop.type.url',
  email: 'prop.type.email',
  phone: 'prop.type.phone',
  files: 'prop.type.files',
  created_time: 'prop.type.createdTime',
  updated_time: 'prop.type.updatedTime',
  unique_id: 'prop.type.uniqueId',
  relation: 'prop.type.relation',
  rollup: 'prop.type.rollup',
  formula: 'prop.type.formula',
};

/** 속성 형식 표시 이름. `property.type` 은 저장되는 값이라 바꾸지 않는다. */
export const typeLabel = (type: string): string => {
  const key = TYPE_KEYS[type];
  return key ? t(key) : type;
};

const VIEW_TYPE_KEYS: Record<string, MessageKey> = {
  table: 'db.view.table',
  board: 'db.view.board',
  list: 'db.view.list',
  gallery: 'db.view.gallery',
  calendar: 'db.view.calendar',
  timeline: 'db.view.timeline',
};

/** 보기 형태 표시 이름. `view.type` 값은 저장되는 키이므로 그대로 두고 라벨만 옮긴다. */
export const viewTypeLabel = (type: string): string => {
  const key = VIEW_TYPE_KEYS[type];
  return key ? t(key) : type;
};

const CALC_KEYS: Record<string, MessageKey> = {
  count: 'db.calc.count',
  count_values: 'db.calc.countValues',
  count_empty: 'db.calc.countEmpty',
  count_unique: 'db.calc.countUnique',
  sum: 'db.calc.sum',
  avg: 'db.calc.avg',
  min: 'db.calc.min',
  max: 'db.calc.max',
  checked: 'db.calc.checked',
  unchecked: 'db.calc.unchecked',
};

/** 계산 행 함수 이름. `view.calc` 값은 저장되는 키라 바꾸지 않는다. */
export const calcLabel = (fn: string): string => {
  const key = CALC_KEYS[fn];
  return key ? t(key) : fn;
};

/**
 * 그룹 라벨. 빈 값·체크 라벨은 worker 가 보낸 문구 대신 지금 언어로 그린다(언어 전환 즉시 반영).
 * 옵션 이름·날짜 같은 값 라벨은 그대로 쓴다.
 */
export const groupLabel = (g: Pick<DbGroupDto, 'label' | 'labelKey'>): string =>
  g.labelKey === 'empty' ? t('db.groupEmpty') : g.labelKey === 'checked' ? t('db.checked') : g.labelKey === 'unchecked' ? t('db.unchecked') : g.label;
