import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export const mimeFor = (file: string) =>
  MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

/**
 * 파일을 직접 읽어 응답한다(net.fetch(file://) 미사용 — GrantFileProtocolExtraPrivileges 퓨즈를 끄기 위해).
 * Range 요청(오디오/비디오 시킹)을 지원한다. Content-Type은 확장자로 고정한다.
 */
export async function serveFile(
  file: string,
  req: Request,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  let st;
  try {
    st = await stat(file);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  if (!st.isFile()) return new Response('Not found', { status: 404 });

  const headers = new Headers({
    'Content-Type': mimeFor(file),
    'Accept-Ranges': 'bytes',
    ...extraHeaders,
  });

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (range) {
    let start = range[1] ? Number(range[1]) : NaN;
    let end = range[2] ? Number(range[2]) : NaN;
    if (Number.isNaN(start)) {
      // 접미사 범위: bytes=-N
      start = Math.max(0, st.size - end);
      end = st.size - 1;
    } else if (Number.isNaN(end) || end >= st.size) {
      end = st.size - 1;
    }
    if (start > end || start >= st.size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${st.size}`);
    headers.set('Content-Length', String(end - start + 1));
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers });
  }

  headers.set('Content-Length', String(st.size));
  if (req.method === 'HEAD') return new Response(null, { status: 200, headers });
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(body, { status: 200, headers });
}
