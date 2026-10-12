import { describe, expect, it } from 'vitest';
import { sha256Hex, text, toBytes, utf8 } from './hash.js';

describe('sha256Hex', () => {
  it('알려진 벡터와 일치한다', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('문자열은 UTF-8 로 인코딩해 계산한다', () => {
    expect(sha256Hex('한글')).toBe(sha256Hex(utf8('한글')));
    // 같은 코드 유닛이라도 인코딩이 다르면 해시가 달라진다(바이트 기준임을 확인)
    expect(sha256Hex('가')).not.toBe(sha256Hex(utf8('각')));
  });

  it('바이트 열은 그대로 쓴다', () => {
    expect(sha256Hex(new Uint8Array([0, 1, 255]))).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(new Uint8Array([]))).toBe(sha256Hex(''));
  });
});

describe('utf8/text', () => {
  it('왕복한다', () => {
    expect(text(utf8('안녕 🌏'))).toBe('안녕 🌏');
    expect(utf8('a')).toEqual(new Uint8Array([97]));
  });
});

describe('toBytes', () => {
  it('문자열은 인코딩한다', () => {
    expect(text(toBytes('한글'))).toBe('한글');
  });

  it('바이트 입력은 복사본을 돌려준다', () => {
    const src = utf8('a');
    const copy = toBytes(src);
    expect(copy).toEqual(src);
    copy[0] = 98;
    expect(text(src)).toBe('a');
  });
});
