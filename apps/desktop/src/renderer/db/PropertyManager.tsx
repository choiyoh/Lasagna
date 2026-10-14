import { useEffect, useRef, useState } from 'react';
import { compileFormula, suggestAt, type SuggestResult } from '@nopsidian/formula';
import { ROLLUP_FNS } from '@nopsidian/core/db/rollup';
import type { Property } from '@nopsidian/core/db';
import { optionsOf } from '@nopsidian/core/db/values';
import type { DbData } from './types';

export const TYPE_LABEL: Record<string, string> = {
  text: '텍스트', number: '숫자', select: '선택', multi_select: '다중 선택', status: '상태', date: '날짜', checkbox: '체크박스',
  url: 'URL', email: '이메일', phone: '전화', files: '파일', created_time: '만든 시각', updated_time: '수정 시각', unique_id: '고유 ID',
  relation: '관계', rollup: '롤업', formula: '수식',
};
const CREATABLE = ['text', 'number', 'select', 'multi_select', 'status', 'date', 'checkbox', 'url', 'email', 'phone', 'files', 'created_time', 'updated_time', 'relation', 'rollup', 'formula'];
export const WITH_OPTIONS = new Set(['select', 'multi_select', 'status']);

const parseOptions = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean).map((name) => ({ name }));

/** 새 속성의 정의. 숫자는 `format`, 선택류는 옵션 목록을 채운다. */
export function makeDef(type: string, optionsText: string): Property {
  if (WITH_OPTIONS.has(type)) return { type, options: parseOptions(optionsText) } as Property;
  if (type === 'number') return { type: 'number', format: 'number' };
  if (type === 'relation') return { type: 'relation', target: '*', twoWay: false };
  if (type === 'rollup') return { type: 'rollup', relation: '', property: 'title', fn: 'count' };
  if (type === 'formula') return { type: 'formula', expr: '' };
  return { type } as Property;
}

const ROLLUP_LABEL: Record<string, string> = {
  show_original: '원본 보기', count: '개수', count_values: '값 개수', count_unique: '고유 값 개수', count_empty: '빈 값 수', percent_empty: '빈 값 비율',
  percent_not_empty: '채워진 비율', sum: '합계', avg: '평균', median: '중앙값', min: '최소', max: '최대', range: '범위', earliest: '가장 이른 날짜',
  latest: '가장 늦은 날짜', date_range: '날짜 범위', checked: '체크된 수', unchecked: '체크 안 된 수', percent_checked: '체크된 비율', percent_unchecked: '체크 안 된 비율',
};

/** 관계·롤업·수식 속성의 세부 설정 */
function Details({ name, def, data, dbs, onApply }: { name: string; def: Property; data: DbData; dbs: { folder: string; title: string }[]; onApply: (d: Property) => void }) {
  const [draft, setDraft] = useState<Property>(def);
  const [sug, setSug] = useState<SuggestResult | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(def), [def]);
  if (draft.type === 'formula') {
    const refresh = (text: string, caret: number) => setSug(suggestAt(text, caret, Object.keys(data.schema.properties).filter((p) => p !== name)));
    const accept = (item: { insert: string }) => {
      if (!sug) return;
      const next = draft.expr.slice(0, sug.from) + item.insert + draft.expr.slice(sug.to);
      setDraft({ ...draft, expr: next });
      setSug(null);
      const pos = sug.from + item.insert.length;
      requestAnimationFrame(() => {
        taRef.current?.focus();
        taRef.current?.setSelectionRange(pos, pos);
      });
    };
    const r = draft.expr.trim() ? compileFormula(draft.expr) : null;
    const err = r && !r.ok ? r.error : null;
    return (
      <div className="dbprops__details">
        <textarea
          aria-label={`${name} 수식`}
          rows={3}
          value={draft.expr}
          placeholder='예: prop("평점") * 20'
          ref={taRef}
          onChange={(e) => {
            setDraft({ ...draft, expr: e.target.value });
            refresh(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={(e) => {
            if (sug && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey))) {
              e.preventDefault();
              accept(sug.items[0]!);
            } else if (e.key === 'Escape' && sug) {
              e.stopPropagation();
              setSug(null);
            }
          }}
          onBlur={() => setTimeout(() => setSug(null), 150)}
          spellCheck={false}
        />
        {sug && (
          <ul className="fsuggest" role="listbox" aria-label="수식 자동 완성">
            {sug.items.map((it) => (
              <li key={`${it.kind}:${it.label}`}>
                <button role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); accept(it); }}>
                  <strong>{it.label}</strong> <span className="muted small">{it.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {err ? (
          <p className="warn small" role="alert">
            ⚠ {err.message}
            <br />
            <code>{draft.expr.slice(0, err.pos)}<mark>{draft.expr.slice(err.pos, Math.max(err.end, err.pos + 1)) || ' '}</mark>{draft.expr.slice(Math.max(err.end, err.pos + 1))}</code>
          </p>
        ) : (
          <p className="muted small">{r && r.ok && r.compiled.deps.length ? `쓰는 속성: ${r.compiled.deps.join(', ')}` : '속성은 prop("이름")으로 읽어요. 함수: if, round, concat, dateAdd, map …'}</p>
        )}
        <button className="primary" disabled={!!err || !draft.expr.trim() || draft.expr === (def.type === 'formula' ? def.expr : '')} onClick={() => onApply(draft)}>수식 적용</button>
      </div>
    );
  }
  if (draft.type === 'rollup') {
    const rels = Object.entries(data.schema.properties).filter(([, p]) => p.type === 'relation').map(([n]) => n);
    return (
      <div className="dbprops__details">
        <label className="small">관계 <select value={draft.relation} onChange={(e) => setDraft({ ...draft, relation: e.target.value })} aria-label={`${name} 관계`}>
          <option value="" />
          {rels.map((r) => <option key={r}>{r}</option>)}
        </select></label>
        <label className="small">대상 속성 <input value={draft.property} onChange={(e) => setDraft({ ...draft, property: e.target.value })} aria-label={`${name} 대상 속성`} placeholder="title 또는 속성 이름" /></label>
        <label className="small">집계 <select value={draft.fn} onChange={(e) => setDraft({ ...draft, fn: e.target.value })} aria-label={`${name} 집계`}>
          {ROLLUP_FNS.map((f) => <option key={f} value={f}>{ROLLUP_LABEL[f] ?? f}</option>)}
        </select></label>
        <button className="primary" disabled={!draft.relation || !draft.property.trim()} onClick={() => onApply({ ...draft, property: draft.property.trim() })}>적용</button>
      </div>
    );
  }
  if (draft.type === 'relation') {
    return (
      <div className="dbprops__details">
        <label className="small">대상 <select value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} aria-label={`${name} 대상`}>
          <option value="*">모든 노트</option>
          {dbs.map((d) => <option key={d.folder} value={d.folder}>{d.title}</option>)}
        </select></label>
        <label className="small"><input type="checkbox" checked={draft.twoWay} onChange={(e) => setDraft({ ...draft, twoWay: e.target.checked })} /> 양방향(반대쪽 노트에도 기록)</label>
        {draft.twoWay && <label className="small">반대쪽 속성 <input value={draft.reverse ?? ''} onChange={(e) => setDraft({ ...draft, reverse: e.target.value })} aria-label={`${name} 반대쪽 속성`} placeholder="대상 노트의 관계 속성 이름" /></label>}
        <button className="primary" disabled={draft.twoWay && !draft.reverse?.trim()} onClick={() => onApply({ ...draft, reverse: draft.twoWay ? draft.reverse?.trim() : undefined })}>적용</button>
      </div>
    );
  }
  return null;
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
  const [detail, setDetail] = useState<string | null>(null);
  const [dbs, setDbs] = useState<{ folder: string; title: string }[]>([]);
  useEffect(() => void window.nops.db.list().then((l) => setDbs(l.map((d) => ({ folder: d.folder, title: d.title })))).catch(() => undefined), []);
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
            {(p.type === 'relation' || p.type === 'rollup' || p.type === 'formula') && (
              <button onClick={() => setDetail(detail === n ? null : n)} aria-label={`${n} 설정`} aria-expanded={detail === n}>설정</button>
            )}
            <button onClick={() => onRemove(n)} aria-label={`${n} 삭제`} title="속성 삭제(노트의 값은 남아요)">×</button>
            {detail === n && <Details name={n} def={p} data={data} dbs={dbs} onApply={(d) => onSetProperty(n, d)} />}
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
            if (type === 'relation' || type === 'rollup' || type === 'formula') setDetail(name.trim());
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
