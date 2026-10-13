import { useState } from 'react';
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
    <div className="dbpop dbtemplates" role="dialog" aria-label="템플릿">
      <p className="muted small">새 행을 만들 때 본문과 기본 속성으로 쓸 노트예요. 변수: {'{{date}} {{time}} {{title}}'}</p>
      {templates.length === 0 && <p className="muted small">등록된 템플릿이 없어요.</p>}
      {templates.map((t) => (
        <div key={t} className="dbpop__row">
          <label className="small">
            <input type="radio" name="tpl-default" checked={def === t} onChange={() => onSave({ templates, defaultTemplate: t })} aria-label={`${titleOf(t)} 기본 템플릿`} /> {titleOf(t)}
          </label>
          <span className="muted small">{t}</span>
          <button onClick={() => onSave({ templates: templates.filter((x) => x !== t), defaultTemplate: def === t ? null : def })} aria-label={`${titleOf(t)} 제거`}>×</button>
        </div>
      ))}
      {def && <button onClick={() => onSave({ templates, defaultTemplate: null })}>기본 템플릿 해제</button>}
      <input value={q} placeholder="템플릿으로 쓸 노트 검색…" onChange={(e) => setQ(e.target.value)} aria-label="템플릿 노트 검색" />
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
