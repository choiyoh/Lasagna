import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSync } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Indexer } from './indexer';

/** 병렬 스캔(`scanParallel`)이 한 스레드 스캔(`scan`)과 똑같은 인덱스를 만드는지 본다 */
let work: string;
let workerFile: string;

beforeAll(() => {
  work = mkdtempSync(path.join(tmpdir(), 'nops-par-'));
  // 앱 빌드와 같은 방식으로 파서 스레드 파일을 만든다
  workerFile = path.join(work, 'parse-worker.cjs');
  buildSync({ entryPoints: [path.join(__dirname, 'parse-worker.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: workerFile, logLevel: 'silent' });
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

function makeVault(n: number) {
  const root = mkdtempSync(path.join(work, 'v-'));
  for (let f = 0; f < 5; f++) mkdirSync(path.join(root, `폴더${f}`));
  for (let i = 0; i < n; i++) {
    writeFileSync(
      path.join(root, `폴더${i % 5}`, `노트${i}.md`),
      `---\ntags: [t${i % 3}]\naliases: [별칭${i}]\n---\n# 노트 ${i}\n\n본문 [[노트${(i + 1) % n}]] #인라인${i % 4} ^b${i}\n\n## 소제목${i}\n\n![[그림${i}.png]]\n`,
    );
  }
  writeFileSync(path.join(root, '깨짐.md'), '# 정상\n');
  return root;
}

const dump = (ix: Indexer) => {
  const q = (sql: string) => ix.db.prepare(sql).all();
  return {
    pages: q(`SELECT path, title, folder, size, hash, note_id, frontmatter, cover FROM pages ORDER BY path`),
    tags: q(`SELECT p.path AS p, t.tag, t.source FROM tags t JOIN pages p ON p.id=t.page_id ORDER BY p.path, t.tag, t.source`),
    headings: q(`SELECT p.path AS p, h.level, h.text, h.slug, h.line FROM headings h JOIN pages p ON p.id=h.page_id ORDER BY p.path, h.line`),
    blocks: q(`SELECT p.path AS p, b.id, b.type, b.ord, b.text, b.line_start FROM blocks b JOIN pages p ON p.id=b.page_id ORDER BY p.path, b.ord`),
    links: q(`SELECT s.path AS src, d.path AS dst, l.dst_raw, l.kind, l.line, l.src_block, l.is_resolved FROM links l JOIN pages s ON s.id=l.src_page LEFT JOIN pages d ON d.id=l.dst_page ORDER BY s.path, l.line, l.dst_raw`),
    aliases: q(`SELECT p.path AS p, a.alias FROM aliases a JOIN pages p ON p.id=a.page_id ORDER BY p.path`),
    fts: ix.search('노트 12', 50).map((h) => h.path).sort(),
  };
};

describe('scanParallel', () => {
  it('여러 스레드로 파싱해도 한 스레드 스캔과 같은 인덱스를 만든다', async () => {
    const root = makeVault(120);
    const a = new Indexer(root, ':memory:');
    a.scan();
    const rootB = root; // 같은 파일, 다른 인덱스
    const b = new Indexer(rootB, ':memory:');
    const progress: number[] = [];
    const r = await b.scanParallel((done) => progress.push(done), { workerFile, threads: 3, threshold: 1 });
    expect(r.changed).toBe(121);
    expect(dump(b)).toEqual(dump(a));
    expect(progress.at(-1)).toBe(121);
    expect(progress).toEqual([...progress].sort((x, y) => x - y)); // 진행률은 줄어들지 않는다
    a.close();
    b.close();
  });
  it('이미 색인된 파일은 건너뛰고(증분), 지워진 파일은 정리한다', async () => {
    const root = makeVault(60);
    const ix = new Indexer(root, ':memory:');
    await ix.scanParallel(undefined, { workerFile, threshold: 1 });
    writeFileSync(path.join(root, '폴더0', '새노트.md'), '# 새노트\n');
    rmSync(path.join(root, '폴더1', '노트1.md'));
    const r = await ix.scanParallel(undefined, { workerFile, threshold: 1 });
    expect(r).toMatchObject({ changed: 1, removed: 1, changedPaths: ['폴더0/새노트.md'], removedPaths: ['폴더1/노트1.md'] });
    expect(ix.list().length).toBe(61);
    ix.close();
  });
  it('파일이 적거나 파서 스레드 파일이 없으면 한 스레드로 처리한다', async () => {
    const root = makeVault(10);
    const ix = new Indexer(root, ':memory:');
    expect((await ix.scanParallel(undefined, { workerFile, threshold: 400 })).changed).toBe(11);
    const ix2 = new Indexer(root, ':memory:');
    expect((await ix2.scanParallel(undefined, { workerFile: path.join(work, '없음.cjs'), threshold: 1 })).changed).toBe(11);
    ix.close();
    ix2.close();
  });
});
