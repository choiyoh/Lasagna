import { useMemo, useState } from 'react';
import { formatNumber, t } from '@nopsidian/i18n';
import { compareEpisodePaths, type WorkSummary } from '@nopsidian/core';
import type { NoteSummary } from '@nopsidian/ipc-contract';
import { flushAll } from './flush';
import { userMessage } from './user-message';

type Format = 'docx' | 'txt';
type Separator = 'page' | 'blank' | 'rule';

interface Props {
  work: WorkSummary;
  notes: readonly NoteSummary[];
  locale: 'ko' | 'en';
  spacing: 'include' | 'exclude';
  onClose: () => void;
  /** 저장된 파일 경로 — 성공 토스트는 부모가 띄운다 */
  onSaved: (path: string) => void;
}

const safe = (text: string) => text.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();

/** 원고 합본 내보내기 — 범위·형식·옵션 3개만. 노트는 읽기만 한다(main 이 디스크에서 읽는다). */
export function MergeExportDialog({ work, notes, locale, spacing, onClose, onSaved }: Props) {
  const episodes = useMemo(() => {
    const titleOf = new Map(notes.map((note) => [note.path, note.title]));
    const base = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '');
    return work.episodeRows
      .filter((row) => row.path.startsWith(`${work.episodeFolder}/`))
      .slice()
      .sort((a, b) => compareEpisodePaths(a.path, b.path, locale))
      .map((row) => ({ ...row, title: titleOf.get(row.path) ?? base(row.path) }));
  }, [work, notes, locale]);

  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(Math.max(0, episodes.length - 1));
  const [format, setFormat] = useState<Format>('docx');
  const [includeTitles, setIncludeTitles] = useState(true);
  const [separator, setSeparator] = useState<Separator>('page');
  const [summary, setSummary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const chosen = episodes.slice(from, to + 1);
  const total = chosen.reduce((sum, row) => sum + (spacing === 'include' ? row.chars : row.charsNoSpace), 0);
  const unit = spacing === 'include' ? t('settings.writerSpacing.include') : t('settings.writerSpacing.exclude');
  const separatorHint = format === 'txt' ? t('merge.separatorHintTxt') : t('merge.separatorHint');
  const defaultName = `${safe(`${work.name}_${chosen[0]?.title ?? ''}~${chosen[chosen.length - 1]?.title ?? ''}`) || safe(work.name)}.${format}`;

  const pickFormat = (next: Format) => {
    setFormat(next);
    // .txt 에는 쪽 나눔이 없어 빈 줄로 자동 전환한다(시안).
    if (next === 'txt' && separator === 'page') setSeparator('blank');
  };

  const run = async () => {
    if (chosen.length === 0) {
      setError(t('merge.empty'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await flushAll(); // 미저장 편집이 있으면 먼저 저장한 뒤 디스크에서 읽는다
      const summaryText = summary
        ? t('merge.summaryLine', { work: work.name, episodes: formatNumber(chosen.length, locale), chars: formatNumber(total, locale) })
        : null;
      const result = await window.nops.export.merge({
        work: work.name,
        format,
        defaultName,
        summary: summaryText,
        includeTitles,
        separator,
        episodes: chosen.map((row) => ({ path: row.path, title: row.title })),
      });
      if (result.saved) onSaved(result.saved);
      else setBusy(false);
    } catch (e) {
      setError(t('merge.failed', { message: userMessage(e) }));
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog mergedlg" role="dialog" aria-modal="true" aria-label={t('merge.title')} data-testid="merge-dialog">
        <h2>{t('merge.title')}</h2>
        <p className="muted small mergedlg__sub">{work.name} — {t('merge.subtitle')}</p>

        <section className="mergedlg__section">
          <h3>{t('merge.range')}</h3>
          <div className="mergedlg__range">
            <select
              aria-label={t('merge.rangeStart')}
              data-testid="merge-start"
              value={from}
              onChange={(e) => setStart(Number(e.target.value))}
              disabled={busy}
            >
              {episodes.map((episode, i) => (
                <option key={episode.path} value={i}>{episode.title}</option>
              ))}
            </select>
            <span aria-hidden>~</span>
            <select
              aria-label={t('merge.rangeEnd')}
              data-testid="merge-end"
              value={to}
              onChange={(e) => setEnd(Number(e.target.value))}
              disabled={busy}
            >
              {episodes.map((episode, i) => (
                <option key={episode.path} value={i} disabled={i < from}>{episode.title}</option>
              ))}
            </select>
          </div>
          <p className="muted small" data-testid="merge-summary">
            {t('merge.selected', { episodes: formatNumber(chosen.length, locale) })} · {t('merge.total', { chars: formatNumber(total, locale), spacing: unit })}
          </p>
        </section>

        <section className="mergedlg__section">
          <h3>{t('merge.format')}</h3>
          <label className="mergedlg__radio">
            <input type="radio" name="merge-format" checked={format === 'docx'} onChange={() => pickFormat('docx')} disabled={busy} data-testid="merge-docx" />
            <span><b>{t('merge.docx')}</b><small className="muted">{t('merge.docxHint')}</small></span>
          </label>
          <label className="mergedlg__radio">
            <input type="radio" name="merge-format" checked={format === 'txt'} onChange={() => pickFormat('txt')} disabled={busy} data-testid="merge-txt" />
            <span><b>{t('merge.txt')}</b><small className="muted">{t('merge.txtHint')}</small></span>
          </label>
        </section>

        <section className="mergedlg__section">
          <label className="mergedlg__check">
            <input type="checkbox" checked={includeTitles} onChange={(e) => setIncludeTitles(e.target.checked)} disabled={busy} data-testid="merge-titles" />
            <span>{t('merge.includeTitles')}<small className="muted">{t('merge.includeTitlesHint')}</small></span>
          </label>
          <div className="mergedlg__sep">
            <span>{t('merge.separator')}<small className="muted">{separatorHint}</small></span>
            <div className="seg" role="radiogroup" aria-label={t('merge.separator')}>
              {(['page', 'blank', 'rule'] as const).map((option) => (
                <button
                  key={option}
                  role="radio"
                  aria-checked={separator === option}
                  className={separator === option ? 'on' : ''}
                  disabled={busy || (format === 'txt' && option === 'page')}
                  data-testid={`merge-sep-${option}`}
                  onClick={() => setSeparator(option)}
                >
                  {t(`merge.sep.${option}`)}
                </button>
              ))}
            </div>
          </div>
          <label className="mergedlg__check">
            <input type="checkbox" checked={summary} onChange={(e) => setSummary(e.target.checked)} disabled={busy} data-testid="merge-summary-toggle" />
            <span>{t('merge.summaryToggle')}<small className="muted">{t('merge.summaryHint')}</small></span>
          </label>
        </section>

        <p className="muted small">{t('merge.help')}</p>
        {error && <p className="error small" role="alert" data-testid="merge-error">{error}</p>}
        <div className="dialog__actions">
          <button onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button className="primary" onClick={() => void run()} disabled={busy || chosen.length === 0} data-testid="merge-export">
            {busy ? t('merge.exporting') : error ? t('merge.retry') : t('merge.choose')}
          </button>
        </div>
      </div>
    </div>
  );
}
