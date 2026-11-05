import { useEffect, useRef, useState } from 'react';
import { compileFormula, suggestAt, type SuggestResult } from '@nopsidian/formula';
import { ROLLUP_FNS } from '@nopsidian/core/db/rollup';
import { t, type MessageKey } from '@nopsidian/i18n';
import type { Property } from '@nopsidian/core/db';
import { optionsOf } from '@nopsidian/core/db/values';
import { typeLabel } from './labels';
import type { DbData } from './types';

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

const ROLLUP_KEYS: Record<string, MessageKey> = {
  show_original: 'prop.rollup.showOriginal', count: 'prop.rollup.count', count_values: 'prop.rollup.countValues',
  count_unique: 'prop.rollup.countUnique', count_empty: 'prop.rollup.countEmpty', percent_empty: 'prop.rollup.percentEmpty',
  percent_not_empty: 'prop.rollup.percentNotEmpty', sum: 'prop.rollup.sum', avg: 'prop.rollup.avg', median: 'prop.rollup.median',
  min: 'prop.rollup.min', max: 'prop.rollup.max', range: 'prop.rollup.range', earliest: 'prop.rollup.earliest',
  latest: 'prop.rollup.latest', date_range: 'prop.rollup.dateRange', checked: 'prop.rollup.checked', unchecked: 'prop.rollup.unchecked',
  percent_checked: 'prop.rollup.percentChecked', percent_unchecked: 'prop.rollup.percentUnchecked',
};
const rollupLabel = (fn: string): string => {
  const key = ROLLUP_KEYS[fn];
  return key ? t(key) : fn;
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
          aria-label={t('prop.formulaAria', { name })}
          rows={3}
          value={draft.expr}
          placeholder={t('prop.formulaPlaceholder')}
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
          <ul className="fsuggest" role="listbox" aria-label={t('prop.autocomplete')}>
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
          <p className="muted small">{r && r.ok && r.compiled.deps.length ? t('prop.deps', { list: r.compiled.deps.join(', ') }) : t('prop.formulaHint')}</p>
        )}
        <button className="primary" disabled={!!err || !draft.expr.trim() || draft.expr === (def.type === 'formula' ? def.expr : '')} onClick={() => onApply(draft)}>{t('prop.applyFormula')}</button>
      </div>
    );
  }
  if (draft.type === 'rollup') {
    const rels = Object.entries(data.schema.properties).filter(([, p]) => p.type === 'relation').map(([n]) => n);
    return (
      <div className="dbprops__details">
        <label className="small">{t('prop.relation')} <select value={draft.relation} onChange={(e) => setDraft({ ...draft, relation: e.target.value })} aria-label={t('prop.relationAria', { name })}>
          <option value="" />
          {rels.map((r) => <option key={r}>{r}</option>)}
        </select></label>
        <label className="small">{t('prop.targetProp')} <input value={draft.property} onChange={(e) => setDraft({ ...draft, property: e.target.value })} aria-label={t('prop.targetPropAria', { name })} placeholder={t('prop.targetPropPlaceholder')} /></label>
        <label className="small">{t('prop.aggregate')} <select value={draft.fn} onChange={(e) => setDraft({ ...draft, fn: e.target.value })} aria-label={t('prop.aggregateAria', { name })}>
          {ROLLUP_FNS.map((f) => <option key={f} value={f}>{rollupLabel(f)}</option>)}
        </select></label>
        <button className="primary" disabled={!draft.relation || !draft.property.trim()} onClick={() => onApply({ ...draft, property: draft.property.trim() })}>{t('prop.apply')}</button>
      </div>
    );
  }
  if (draft.type === 'relation') {
    return (
      <div className="dbprops__details">
        <label className="small">{t('prop.target')} <select value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} aria-label={t('prop.targetAria', { name })}>
          <option value="*">{t('prop.allNotes')}</option>
          {dbs.map((d) => <option key={d.folder} value={d.folder}>{d.title}</option>)}
        </select></label>
        <label className="small"><input type="checkbox" checked={draft.twoWay} onChange={(e) => setDraft({ ...draft, twoWay: e.target.checked })} /> {t('prop.twoWay')}</label>
        {draft.twoWay && <label className="small">{t('prop.reverse')} <input value={draft.reverse ?? ''} onChange={(e) => setDraft({ ...draft, reverse: e.target.value })} aria-label={t('prop.reverseAria', { name })} placeholder={t('prop.reversePlaceholder')} /></label>}
        <button className="primary" disabled={draft.twoWay && !draft.reverse?.trim()} onClick={() => onApply({ ...draft, reverse: draft.twoWay ? draft.reverse?.trim() : undefined })}>{t('prop.apply')}</button>
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
  onClose: () => void;
}

/** 속성 관리: 추가·형식 변경·이름 변경·삭제. 모두 `_db.yaml` 에 바로 반영된다(이름 변경은 모든 행의 키도 바뀜). */
export function PropertyManager({ data, onSetProperty, onRemove, onRename, onClose }: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState('text');
  const [opts, setOpts] = useState('');
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [dbs, setDbs] = useState<{ folder: string; title: string }[]>([]);
  useEffect(() => void window.nops.db.list().then((l) => setDbs(l.map((d) => ({ folder: d.folder, title: d.title })))).catch(() => undefined), []);
  // 데이터가 다시 불러와도 리스너를 다시 달지 않는다(직후 Esc 가 유실되지 않게).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const names = Object.keys(data.schema.properties);
  const taken = (n: string) => n === 'title' || names.includes(n);

  return (
    <div className="dbpop dbprops" role="dialog" aria-label={t('prop.manager')}>
      <header className="dbprops__head">
        <strong className="dbprops__title">{t('prop.count', { count: names.length })}</strong>
        <button className="dbprops__x" onClick={onClose} aria-label={t('prop.close')} title={t('db.close')}>
          ×
        </button>
      </header>
      <div className="dbprops__cols" aria-hidden="true">
        <span>{t('prop.name')}</span>
        <span>{t('prop.type')}</span>
        <span>{t('prop.options')}</span>
        <span />
      </div>
      <div className="dbprops__list">
        {names.map((n) => {
          const p = data.schema.properties[n]!;
          return (
            <div key={n} className="dbprops__row">
              <div className="dbprops__cell dbprops__cell--name">
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
                    aria-label={t('prop.newName')}
                  />
                ) : (
                  <button className="dbprops__name" onClick={() => setRenaming({ from: n, to: n })} title={t('prop.rename')}>
                    {n}
                  </button>
                )}
              </div>
              <div className="dbprops__cell dbprops__cell--type">
                <select
                  value={p.type}
                  onChange={(e) => {
                    const keep = WITH_OPTIONS.has(e.target.value) ? optionsOf(p).map((o) => o.name).join(',') : '';
                    onSetProperty(n, makeDef(e.target.value, keep));
                  }}
                  aria-label={t('prop.typeAria', { name: n })}
                  disabled={p.type === 'relation' || p.type === 'rollup' || p.type === 'formula'}
                >
                  {[...new Set([...CREATABLE, p.type])].map((type) => (
                    <option key={type} value={type}>{typeLabel(type)}</option>
                  ))}
                </select>
              </div>
              <div className="dbprops__cell dbprops__cell--opts">
                {WITH_OPTIONS.has(p.type) && (
                  <input
                    defaultValue={optionsOf(p).map((o) => o.name).join(', ')}
                    placeholder={t('prop.optionsPlaceholder')}
                    onBlur={(e) => {
                      const next = parseOptions(e.target.value);
                      const same = next.map((o) => o.name).join('\n') === optionsOf(p).map((o) => o.name).join('\n');
                      // 기존 옵션의 색·그룹은 이름이 같은 것끼리 유지한다
                      if (!same) onSetProperty(n, { ...p, options: next.map((o) => optionsOf(p).find((x) => x.name === o.name) ?? o) } as Property);
                    }}
                    aria-label={t('prop.optionsAria', { name: n })}
                  />
                )}
                {(p.type === 'relation' || p.type === 'rollup' || p.type === 'formula') && (
                  <button onClick={() => setDetail(detail === n ? null : n)} aria-label={t('prop.settingsAria', { name: n })} aria-expanded={detail === n}>{t('prop.settings')}</button>
                )}
              </div>
              <div className="dbprops__cell dbprops__cell--end">
                <button onClick={() => onRemove(n)} aria-label={t('prop.removeAria', { name: n })} title={t('prop.removeTitle')}>×</button>
              </div>
              {detail === n && <Details name={n} def={p} data={data} dbs={dbs} onApply={(d) => onSetProperty(n, d)} />}
            </div>
          );
        })}
      </div>
      <div className="dbpop__row dbprops__new">
        <input value={name} placeholder={t('prop.newNamePlaceholder')} onChange={(e) => setName(e.target.value)} aria-label={t('prop.newNamePlaceholder')} />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label={t('prop.newTypeAria')}>
          {CREATABLE.map((type) => (
            <option key={type} value={type}>{typeLabel(type)}</option>
          ))}
        </select>
        {WITH_OPTIONS.has(type) && <input value={opts} placeholder={t('prop.newOptionsPlaceholder')} onChange={(e) => setOpts(e.target.value)} aria-label={t('prop.newOptionsAria')} />}
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
          {t('prop.add')}
        </button>
      </div>
      {name.trim() && taken(name.trim()) && <p className="muted small">{t('prop.taken')}</p>}
    </div>
  );
}
