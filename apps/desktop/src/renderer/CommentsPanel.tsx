import { formatShortDateTime, t } from '@nopsidian/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommentItem } from '@nopsidian/ipc-contract';
import { keys } from './keys';
import { SELECTION_REPLY, SELECTION_REQUEST } from './outline';

const when = (iso: string) => formatShortDateTime(iso);

/** 오른쪽 패널의 댓글: 노트에 메모·리뷰를 남긴다(에이전트가 남긴 댓글도 여기에 보인다). 노트 본문은 건드리지 않는다. */
export function CommentsPanel({ path, onChanged }: { path: string; onChanged?: () => void }) {
  const [items, setItems] = useState<CommentItem[]>([]);
  const [text, setText] = useState('');
  const [quote, setQuote] = useState('');
  const [error, setError] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(() => void window.nops.comment.list({ path }).then(setItems), [path]);
  useEffect(() => {
    setItems([]);
    setText('');
    setQuote('');
    load();
    // 다른 기기·에이전트가 쓴 댓글이 동기화로 들어왔을 수 있으니 창에 돌아올 때 다시 읽는다
    window.addEventListener('focus', load);
    const onReply = (e: Event) => {
      const d = (e as CustomEvent<{ path: string; text: string }>).detail;
      if (d.path !== path) return;
      if (d.text.trim()) setQuote(d.text.trim().replace(/\s+/g, ' ').slice(0, 300));
      else setError(t('comments.quoteHint'));
    };
    window.addEventListener(SELECTION_REPLY, onReply);
    return () => {
      window.removeEventListener('focus', load);
      window.removeEventListener(SELECTION_REPLY, onReply);
    };
  }, [path, load]);

  const submit = async () => {
    if (!text.trim()) return;
    try {
      await window.nops.comment.add({ path, text: text.trim(), ...(quote ? { quote } : {}) });
      setText('');
      setQuote('');
      setError('');
      load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    }
  };
  const mutate = async (fn: () => Promise<unknown>) => {
    await fn();
    load();
    onChanged?.();
  };

  const open = items.filter((c) => !c.resolved);
  const done = items.filter((c) => c.resolved);
  const row = (c: CommentItem) => (
    <li key={c.id} className={c.resolved ? 'comment resolved' : 'comment'} data-testid="comment">
      <div className="comment__head">
        <strong>{c.author}</strong>
        <span className="muted small">{when(c.createdAt)}</span>
        <span className="comment__actions">
          <button onClick={() => void mutate(() => window.nops.comment.resolve({ path, id: c.id, resolved: !c.resolved }))}>{c.resolved ? t('comments.reopen') : t('comments.resolve')}</button>
          <button className="danger" onClick={() => void mutate(() => window.nops.comment.remove({ path, id: c.id }))} aria-label={t('comments.deleteAria')}>
            {t('comments.delete')}
          </button>
        </span>
      </div>
      {c.quote && <blockquote className="comment__quote">{c.quote}</blockquote>}
      <p className="comment__text">{c.text}</p>
    </li>
  );

  return (
    <div className="comments" data-testid="comments">
      <div className="comments__new">
        {quote && (
          <blockquote className="comment__quote">
            {quote}
            <button onClick={() => setQuote('')} aria-label={t('comments.dropQuote')}>
              ×
            </button>
          </blockquote>
        )}
        <textarea
          ref={box}
          value={text}
          rows={3}
          placeholder={t('comments.placeholder')}
          aria-label={t('comments.body')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="comments__bar">
          <button onClick={() => window.dispatchEvent(new CustomEvent(SELECTION_REQUEST, { detail: path }))} title={t('comments.quoteSelectedTitle')}>
            {t('comments.quoteSelected')}
          </button>
          <button className="primary" disabled={!text.trim()} onClick={() => void submit()} title={keys('⌘Enter')}>
            {t('comments.submit')}
          </button>
        </div>
        {error && (
          <p className="warn small" role="alert">
            {error}
          </p>
        )}
      </div>
      {items.length === 0 ? (
        <p className="muted small pad">{t('comments.empty')}</p>
      ) : (
        <ul>{open.map(row)}</ul>
      )}
      {done.length > 0 && (
        <details className="comments__done">
          <summary>{t('comments.resolved', { count: done.length })}</summary>
          <ul>{done.map(row)}</ul>
        </details>
      )}
    </div>
  );
}
