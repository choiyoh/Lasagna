import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { serveFile } from './serve-file';

const dir = mkdtempSync(path.join(tmpdir(), 'nops-sf-'));
const file = path.join(dir, 'a.txt');
writeFileSync(file, '0123456789');
const req = (range?: string) =>
  new Request('vault://x/a.txt', range ? { headers: { range } } : undefined);

describe('serveFile', () => {
  it('전체 파일을 고정 Content-Type으로 돌려준다', async () => {
    const res = await serveFile(file, req());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe('0123456789');
  });

  it('Range 요청에 206과 Content-Range를 돌려준다', async () => {
    const res = await serveFile(file, req('bytes=2-5'));
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await res.text()).toBe('2345');
    const tail = await serveFile(file, req('bytes=-3'));
    expect(await tail.text()).toBe('789');
  });

  it('범위를 벗어나면 416, 없는 파일·디렉터리는 404', async () => {
    expect((await serveFile(file, req('bytes=50-60'))).status).toBe(416);
    expect((await serveFile(path.join(dir, 'none'), req())).status).toBe(404);
    expect((await serveFile(dir, req())).status).toBe(404);
  });

  it('빈 범위·0 접미사·비유한 값은 스트림을 열지 않고 416으로 거부한다', async () => {
    // `bytes=-` 는 start·end 가 모두 NaN 이 되어 createReadStream 이 던지던 입력이다
    const empty = await serveFile(file, req('bytes=-'));
    expect(empty.status).toBe(416);
    expect(empty.headers.get('content-range')).toBe('bytes */10');
    expect((await serveFile(file, req('bytes=-0'))).status).toBe(416);
    expect((await serveFile(file, req(`bytes=${'9'.repeat(400)}-`))).status).toBe(416); // Number → Infinity
    expect((await serveFile(file, req(`bytes=0-${'9'.repeat(400)}`))).status).toBe(416);
    expect((await serveFile(file, req('bytes=3-1'))).status).toBe(416);
  });
});
