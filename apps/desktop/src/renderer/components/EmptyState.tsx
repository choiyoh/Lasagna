import { t, tPlural } from '@nopsidian/i18n';
export interface EmptyStateSuggestion {
  label: string;
  count: number;
  onApply: () => void;
}

interface Props {
  title: string;
  description?: string;
  /** 필터 조건처럼 제목/설명 아래에 작게 붙는 보조 문구 */
  detail?: string;
  suggestions?: EmptyStateSuggestion[];
  onReset?: () => void;
  resetLabel?: string;
}

/** 빈 결과 화면의 공통 골격. 아이콘·카드 배경·그림자 없이 여백과 타이포만 쓴다. */
export function EmptyState({ title, description, detail, suggestions = [], onReset, resetLabel }: Props) {
  return (
    <div className="emptystate" role="status">
      <strong className="emptystate__title">{title}</strong>
      {description && <p className="emptystate__description">{description}</p>}
      {detail && <p className="emptystate__detail">{detail}</p>}
      {suggestions.length > 0 && (
        <ul className="emptystate__suggestions">
          {suggestions.map((s, i) => (
            <li key={`${s.label}-${i}`}>
              <button
                className="emptystate__suggestion"
                onClick={s.onApply}
                aria-label={t('empty.suggestionAria', { label: s.label, count: s.count })}
              >
                <span className="emptystate__suggestion-icon" aria-hidden>−</span>
                <span className="emptystate__suggestion-label">{t('empty.suggestionRemove', { label: s.label })}</span>{' '}
                <span className="emptystate__suggestion-count">{tPlural('common.items', s.count)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {onReset && resetLabel && (
        <button className="emptystate__reset" onClick={onReset}>
          {resetLabel}
        </button>
      )}
    </div>
  );
}
