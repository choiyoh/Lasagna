import { describe, expect, it } from 'vitest';
import {
  assetKind,
  createAssetResolver,
  isGenericName,
  mimeFromName,
  parseSizeSpec,
  pastedName,
  sanitizeAttachmentName,
  uniqueName,
  relativePath,
  vaultUrl,
} from './assets.js';

describe('assetKind / mime', () => {
  it('확장자로 종류를 나눈다', () => {
    expect(assetKind('a.PNG')).toBe('image');
    expect(assetKind('dir/a.mp3')).toBe('audio');
    expect(assetKind('a.mov')).toBe('video');
    expect(assetKind('a.pdf')).toBe('pdf');
    expect(assetKind('노트')).toBe('note');
    expect(assetKind('노트.md')).toBe('note');
    expect(assetKind('a.zip')).toBe('file');
    expect(assetKind('.hidden')).toBe('note');
    expect(mimeFromName('a.webp')).toBe('image/webp');
    expect(mimeFromName('a.xyz')).toBe('application/octet-stream');
  });
});

describe('이름 만들기', () => {
  it('붙여넣은 이미지는 시각이 들어간 이름', () => {
    expect(pastedName('image/png', new Date(2026, 9, 12, 15, 30, 45))).toBe('Pasted image 20261012-153045.png');
    expect(pastedName('image/jpeg', new Date(2026, 0, 2, 3, 4, 5))).toBe('Pasted image 20260102-030405.jpg');
    expect(isGenericName('image.png')).toBe(true);
    expect(isGenericName('여행 사진.png')).toBe(false);
  });

  it('위험한 문자와 경로를 없앤다', () => {
    expect(sanitizeAttachmentName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeAttachmentName('a\\b\\c.png')).toBe('c.png');
    expect(sanitizeAttachmentName('이름: "특수"|문자?.png')).toBe('이름 특수문자.png');
    expect(sanitizeAttachmentName('  ..숨김.txt')).toBe('숨김.txt');
    expect(sanitizeAttachmentName('')).toBe('file');
    expect(sanitizeAttachmentName('a#b^c[d].png')).toBe('abcd.png');
    expect(sanitizeAttachmentName('x'.repeat(300) + '.png').length).toBeLessThanOrEqual(150);
  });

  it('150자를 넘으면 확장자를 남기고 앞 120자로 줄인다', () => {
    // (a) 점이 없으면 확장자를 붙이지 않고 앞 120자만 남긴다.
    expect(sanitizeAttachmentName('x'.repeat(200))).toBe('x'.repeat(120));
    // (b) 점이 있으면 확장자를 유지한다.
    expect(sanitizeAttachmentName('x'.repeat(200) + '.png')).toBe('x'.repeat(120) + '.png');
    // (c) 확장자가 21자 이상이어도 결과는 150자 이하다.
    expect(sanitizeAttachmentName('x'.repeat(200) + '.' + 'e'.repeat(25)).length).toBeLessThanOrEqual(150);
  });

  it('겹치면 번호를 붙인다', () => {
    const used = new Set(['a.png', 'a 1.png']);
    expect(uniqueName('b.png', (c) => used.has(c))).toBe('b.png');
    expect(uniqueName('a.png', (c) => used.has(c))).toBe('a 2.png');
    expect(uniqueName('noext', (c) => c === 'noext')).toBe('noext 1');
  });
});

describe('createAssetResolver', () => {
  const resolve = createAssetResolver(['attachments/a.png', 'attachments/Cat Photo.JPG', '프로젝트/img/a.png', 'doc.pdf']);

  it('경로 → 파일명 순서로 찾고 대소문자는 무시한다', () => {
    expect(resolve('attachments/a.png', '')).toBe('attachments/a.png');
    expect(resolve('cat photo.jpg', 'x.md')).toBe('attachments/Cat Photo.JPG');
    expect(resolve('doc.pdf', '프로젝트/노트.md')).toBe('doc.pdf');
  });

  it('같은 이름이면 경로가 짧은 것, 깊이가 같으면 노트와 가까운 것', () => {
    expect(resolve('a.png', '')).toBe('attachments/a.png');
    const r = createAssetResolver(['x/a.png', 'y/a.png']);
    expect(r('a.png', 'y/노트.md')).toBe('y/a.png');
    expect(r('a.png', 'x/노트.md')).toBe('x/a.png');
  });

  it('상대 경로(마크다운 이미지)는 노트 폴더 기준으로 푼다', () => {
    expect(resolve('img/a.png', '프로젝트/노트.md')).toBe('프로젝트/img/a.png');
    expect(resolve('../attachments/a.png', '프로젝트/노트.md')).toBe('attachments/a.png');
  });

  it('없으면 undefined, 경로가 포함되면 접미 경로가 맞아야 한다', () => {
    expect(resolve('nope.png', '')).toBeUndefined();
    expect(resolve('other/a.png', '')).toBeUndefined();
    expect(resolve('', '')).toBeUndefined();
  });
});

describe('vaultUrl / parseSizeSpec', () => {
  it('각 구간만 인코딩한다', () => {
    expect(vaultUrl('abc', 'attachments/Pasted image #1.png')).toBe('vault://abc/attachments/Pasted%20image%20%231.png');
    expect(vaultUrl('abc', '한글/사진.png')).toBe(`vault://abc/${encodeURIComponent('한글')}/${encodeURIComponent('사진.png')}`);
  });
  it('크기 표기', () => {
    expect(parseSizeSpec('400')).toEqual({ width: 400, height: null });
    expect(parseSizeSpec('400x300')).toEqual({ width: 400, height: 300 });
    expect(parseSizeSpec('설명')).toBeNull();
    expect(parseSizeSpec(null)).toBeNull();
  });
});

describe('relativePath', () => {
  it('노트 폴더에서 본 상대 경로', () => {
    expect(relativePath('', 'attachments/a.png')).toBe('attachments/a.png');
    expect(relativePath('notes', 'attachments/a.png')).toBe('../attachments/a.png');
    expect(relativePath('notes/deep', 'attachments/a.png')).toBe('../../attachments/a.png');
    expect(relativePath('notes', 'notes/img/a.png')).toBe('img/a.png');
    expect(relativePath('a/b', 'a/c/d.png')).toBe('../c/d.png');
    expect(relativePath('a', 'a.png')).toBe('../a.png');
  });
});
