import type { Hit, NoteRow } from './indexer';

export type WorkerRequest =
  | { id: string; method: 'list' }
  | { id: string; method: 'search'; params: { q: string; limit: number } }
  | { id: string; method: 'close' };

export type WorkerResponse =
  | { type: 'response'; id: string; result: NoteRow[] | Hit[] | null }
  | { type: 'response'; id: string; error: string }
  | { type: 'ready' }
  | { type: 'fatal'; error: string };

export type WorkerEvent =
  | { type: 'event'; name: 'note.changed'; payload: { path: string; kind: 'add' | 'change' | 'unlink'; hash?: string } }
  | { type: 'event'; name: 'index.progress'; payload: { done: number; total: number } };
