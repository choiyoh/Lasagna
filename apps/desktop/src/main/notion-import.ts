import { existsSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { atomicWrite, resolveInVault } from '@nopsidian/core';
import { convertNotionExport, type NotionImportResult, type ZipEntry } from '@nopsidian/core/import';

const MAX_TOTAL = 4 * 1024 ** 3;
const MAX_FILES = 100_000;

/** ZIP(안에 든 ZIP 한 겹 포함)을 풀어 항목 목록으로. 크기·개수 상한을 넘으면 거부한다. */
export function readZipEntries(data: Uint8Array, depth = 0): ZipEntry[] {
  let total = 0;
  let count = 0;
  const files = unzipSync(data, {
    filter: (f) => {
      total += f.originalSize;
      count++;
      if (total > MAX_TOTAL || count > MAX_FILES) throw new Error('압축 파일이 너무 커요');
      return !f.name.endsWith('/');
    },
  });
  const out: ZipEntry[] = [];
  for (const [name, bytes] of Object.entries(files)) {
    // Notion 은 큰 내보내기를 `Export-….zip` 안의 `Part-1.zip` 으로 나누기도 한다
    if (depth === 0 && /\.zip$/i.test(name)) out.push(...readZipEntries(bytes, 1));
    else out.push({ path: name, data: bytes });
  }
  return out;
}

/** 변환 결과를 볼트의 새 폴더(`Notion 가져오기 날짜`, 겹치면 번호)에 쓴다. */
export function importNotionInto(root: string, entries: ZipEntry[], now = new Date()): NotionImportResult & { folder: string } {
  const day = now.toISOString().slice(0, 10);
  let folder = `Notion 가져오기 ${day}`;
  for (let n = 2; existsSync(resolveInVault(root, folder)); n++) folder = `Notion 가져오기 ${day} ${n}`;
  const result = convertNotionExport(entries, { rootFolder: folder });
  for (const f of result.files) atomicWrite(resolveInVault(root, f.path), f.data);
  return { ...result, folder };
}
