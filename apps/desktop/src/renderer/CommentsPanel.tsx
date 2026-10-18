import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommentItem } from '@nopsidian/ipc-contract';
import { keys } from './keys';
import { SELECTION_REPLY, SELECTION_REQUEST } from './outline';

const when = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

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
      else setError('먼저 노트에서 인용할 글을 선택해 주세요');
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
          <button onClick={() => void mutate(() => window.nops.comment.resolve({ path, id: c.id, resolved: !c.resolved }))}>{c.resolved ? '다시 열기' : '해결'}</button>
          <button className="danger" onClick={() => void mutate(() => window.nops.comment.remove({ path, id: c.id }))} aria-label="댓글 삭제">
            삭제
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
            <button onClick={() => setQuote('')} aria-label="인용 빼기">
              ×
            </button>
          </blockquote>
        )}
        <textarea
          ref={box}
          value={text}
          rows={3}
          placeholder="댓글 남기기…"
          aria-label="댓글 내용"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="comments__bar">
          <button onClick={() => window.dispatchEvent(new CustomEvent(SELECTION_REQUEST, { detail: path }))} title="노트에서 선택한 글을 댓글에 붙여요">
            선택한 글 인용
          </button>
          <button className="primary" disabled={!text.trim()} onClick={() => void submit()} title={keys('⌘Enter')}>
            남기기
          </button>
        </div>
        {error && (
          <p className="warn small" role="alert">
            {error}
          </p>
        )}
      </div>
      {items.length === 0 ? (
        <p className="muted small pad">아직 댓글이 없어요. 메모·검토 의견·할 일을 남겨 보세요.</p>
      ) : (
        <ul>{open.map(row)}</ul>
      )}
      {done.length > 0 && (
        <details className="comments__done">
          <summary>해결된 댓글 {done.length}개</summary>
          <ul>{done.map(row)}</ul>
        </details>
      )}
    </div>
  );
}
