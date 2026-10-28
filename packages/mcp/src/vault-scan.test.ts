import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VaultScanner } from './vault-scan.js';

const vaults: string[] = [];

/** 임시 볼트 폴더를 만들고 파일을 심는다. */
function makeVault(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'nopsidian-vault-'));
  vaults.push(root);
  for (const [rel, content] of Object.entries(files)) writeVaultFile(root, rel, content);
  return root;
}

function writeVaultFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/** 정수 초로 고정한 mtime — 파일시스템 해상도와 무관하게 증분 판정을 재현한다. */
const FIXED_MTIME = 1_700_000_000;
function setMtime(abs: string, seconds: number): void {
  utimesSync(abs, seconds, seconds);
}

afterEach(() => {
  for (const root of vaults) rmSync(root, { recursive: true, force: true });
  vaults.length = 0;
});

describe('VaultScanner 스캔·메타', () => {
  it('제목은 프런트매터 title → 첫 H1 → 파일명 순으로 고른다', () => {
    const root = makeVault({
      'fm.md': '---\ntitle: 프런트매터 제목\n---\n# H1 제목\n본문\n',
      'h1.md': '본문\n\n# H1 제목\n',
      'plain.md': '제목 없는 본문\n',
    });
    const scanner = new VaultScanner(root);
    scanner.refresh();

    expect(scanner.get('fm.md')?.title).toBe('프런트매터 제목');
    expect(scanner.get('h1.md')?.title).toBe('H1 제목');
    expect(scanner.get('plain.md')?.title).toBe('plain');
  });

  it('별칭·태그·제목들·프런트매터 속성을 뽑는다', () => {
    const root = makeVault({
      'a.md': [
        '---',
        'title: 알파',
        'aliases: [에이, A]',
        'tags:',
        '  - 태그1',
        "  - '#태그2'",
        '상태: 진행중',
        '---',
        '# 첫 제목',
        '## 둘째 제목',
        '본문 #태그2 그리고 #태그3',
        '',
      ].join('\n'),
    });
    const scanner = new VaultScanner(root);
    scanner.refresh();
    const note = scanner.get('a.md')!;

    expect(note.aliases).toEqual(['에이', 'A']);
    // 프런트매터+본문 태그를 합치고, '#' 없이, 중복 없이(파싱 순서에 기대지 않게 집합으로 확인)
    expect([...note.tags].sort()).toEqual(['태그1', '태그2', '태그3']);
    expect(new Set(note.tags).size).toBe(note.tags.length);
    expect(note.headings.map((h) => [h.level, h.text])).toEqual([
      [1, '첫 제목'],
      [2, '둘째 제목'],
    ]);
    expect(note.headings[0]?.line).toBe(9);
    expect(note.properties['상태']).toBe('진행중');
    expect(note.properties['title']).toBe('알파');
  });

  it('점 폴더·node_modules·비마크다운·심볼릭 링크는 훑지 않는다', () => {
    const root = makeVault({
      'a.md': 'a\n',
      '읽기.txt': 'text\n',
      '.hidden.md': 'hidden\n',
      '.obsidian/inner.md': 'inner\n',
      'node_modules/pkg.md': 'pkg\n',
      'sub/node_modules/deep.md': 'deep\n',
      'sub/ok.md': 'ok\n',
      'target.md': 'target\n',
    });
    symlinkSync(path.join(root, 'target.md'), path.join(root, 'link.md'));
    symlinkSync(path.join(root, 'sub'), path.join(root, 'linkdir'));

    const scanner = new VaultScanner(root);
    scanner.refresh();

    expect(scanner.list().map((n) => n.path)).toEqual(['a.md', 'sub/ok.md', 'target.md']);
    expect(scanner.get('link.md')).toBeUndefined();
    expect(scanner.get('linkdir/ok.md')).toBeUndefined();
  });

  it('볼트 상대 경로는 NFC 로 저장하고 NFC·NFD 어느 쪽으로 조회해도 찾는다', () => {
    const nfd = `${'카페'.normalize('NFD')}.md`;
    const root = makeVault({ [nfd]: '# 카페\n' });
    const scanner = new VaultScanner(root);
    scanner.refresh();

    expect(scanner.list().map((n) => n.path)).toEqual(['카페.md']);
    expect(scanner.get('카페.md')?.title).toBe('카페');
    expect(scanner.get(`${'카페'.normalize('NFD')}.md`)?.title).toBe('카페');
  });

  it('볼트 폴더가 없으면 조용히 빈 결과를 돌려주고 폴더를 만들지 않는다', () => {
    const missing = path.join(tmpdir(), `nopsidian-없는-볼트-${process.pid}-${Math.random().toString(36).slice(2)}`);
    const scanner = new VaultScanner(missing);
    scanner.refresh();
    expect(scanner.list()).toEqual([]);
    expect(scanner.get('a.md')).toBeUndefined();
    expect(scanner.search('아무거나')).toEqual([]);
    expect(existsSync(missing)).toBe(false);
  });
});

describe('링크 해석', () => {
  it('경로·파일명·별칭으로 해석하고 못 찾으면 null, 종류·제목·블록 조각을 보존한다', () => {
    const root = makeVault({
      'note-a.md': [
        '---',
        "related: '[[note-b]]'",
        '---',
        '[[note-b]] 그리고 [[없는노트]]',
        '![[note-b#제목]]',
        '[md](note-b.md#제목)',
        '[[별칭노트]]',
        '[[note-b#^블록]]',
        '',
      ].join('\n'),
      'note-b.md': '# 제목\n내용\n',
      '프로젝트/Nopsidian.md': '---\naliases: [별칭노트]\n---\n본문\n',
    });
    const scanner = new VaultScanner(root);
    scanner.refresh();

    const links = scanner.get('note-a.md')!.links;
    const find = (target: string, kind: string) => links.find((l) => l.target === target && l.kind === kind);

    expect(find('note-b', 'wikilink')?.resolved).toBe('note-b.md');
    expect(find('없는노트', 'wikilink')?.resolved).toBeNull();
    expect(find('note-b', 'relation')?.resolved).toBe('note-b.md');
    expect(find('note-b', 'relation')?.line).toBe(1);

    const embed = find('note-b', 'embed');
    expect(embed?.resolved).toBe('note-b.md');
    expect(embed?.heading).toBe('제목');
    expect(embed?.block).toBeUndefined();

    const md = find('note-b.md', 'md');
    expect(md?.resolved).toBe('note-b.md');
    expect(md?.heading).toBe('제목');

    // 별칭으로 해석(다른 폴더의 노트)
    expect(find('별칭노트', 'wikilink')?.resolved).toBe('프로젝트/Nopsidian.md');

    // 블록 조각(`#^id`)은 block 에 담긴다
    const block = links.find((l) => l.target === 'note-b' && l.block === '블록');
    expect(block?.kind).toBe('wikilink');
    expect(block?.resolved).toBe('note-b.md');
  });

  it('refresh 로 노트가 늘거나 줄면 링크 해석을 다시 계산한다', () => {
    const root = makeVault({ 'a.md': '[[b]]\n' });
    const scanner = new VaultScanner(root);
    scanner.refresh();
    expect(scanner.get('a.md')?.links[0]?.resolved).toBeNull();

    writeVaultFile(root, 'b.md', '# 비\n');
    scanner.refresh();
    expect(scanner.get('a.md')?.links[0]?.resolved).toBe('b.md');
    expect(scanner.backlinks('b.md').map((h) => h.path)).toEqual(['a.md']);

    rmSync(path.join(root, 'b.md'));
    scanner.refresh();
    expect(scanner.get('a.md')?.links[0]?.resolved).toBeNull();
    expect(scanner.backlinks('b.md')).toEqual([]);
  });
});

describe('refresh 증분', () => {
  it('수정·추가·삭제를 반영한다', () => {
    const root = makeVault({ 'a.md': '# 하나\n본문\n', 'gone.md': 'x\n' });
    const scanner = new VaultScanner(root);
    scanner.refresh();
    expect(scanner.list().map((n) => n.path)).toEqual(['a.md', 'gone.md']);

    writeVaultFile(root, 'a.md', '# 둘\n본문\n');
    setMtime(path.join(root, 'a.md'), FIXED_MTIME + 10);
    writeVaultFile(root, 'new.md', '# 새 노트\n');
    rmSync(path.join(root, 'gone.md'));
    scanner.refresh();

    expect(scanner.list().map((n) => n.path)).toEqual(['a.md', 'new.md']);
    expect(scanner.get('a.md')?.title).toBe('둘');
    expect(scanner.get('new.md')?.title).toBe('새 노트');
    expect(scanner.get('gone.md')).toBeUndefined();
  });

  it('mtime·size 가 같으면 내용이 달라도 다시 읽지 않는다', () => {
    const root = makeVault({});
    const file = path.join(root, 'note.md');
    const before = '# 가나\n';
    const after = '# 가다\n'; // 같은 바이트 길이
    writeVaultFile(root, 'note.md', before);
    setMtime(file, FIXED_MTIME);

    const scanner = new VaultScanner(root);
    scanner.refresh();
    expect(scanner.get('note.md')?.title).toBe('가나');

    expect(Buffer.byteLength(before, 'utf8')).toBe(Buffer.byteLength(after, 'utf8'));
    writeVaultFile(root, 'note.md', after);
    setMtime(file, FIXED_MTIME); // mtime 을 같게 되돌린다
    expect(readFileSync(file, 'utf8')).toBe(after);

    scanner.refresh();
    expect(scanner.get('note.md')?.title).toBe('가나'); // mtime+size 가 같으니 캐시를 그대로 쓴다
    expect(scanner.read('note.md')?.content).toBe(after); // read 는 항상 디스크를 읽는다
  });
});

describe('search', () => {
  it('모든 토큰이 있어야 하고(AND) 한글 부분 문자열도 찾는다', () => {
    const root = makeVault({
      'one.md': '# 프로젝트 알파\n알파 베타 감마\n',
      'two.md': '# 프로젝트 베타\n베타만 있음\n',
      'three.md': '# 무관\n아무것도 없음\n',
    });
    const scanner = new VaultScanner(root);
    scanner.refresh();

    expect(scanner.search('프로 알파').map((h) => h.path)).toEqual(['one.md']);
    expect(scanner.search('프로').map((h) => h.path).sort()).toEqual(['one.md', 'two.md']);
    expect(scanner.search('없는단어')).toEqual([]);
    expect(scanner.search('   ')).toEqual([]);
    expect(scanner.search('')).toEqual([]);
  });

  it('점수는 제목 +10 > 별칭 +6 > 태그 +4 > 제목들 +3 > 본문 +1, 동점이면 mtime 최신 우선', () => {
    const root = makeVault({
      'fm-title.md': '---\ntitle: 공통토큰\n---\n본문\n',
      'alias.md': '---\naliases: [공통토큰]\n---\n본문\n',
      'tag.md': '---\ntags: [공통토큰]\n---\n본문\n',
      'heading.md': '---\ntitle: 다른제목\n---\n## 공통토큰\n',
      'body.md': '# 무관\n공통토큰 본문\n',
    });
    const scanner = new VaultScanner(root);
    scanner.refresh();

    const hits = scanner.search('공통토큰');
    const scoreOf = (p: string) => hits.find((h) => h.path === p)?.score;
    expect(scoreOf('fm-title.md')).toBe(10); // 제목(프런트매터)
    expect(scoreOf('alias.md')).toBe(6); // 별칭
    expect(scoreOf('tag.md')).toBe(4); // 태그
    expect(scoreOf('heading.md')).toBe(4); // 제목들 +3, 본문 1회 +1
    expect(scoreOf('body.md')).toBe(1); // 본문
    expect(hits[0]?.path).toBe('fm-title.md');

    // 동점(둘 다 본문 1회)이면 mtime 이 최신인 쪽이 앞
    const tie = makeVault({ 'old.md': '# 옛 노트\n공통토큰\n', 'new.md': '# 새 노트\n공통토큰\n' });
    setMtime(path.join(tie, 'old.md'), FIXED_MTIME);
    setMtime(path.join(tie, 'new.md'), FIXED_MTIME + 100);
    const tieScanner = new VaultScanner(tie);
    tieScanner.refresh();
    expect(tieScanner.search('공통토큰').map((h) => h.path)).toEqual(['new.md', 'old.md']);
  });

  it('본문 등장 횟수는 최대 5회까지만 점수에 더한다', () => {
    const root = makeVault({ 'cap.md': `# 제목\n${' 토큰'.repeat(8).trim()}\n` });
    const scanner = new VaultScanner(root);
    scanner.refresh();
    expect(scanner.search('토큰')[0]?.score).toBe(5);
  });

  it('스니펫은 첫 토큰이 본문에 처음 나온 자리의 앞뒤 60자, 줄 번호는 전체 파일 기준', () => {
    const root = makeVault({ 'a.md': '# 머리\n\n\n앞부분 토큰 뒷부분\n' });
    const scanner = new VaultScanner(root);
    scanner.refresh();

    const hit = scanner.search('토큰')[0]!;
    expect(hit.line).toBe(4);
    expect(hit.snippet).toContain('토큰');
    expect(hit.snippet).not.toContain('\n');

    // 잘린 쪽에는 … 를 붙인다
    const longLine = `${'가'.repeat(80)}토큰${'나'.repeat(80)}`;
    const longRoot = makeVault({ 'long.md': `# 머리\n\n${longLine}\n` });
    const longScanner = new VaultScanner(longRoot);
    longScanner.refresh();
    const longHit = longScanner.search('토큰')[0]!;
    expect(longHit.snippet.startsWith('…')).toBe(true);
    expect(longHit.snippet.endsWith('…')).toBe(true);
    expect(longHit.snippet).toHaveLength(2 + 60 + '토큰'.length + 60);
  });

  it('본문에 없는(제목에만 있는) 토큰은 스니펫이 제목이고 줄 번호가 null 이다', () => {
    const root = makeVault({ 'plain.md': '내용만 있음\n' }); // 제목은 파일명에서 온다
    const scanner = new VaultScanner(root);
    scanner.refresh();

    const hit = scanner.search('plain')[0]!;
    expect(hit.snippet).toBe('plain');
    expect(hit.line).toBeNull();
  });

  it('limit 기본값 20, 최대 100', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 120; i++) files[`n${String(i).padStart(3, '0')}.md`] = '공통 내용\n';
    const scanner = new VaultScanner(makeVault(files));
    scanner.refresh();

    expect(scanner.search('공통').length).toBe(20);
    expect(scanner.search('공통', { limit: 1000 }).length).toBe(100);
    expect(scanner.search('공통', { limit: 3 }).length).toBe(3);
  });

  it('folder·tag 로도 거른다', () => {
    const root = makeVault({
      'AI/agent.md': '---\ntags: [AI]\n---\n# 에이전트\n공통\n',
      'note.md': '---\ntags: [기타]\n---\n# 노트\n공통\n',
    });
    const scanner = new VaultScanner(root);
    scanner.refresh();

    expect(scanner.search('공통', { folder: 'AI' }).map((h) => h.path)).toEqual(['AI/agent.md']);
    expect(scanner.search('공통', { tag: '#ai' }).map((h) => h.path)).toEqual(['AI/agent.md']);
  });
});

describe('backlinks', () => {
  it('해석된 링크만, 자기 자신 제외, 경로·줄 순으로 돌려준다', () => {
    const root = makeVault({
      'target.md': '# 대상\n자기 자신 [[target]] 링크\n',
      'ref.md': '# 참조\n앞줄\n\n  [[target]] 참조하는 줄  \n',
      'z-ref.md': '[[target]] [[없는노트]]\n',
    });
    const scanner = new VaultScanner(root);
    scanner.refresh();

    const hits = scanner.backlinks('target.md');
    expect(hits.map((h) => [h.path, h.line])).toEqual([
      ['ref.md', 4],
      ['z-ref.md', 1],
    ]);
    expect(hits[0]?.context).toBe('[[target]] 참조하는 줄');
    expect(hits[0]?.title).toBe('참조');

    // 별칭으로 걸린 링크도 원 노트를 가리킨다
    expect(scanner.backlinks('없는노트.md')).toEqual([]);
  });
});

describe('list·tags 필터', () => {
  it('folder 는 하위만(경계 AI vs AIx), tag 는 # 무시·대소문자 무시·중첩', () => {
    const root = makeVault({
      'AI/agent.md': '---\ntags: [AI, 머신러닝/기초]\n---\n# 에이전트\n',
      'AIx/other.md': '---\ntags: [AIx]\n---\n# 다른\n',
      'AI.md': '# 루트 노트\n',
      'notes/deep.md': '# 깊은 노트\n',
    });
    const scanner = new VaultScanner(root);
    scanner.refresh();

    expect(scanner.list().map((n) => n.path)).toEqual(['AI.md', 'AI/agent.md', 'AIx/other.md', 'notes/deep.md']);
    expect(scanner.list({ folder: 'AI' }).map((n) => n.path)).toEqual(['AI/agent.md']);
    expect(scanner.list({ folder: 'AI/' }).map((n) => n.path)).toEqual(['AI/agent.md']);
    expect(scanner.list({ folder: 'AIx' }).map((n) => n.path)).toEqual(['AIx/other.md']);
    expect(scanner.list({ folder: '' }).length).toBe(4);
    expect(scanner.list({ folder: '.' }).length).toBe(4);

    expect(scanner.list({ tag: 'AI' }).map((n) => n.path)).toEqual(['AI/agent.md']);
    expect(scanner.list({ tag: '#ai' }).map((n) => n.path)).toEqual(['AI/agent.md']);
    expect(scanner.list({ tag: '머신러닝' }).map((n) => n.path)).toEqual(['AI/agent.md']);
    expect(scanner.list({ tag: '머신러닝/기초' }).map((n) => n.path)).toEqual(['AI/agent.md']);
    expect(scanner.list({ tag: '머신러닝/없음' })).toEqual([]);
  });

  it('tags() 는 노트 수를 세고 대소문자를 합쳐 개수 내림차순·이름순으로 돌려준다', () => {
    const root = makeVault({
      'AI/agent.md': '---\ntags: [AI]\n---\n# 에이전트\n',
      'x/nested.md': '---\ntags: [머신러닝/기초, AI]\n---\n# 중첩\n',
      'z-case.md': '---\ntags: [ai]\n---\n# 소문자\n',
    });
    const scanner = new VaultScanner(root);
    scanner.refresh();

    expect(scanner.tags()).toEqual([
      { tag: 'AI', count: 3 }, // 먼저 만난 표기(AI/agent.md)를 쓰고 'ai' 를 합친다
      { tag: '머신러닝/기초', count: 1 },
    ]);
  });
});

describe('read', () => {
  it('디스크 내용과 sha256 을 돌려주고, 볼트 밖·없는 파일은 null', () => {
    const content = '# 노트\n내용\n';
    const root = makeVault({ 'note.md': content });
    const scanner = new VaultScanner(root);
    scanner.refresh();

    const read = scanner.read('note.md');
    expect(read?.content).toBe(content);
    expect(read?.hash).toBe(scanner.get('note.md')?.hash); // 캐시된 노트와 같은 sha256
    expect(read?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(scanner.read('없는파일.md')).toBeNull();
    expect(scanner.read('../outside.md')).toBeNull();

    // read 는 캐시가 아니라 지금 디스크를 읽는다
    writeVaultFile(root, 'note.md', '# 수정\n내용\n');
    expect(scanner.read('note.md')?.content).toBe('# 수정\n내용\n');
    expect(scanner.get('note.md')?.hash).toBe(read?.hash); // refresh 전에는 캐시 그대로
  });
});

describe('캐시', () => {
  const cachePath = (root: string) => path.join(root, '.nopsidian', 'mcp-cache.json');

  it('파싱 결과를 저장하고 다음 스캐너는 바뀐 파일만 다시 읽는다', () => {
    const root = makeVault({
      'a.md': '---\ntitle: 알파\ntags: [x]\n---\n# 제목\n[[b]] 본문\n',
      'sub/b.md': '# 베타\n본문\n',
    });
    const first = new VaultScanner(root);
    first.refresh();
    expect(first.scanStats.parsed).toBe(2);
    expect(first.scanStats.cacheSaved).toBe(true);
    expect(existsSync(cachePath(root))).toBe(true);

    const second = new VaultScanner(root);
    expect(second.scanStats.cacheLoaded).toBe(2);
    second.refresh();
    expect(second.scanStats.parsed).toBe(0);
    expect(second.scanStats.reused).toBe(2);
    expect(second.list()).toEqual(first.list());
    expect(second.search('본문')).toEqual(first.search('본문'));
    expect(second.backlinks('sub/b.md')).toEqual(first.backlinks('sub/b.md'));
    expect(second.tags()).toEqual(first.tags());
    expect(second.get('a.md')?.links).toEqual(first.get('a.md')?.links);
  });

  it('앱 밖에서 고친 파일은 다음 refresh 에 반영하고 캐시를 갱신한다', () => {
    const root = makeVault({ 'a.md': '# 가\n옛 내용\n' });
    const first = new VaultScanner(root);
    first.refresh();

    writeVaultFile(root, 'a.md', '# 나\n새 내용\n');
    setMtime(path.join(root, 'a.md'), FIXED_MTIME + 10);
    first.refresh();
    expect(first.get('a.md')?.title).toBe('나');
    expect(first.search('새 내용').map((h) => h.path)).toEqual(['a.md']);
    expect(first.scanStats.parsed).toBe(1);

    const second = new VaultScanner(root);
    second.refresh();
    expect(second.get('a.md')?.title).toBe('나');
    expect(second.scanStats.parsed).toBe(0);
  });

  it('캐시가 없거나 깨졌거나 버전이 다르면 전체 스캔으로 돌아가고 결과는 같다', () => {
    const root = makeVault({ 'a.md': '# 하나\n본문\n', 'b.md': '# 둘\n본문\n' });
    const first = new VaultScanner(root);
    first.refresh();
    const expected = first.list();

    rmSync(cachePath(root));
    const missing = new VaultScanner(root);
    missing.refresh();
    expect(missing.scanStats.parsed).toBe(2);
    expect(missing.list()).toEqual(expected);

    writeFileSync(cachePath(root), '{깨진 JSON');
    const broken = new VaultScanner(root);
    broken.refresh();
    expect(broken.scanStats.parsed).toBe(2);
    expect(broken.list()).toEqual(expected);
    expect(() => JSON.parse(readFileSync(cachePath(root), 'utf8'))).not.toThrow();

    writeFileSync(cachePath(root), JSON.stringify({ version: 999, bodyLimit: 1, entries: [] }));
    const version = new VaultScanner(root);
    version.refresh();
    expect(version.scanStats.parsed).toBe(2);
    expect(version.list()).toEqual(expected);

    writeFileSync(cachePath(root), JSON.stringify({ version: 1, bodyLimit: 200 * 1024, entries: [{ path: 'a.md' }] }));
    const entry = new VaultScanner(root);
    entry.refresh();
    expect(entry.scanStats.parsed).toBe(2);
    expect(entry.list()).toEqual(expected);
  });

  it('.nopsidian 에 쓸 수 없으면 캐시 없이 정상 동작한다', () => {
    const root = makeVault({ 'a.md': '# 하나\n본문\n' });
    writeFileSync(path.join(root, '.nopsidian'), '폴더가 아니라 파일');

    const scanner = new VaultScanner(root);
    scanner.refresh();
    expect(scanner.list().map((n) => n.path)).toEqual(['a.md']);
    expect(scanner.search('본문').map((h) => h.path)).toEqual(['a.md']);
    expect(scanner.scanStats.cacheSaved).toBe(false);
  });

  it('.nopsidian 폴더가 읽기 전용이어도 캐시 없이 정상 동작한다', () => {
    if (process.getuid?.() === 0) return; // root 는 권한 검사를 우회한다
    const root = makeVault({ 'a.md': '# 하나\n본문\n' });
    const dir = path.join(root, '.nopsidian');
    mkdirSync(dir);
    chmodSync(dir, 0o555);
    try {
      const scanner = new VaultScanner(root);
      scanner.refresh();
      expect(scanner.list().map((n) => n.path)).toEqual(['a.md']);
      expect(scanner.scanStats.cacheSaved).toBe(false);
    } finally {
      chmodSync(dir, 0o755);
    }
  });
});
