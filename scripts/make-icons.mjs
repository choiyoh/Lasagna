/* global Buffer, console */
// apps/desktop/assets/icon.svg → icon.png(1024), icon.icns(macOS), icon.ico(Windows)
// 실행: node scripts/make-icons.mjs  (macOS 에서: iconutil 사용). 결과 파일은 커밋한다.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../apps/desktop/assets');
const svg = readFileSync(path.join(dir, 'icon.svg'));
const png = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

writeFileSync(path.join(dir, 'icon.png'), await png(1024));

// macOS .icns
const set = path.join(dir, 'icon.iconset');
rmSync(set, { recursive: true, force: true });
mkdirSync(set);
for (const s of [16, 32, 128, 256, 512]) {
  writeFileSync(path.join(set, `icon_${s}x${s}.png`), await png(s));
  writeFileSync(path.join(set, `icon_${s}x${s}@2x.png`), await png(s * 2));
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(dir, 'icon.icns')]);
rmSync(set, { recursive: true, force: true });

// Windows .ico (PNG 항목)
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map(png));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const o = 6 + i * 16;
  head.writeUInt8(s === 256 ? 0 : s, o);
  head.writeUInt8(s === 256 ? 0 : s, o + 1);
  head.writeUInt16LE(1, o + 4);
  head.writeUInt16LE(32, o + 6);
  head.writeUInt32LE(images[i].length, o + 8);
  head.writeUInt32LE(offset, o + 12);
  offset += images[i].length;
});
writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([head, ...images]));
console.log('icons written to', dir);
