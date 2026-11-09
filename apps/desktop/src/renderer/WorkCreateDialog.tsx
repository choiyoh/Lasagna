import { useEffect, useState } from 'react';
import { t, translate } from '@nopsidian/i18n';
import { validateWorkName, workNames, workPlan, type WorkKind, type WorkLocale } from '@nopsidian/core';

interface Props {
  locale: WorkLocale;
  onCancel: () => void;
  onSubmit: (name: string, kind: WorkKind) => void;
}

/** 작품 만들기 대화상자 — 이름 + 구조(기본형/출판형) 선택. 카드에 실제 생성될 폴더를 미리 보여 준다. */
export function WorkCreateDialog({ locale, onCancel, onSubmit }: Props) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<WorkKind>('serial');
  const [error, setError] = useState<string | null>(null);
  const tr = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate(locale, key, params);

  // 어디에 초점이 있어도 Esc 로 닫는다(다른 대화상자와 같은 동작).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const submit = () => {
    const problem = validateWorkName(name);
    if (problem) {
      setError(tr(`work.err.${problem}` as Parameters<typeof translate>[1]));
      return;
    }
    setError(null);
    onSubmit(name, kind);
  };

  const names = workNames(locale);
  const serial = workPlan('work', locale, 'serial');
  const publish = workPlan('work', locale, 'publish');
  const previewFolders = (plan: NonNullable<typeof serial>) => plan.folders.slice(1).map((p) => p.split('/').pop() ?? p).join(' · ');
  const templates = `${names.characterSheet} · ${names.episode} · ${names.worldbuilding}`;

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog workdlg" role="dialog" aria-modal="true" aria-label={tr('work.dialog.title')} data-testid="work-dialog">
        <h2>{tr('work.dialog.title')}</h2>
        <label className="workdlg__field">
          <span>{tr('work.dialog.nameLabel')}</span>
          <input
            data-testid="work-dialog-name"
            className="workdlg__input"
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
              }
              if (e.key === 'Enter') submit();
            }}
            aria-invalid={error !== null}
          />
        </label>
        {error ? (
          <p className="error" role="alert" data-testid="work-dialog-error">
            {error}
          </p>
        ) : null}

        <div className="workdlg__structs" role="radiogroup" aria-label={tr('work.dialog.structure')}>
          {(['serial', 'publish'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={kind === option}
              className={`workstruct${kind === option ? ' on' : ''}`}
              data-testid={`work-structure-${option}`}
              onClick={() => setKind(option)}
            >
              <span className="workstruct__head">
                <span className="workstruct__dot" aria-hidden />
                {tr(`work.structure.${option}`)}
              </span>
              <span className="workstruct__desc">{tr(`work.structure.${option}.hint`)}</span>
              <span className="workstruct__preview">{previewFolders(option === 'serial' ? (serial as NonNullable<typeof serial>) : (publish as NonNullable<typeof publish>))}</span>
              <span className="workstruct__templates">{templates}</span>
              {option === 'publish' ? <span className="workstruct__example">{tr('work.dialog.example', { example: tr('work.dialog.exampleName') })}</span> : null}
            </button>
          ))}
        </div>

        <div className="dialog__actions">
          <button onClick={onCancel}>{t('common.cancel')}</button>
          <button className="primary" data-testid="work-dialog-create" onClick={submit}>
            {tr('work.dialog.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
