import { useState } from 'react';
import { t } from '@nopsidian/i18n';
import type { DbData } from './types';

interface Props {
  data: DbData;
  notes: { path: string; title: string }[];
  /** `_db.yaml` 에 쓴다 */
  onSave: (next: { templates: string[]; defaultTemplate: string | null }) => void;
}

/** 이 데이터베이스의 행 템플릿: 목록 관리와 기본 템플릿 지정. 템플릿은 보통 노트이고 `{{date}}` `{{title}}` 같은 변수를 쓴다. */
export function TemplateSettings({ data, notes, onSave }: Props) {
  const [q, setQ] = useState('');
  const templates = data.schema.templates;
  const def = data.schema.defaultTemplate ?? null;
  const hits = q.trim() ? notes.filter((n) => !templates.includes(n.path) && (n.title.toLowerCase().includes(q.trim().toLowerCase()) || n.path.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 8) : [];
  const titleOf = (p: string) => notes.find((n) => n.path === p)?.title ?? p;

  return (
    <div className="dbpop dbtemplates" role="dialog" aria-label={t('dbtemplate.title')}>
      <p className="muted small">{t('dbtemplate.hint')} {'{{date}} {{time}} {{title}}'}</p>
      {templates.length === 0 && <p className="muted small">{t('dbtemplate.none')}</p>}
      {templates.map((tpl) => (
        <div key={tpl} className="dbpop__row">
          <label className="small">
            <input type="radio" name="tpl-default" checked={def === tpl} onChange={() => onSave({ templates, defaultTemplate: tpl })} aria-label={t('dbtemplate.defaultAria', { title: titleOf(tpl) })} /> {titleOf(tpl)}
          </label>
          <span className="muted small">{tpl}</span>
          <button onClick={() => onSave({ templates: templates.filter((x) => x !== tpl), defaultTemplate: def === tpl ? null : def })} aria-label={t('dbtemplate.removeAria', { title: titleOf(tpl) })}>×</button>
        </div>
      ))}
      {def && <button onClick={() => onSave({ templates, defaultTemplate: null })}>{t('dbtemplate.clearDefault')}</button>}
      <input value={q} placeholder={t('dbtemplate.search')} onChange={(e) => setQ(e.target.value)} aria-label={t('dbtemplate.searchAria')} />
      {hits.map((n) => (
        <button
          key={n.path}
          className="dbtemplates__hit"
          onClick={() => {
            onSave({ templates: [...templates, n.path], defaultTemplate: def ?? n.path });
            setQ('');
          }}
        >
          + {n.title} <span className="muted small">{n.path}</span>
        </button>
      ))}
    </div>
  );
}
