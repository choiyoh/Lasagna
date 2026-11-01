/* global Buffer, console */
// apps/desktop/assets/icon.svg → icon.png(1024), icon.icns(macOS), icon.ico(Windows)
// 16/32px 는 1024 원본을 줄이면 층이 뭉개지므로 픽셀 그리드에 맞춘 전용 마스터를 쓴다.
// 실행: node scripts/make-icons.mjs  (macOS 에서: iconutil 사용). 결과 파일은 커밋한다.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../apps/desktop/assets');
const mainSvg = readFileSync(path.join(dir, 'icon.svg'));

/** 16px 전용: 크림 2단 + 토마토 1단 + 1px 외곽 테두리(물결·그림자·하이라이트 없음). */
const small16 = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect x="0" y="0" width="16" height="16" rx="3.2" fill="#9a3a22"/>
  <rect x="0.5" y="0.5" width="15" height="15" rx="2.8" fill="none" stroke="#5a2214" stroke-width="1"/>
  <rect x="3" y="3" width="10" height="2" fill="#fff2da"/>
  <rect x="3" y="6" width="10" height="2" fill="#c4552f"/>
  <rect x="3" y="9" width="10" height="3" fill="#efd3a9"/>
</svg>`);

/** 32px 전용: 같은 구성, 32px 그리드. */
const small32 = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect x="0" y="0" width="32" height="32" rx="7" fill="#9a3a22"/>
  <rect x="0.5" y="0.5" width="31" height="31" rx="6.6" fill="none" stroke="#5a2214" stroke-width="1"/>
  <rect x="6" y="6" width="20" height="6" rx="1" fill="#fff2da"/>
  <rect x="6" y="14" width="20" height="5" fill="#c4552f"/>
  <rect x="6" y="21" width="20" height="6" rx="1" fill="#efd3a9"/>
</svg>`);

const render = (size, svg = mainSvg) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
/** 16 이하는 16 마스터, 32 이하는 32 마스터, 그 이상은 본 마스터. */
const iconPng = (size) => (size <= 16 ? render(size, small16) : size <= 32 ? render(size, small32) : render(size, mainSvg));

writeFileSync(path.join(dir, 'icon.png'), await render(1024, mainSvg));

// macOS .icns
const set = path.join(dir, 'icon.iconset');
rmSync(set, { recursive: true, force: true });
mkdirSync(set);
for (const s of [16, 32, 128, 256, 512]) {
  const one = s === 16 ? await render(16, small16) : s === 32 ? await render(32, small32) : await render(s, mainSvg);
  const two = s === 16 ? await render(32, small32) : await render(s * 2, mainSvg);
  writeFileSync(path.join(set, `icon_${s}x${s}.png`), one);
  writeFileSync(path.join(set, `icon_${s}x${s}@2x.png`), two);
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(dir, 'icon.icns')]);
rmSync(set, { recursive: true, force: true });

// Windows .ico (PNG 항목)
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map(iconPng));
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
