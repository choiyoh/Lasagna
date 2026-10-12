/**
 * 첨부 파일(이미지·오디오·비디오·PDF·기타) 관련 순수 로직. 브라우저(렌더러)와 Node 양쪽에서 쓴다.
 */

export type AssetKind = 'image' | 'audio' | 'video' | 'pdf' | 'note' | 'file';

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico']);
const AUDIO = new Set(['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac']);
const VIDEO = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);

export const extOf = (name: string) => {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i + 1).toLowerCase();
};

/** 확장자가 없거나 `.md`면 노트로 본다(`![[노트]]`). */
export function assetKind(name: string): AssetKind {
  const ext = extOf(name);
  if (ext === '' || ext === 'md') return 'note';
  if (IMAGE.has(ext)) return 'image';
  if (AUDIO.has(ext)) return 'audio';
  if (VIDEO.has(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  return 'file';
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
  ogv: 'video/ogg',
  pdf: 'application/pdf',
};

export const mimeFromName = (name: string) => MIME_BY_EXT[extOf(name)] ?? 'application/octet-stream';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
};

const pad = (n: number) => String(n).padStart(2, '0');

/** 클립보드 이미지처럼 이름이 없거나 `image.png`뿐일 때 붙이는 이름: `Pasted image 20261012-153045.png` */
export function pastedName(mime: string, now = new Date()): string {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const ext = EXT_BY_MIME[mime] ?? (mime.startsWith('image/') ? mime.slice(6).replace(/[^a-z0-9]/gi, '') : 'bin');
  return `Pasted image ${stamp}.${ext}`;
}

/** 클립보드/드롭된 파일의 기본 이름이면 의미 있는 이름으로 바꾼다. */
export function isGenericName(name: string): boolean {
  return /^(image|blob|untitled|screenshot)?\.(png|jpe?g|gif|webp)$/i.test(name) || name === '';
}

/** 경로 구분자·제어 문자·예약 문자를 없앤 안전한 파일명(확장자 유지). */
export function sanitizeAttachmentName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*#^[\]]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  // 150자를 넘으면 앞 120자로 줄이고, 확장자가 있으면(맨 앞 점은 제외) 확장자만 이어 붙인다.
  const dot = cleaned.lastIndexOf('.');
  const limited = cleaned.length > 150 ? cleaned.slice(0, 120) + (dot > 0 ? cleaned.slice(dot).slice(0, 20) : '') : cleaned;
  return limited || 'file';
}

/** `이름.ext` → `이름 1.ext`, `이름 2.ext` … (이미 쓰이는 이름이면 `taken`이 true를 돌려준다) */
export function uniqueName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot <= 0 ? name : name.slice(0, dot);
  const ext = dot <= 0 ? '' : name.slice(dot);
  for (let n = 1; ; n++) {
    const candidate = `${stem} ${n}${ext}`;
    if (!taken(candidate)) return candidate;
  }
}

const posix = {
  dirname: (p: string) => {
    const i = p.lastIndexOf('/');
    return i < 0 ? '' : p.slice(0, i);
  },
  basename: (p: string) => p.slice(p.lastIndexOf('/') + 1),
  normalize: (p: string) => {
    const out: string[] = [];
    for (const seg of p.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') out.pop();
      else out.push(seg);
    }
    return out.join('/');
  },
};

export type AssetResolver = (target: string, fromPath: string) => string | undefined;

/**
 * 첨부 대상(`![[a.png]]`, `![](attachments/a.png)`)을 볼트 안의 실제 경로로 해석한다.
 * 1) 링크가 있는 노트 폴더 기준 상대 경로  2) 볼트 루트 기준 경로  3) 파일명(경로가 가장 짧은 것, 같으면 가까운 폴더)
 */
export function createAssetResolver(paths: readonly string[]): AssetResolver {
  const exact = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const p of paths) {
    exact.set(p.toLowerCase(), p);
    const key = posix.basename(p).toLowerCase();
    const list = byName.get(key);
    if (list) list.push(p);
    else byName.set(key, [p]);
  }
  const depth = (p: string) => p.split('/').length;

  return (rawTarget, fromPath) => {
    const target = rawTarget.trim().replace(/^\.?\//, '');
    if (!target) return undefined;
    const fromDir = posix.dirname(fromPath);
    const rel = posix.normalize(fromDir ? `${fromDir}/${target}` : target);
    const hit = exact.get(rel.toLowerCase()) ?? exact.get(posix.normalize(target).toLowerCase());
    if (hit) return hit;

    const base = posix.basename(target).toLowerCase();
    const candidates = byName.get(base);
    if (!candidates) return undefined;
    const suffix = '/' + posix.normalize(target).toLowerCase();
    const matching = target.includes('/') ? candidates.filter((c) => ('/' + c.toLowerCase()).endsWith(suffix)) : candidates;
    return [...matching].sort(
      (a, b) =>
        depth(a) - depth(b) ||
        Number(posix.dirname(b) === fromDir) - Number(posix.dirname(a) === fromDir) ||
        a.localeCompare(b),
    )[0];
  };
}

/** `fromDir`(볼트 기준 폴더, 루트면 빈 문자열)에서 본 `to`의 상대 경로. 예: `notes` → `attachments/a.png` = `../attachments/a.png` */
export function relativePath(fromDir: string, to: string): string {
  const from = fromDir.split('/').filter(Boolean);
  const dest = to.split('/').filter(Boolean);
  let i = 0;
  while (i < from.length && i < dest.length - 1 && from[i] === dest[i]) i++;
  return [...Array(from.length - i).fill('..'), ...dest.slice(i)].join('/');
}

/** `vault://<볼트ID>/<경로>` — 경로의 각 구간을 인코딩한다. */
export function vaultUrl(vaultId: string, path: string): string {
  return `vault://${vaultId}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** 이미지 크기 표기: `400`, `400x300`, `alt text|400` 의 숫자 부분. */
export function parseSizeSpec(spec: string | null | undefined): { width: number; height: number | null } | null {
  const m = /^(\d{1,5})(?:x(\d{1,5}))?$/.exec((spec ?? '').trim());
  return m ? { width: Number(m[1]), height: m[2] ? Number(m[2]) : null } : null;
}
