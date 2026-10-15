import { parentPort } from 'node:worker_threads';
import { buildIndexRecord, type IndexRecord } from './index-record';

/** 색인 스레드가 맡긴 파일들을 읽고 파싱해 레코드로 돌려준다(SQLite 는 건드리지 않는다). */
export interface ParseRequest {
  id: number;
  root: string;
  rels: string[];
}
export interface ParseResponse {
  id: number;
  records: (IndexRecord | null)[];
}

parentPort!.on('message', (req: ParseRequest) => {
  const records = req.rels.map((rel) => {
    try {
      return buildIndexRecord(req.root, rel);
    } catch {
      return null; // 파서가 던지는 파일은 건너뛴다(색인 스레드가 지운 것으로 처리)
    }
  });
  parentPort!.postMessage({ id: req.id, records } satisfies ParseResponse);
});
