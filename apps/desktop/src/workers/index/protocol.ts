
/** 워커가 대신 실행해 주는 인덱스 질의(읽기 전용) */
export type IndexQuery =
  | 'backlinkContexts'
  | 'outgoingLinks'
  | 'unlinkedMentions'
  | 'notesByTag'
  | 'tags'
  | 'headingsOf';

export type WorkerRequest =
  | { id: string; method: 'list' }
  | { id: string; method: 'assets' }
  | { id: string; method: 'query'; params: { name: IndexQuery; args: unknown[] } }
  | { id: string; method: 'search'; params: { q: string; limit: number } }
  | { id: string; method: 'close' };

export type WorkerResponse =
  | { type: 'response'; id: string; result: unknown }
  | { type: 'response'; id: string; error: string }
  | { type: 'ready' }
  | { type: 'fatal'; error: string };

export type WorkerEvent =
  | { type: 'event'; name: 'note.changed'; payload: { path: string; kind: 'add' | 'change' | 'unlink'; hash?: string } }
  | { type: 'event'; name: 'asset.changed'; payload: { path: string; kind: 'add' | 'change' | 'unlink' } }
  | { type: 'event'; name: 'index.progress'; payload: { done: number; total: number } };
