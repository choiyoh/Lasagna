import { useState } from 'react';
import type { Property } from '@nopsidian/core/db';
import { optionsOf } from '@nopsidian/core/db/values';
import type { DbData } from './types';

const TYPE_LABEL: Record<string, string> = {
  text: '텍스트', number: '숫자', select: '선택', multi_select: '다중 선택', status: '상태', date: '날짜', checkbox: '체크박스',
  url: 'URL', email: '이메일', phone: '전화', files: '파일', created_time: '만든 시각', updated_time: '수정 시각', unique_id: '고유 ID',
  relation: '관계', rollup: '롤업', formula: '수식',
};
const CREATABLE = ['text', 'number', 'select', 'multi_select', 'status', 'date', 'checkbox', 'url', 'email', 'phone', 'files', 'created_time', 'updated_time'];
const WITH_OPTIONS = new Set(['select', 'multi_select', 'status']);

const parseOptions = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean).map((name) => ({ name }));

/** 새 속성의 정의. 숫자는 `format`, 선택류는 옵션 목록을 채운다. */
function makeDef(type: string, optionsText: string): Property {
  if (WITH_OPTIONS.has(type)) return { type, options: parseOptions(optionsText) } as Property;
  if (type === 'number') return { type: 'number', format: 'number' };
  return { type } as Property;
}

interface Props {
  data: DbData;
  onSetProperty: (name: string, def: Property) => void;
  onRemove: (name: string) => void;
  onRename: (from: string, to: string) => void;
}

/** 속성 관리: 추가·형식 변경·이름 변경·삭제. 모두 `_db.yaml` 에 바로 반영된다(이름 변경은 모든 행의 키도 바뀜). */
export function PropertyManager({ data, onSetProperty, onRemove, onRename }: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState('text');
  const [opts, setOpts] = useState('');
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const names = Object.keys(data.schema.properties);
  const taken = (n: string) => n === 'title' || names.includes(n);

  return (
    <div className="dbpop dbprops" role="dialog" aria-label="속성 관리">
      {names.map((n) => {
        const p = data.schema.properties[n]!;
        return (
          <div key={n} className="dbpop__row">
            {renaming?.from === n ? (
              <input
                autoFocus
                value={renaming.to}
                onChange={(e) => setRenaming({ from: n, to: e.target.value })}
                onBlur={() => {
                  const to = renaming.to.trim();
                  if (to && to !== n && !taken(to)) onRename(n, to);
                  setRenaming(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
                aria-label="새 이름"
              />
            ) : (
              <button className="dbprops__name" onClick={() => setRenaming({ from: n, to: n })} title="이름 바꾸기">
                {n}
              </button>
            )}
            <select
              value={p.type}
              onChange={(e) => {
                const keep = WITH_OPTIONS.has(e.target.value) ? optionsOf(p).map((o) => o.name).join(',') : '';
                onSetProperty(n, makeDef(e.target.value, keep));
              }}
              aria-label={`${n} 형식`}
              disabled={p.type === 'relation' || p.type === 'rollup' || p.type === 'formula'}
            >
              {[...new Set([...CREATABLE, p.type])].map((t) => (
                <option key={t} value={t}>{TYPE_LABEL[t] ?? t}</option>
              ))}
            </select>
            {WITH_OPTIONS.has(p.type) && (
              <input
                defaultValue={optionsOf(p).map((o) => o.name).join(', ')}
                placeholder="옵션(쉼표로 구분)"
                onBlur={(e) => {
                  const next = parseOptions(e.target.value);
                  const same = next.map((o) => o.name).join('\n') === optionsOf(p).map((o) => o.name).join('\n');
                  // 기존 옵션의 색·그룹은 이름이 같은 것끼리 유지한다
                  if (!same) onSetProperty(n, { ...p, options: next.map((o) => optionsOf(p).find((x) => x.name === o.name) ?? o) } as Property);
                }}
                aria-label={`${n} 옵션`}
              />
            )}
            <button onClick={() => onRemove(n)} aria-label={`${n} 삭제`} title="속성 삭제(노트의 값은 남아요)">×</button>
          </div>
        );
      })}
      <div className="dbpop__row dbprops__new">
        <input value={name} placeholder="새 속성 이름" onChange={(e) => setName(e.target.value)} aria-label="새 속성 이름" />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="새 속성 형식">
          {CREATABLE.map((t) => (
            <option key={t} value={t}>{TYPE_LABEL[t]}</option>
          ))}
        </select>
        {WITH_OPTIONS.has(type) && <input value={opts} placeholder="옵션(쉼표)" onChange={(e) => setOpts(e.target.value)} aria-label="새 속성 옵션" />}
        <button
          className="primary"
          disabled={!name.trim() || taken(name.trim())}
          onClick={() => {
            onSetProperty(name.trim(), makeDef(type, opts));
            setName('');
            setOpts('');
          }}
        >
          추가
        </button>
      </div>
      {name.trim() && taken(name.trim()) && <p className="muted small">이미 있거나 쓸 수 없는 이름이에요.</p>}
    </div>
  );
}
