import { protocol } from 'electron';
import path from 'node:path';
import { buildCsp } from './security';
import { resolveInVault } from '@nopsidian/core';
import { serveFile } from './serve-file';

/** 특권 스킴 등록 — app.ready 이전에 호출해야 한다. */
export function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: 'vault', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

const MIME_ATTACHMENT = /\.(svg|html?|xhtml)$/i;

/**
 * app://nopsidian/*  — 번들된 렌더러 에셋 전용. 번들 디렉터리 밖은 404.
 * vault://<id>/*     — 현재 열린 볼트 하위 첨부 파일. realpath 검사로 탈출 차단.
 */
export function installProtocols(opts: {
  /** 운영 빌드에서만 지정한다. 개발 중에는 Vite dev 서버가 렌더러를 제공한다. */
  rendererRoot?: string;
  getVaultRoot: (id: string) => string | undefined;
}) {
  if (opts.rendererRoot) installAppProtocol(path.resolve(opts.rendererRoot));
  installVaultProtocol(opts.getVaultRoot);
}

function installAppProtocol(rendererRoot: string) {
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.resolve(rendererRoot, `.${rel}`);
    if (file !== rendererRoot && !file.startsWith(rendererRoot + path.sep)) {
      return new Response('Not found', { status: 404 });
    }
    return serveFile(file, req, {
      'Content-Security-Policy': buildCsp(false),
      'X-Content-Type-Options': 'nosniff',
    });
  });

}

function installVaultProtocol(getVaultRoot: (id: string) => string | undefined) {
  protocol.handle('vault', async (req) => {
    const url = new URL(req.url);
    const root = getVaultRoot(url.host);
    if (!root) return new Response('Not found', { status: 404 });
    let file: string;
    try {
      file = resolveInVault(root, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    } catch {
      return new Response('Forbidden', { status: 403 });
    }
    // 앱 내부 폴더(.nopsidian)는 렌더러에 노출하지 않는다.
    if (path.relative(root, file).split(path.sep).some((s) => s === '.nopsidian')) {
      return new Response('Forbidden', { status: 403 });
    }
    return serveFile(file, req, {
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'none'; sandbox`,
      ...(MIME_ATTACHMENT.test(file) ? { 'Content-Disposition': 'attachment' } : {}),
    });
  });
}
