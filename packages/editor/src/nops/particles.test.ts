import { describe, expect, it } from 'vitest';
import { adjustParticle, adjustParticleAt, hasBatchim } from './particles';

describe('받침 판정', () => {
  it('한글 음절은 받침 유무와 ㄹ 을 구분한다', () => {
    expect(hasBatchim('가')).toBe('none');
    expect(hasBatchim('유리')).toBe('none');
    expect(hasBatchim('각')).toBe('other');
    expect(hasBatchim('요한')).toBe('other');
    expect(hasBatchim('갈')).toBe('rieul');
    expect(hasBatchim('서울')).toBe('rieul');
  });

  it('한글이 아니면 모름', () => {
    expect(hasBatchim('apple')).toBe('unknown');
    expect(hasBatchim('note1')).toBe('unknown');
    expect(hasBatchim('123')).toBe('unknown');
    expect(hasBatchim('😀')).toBe('unknown');
    expect(hasBatchim('')).toBe('unknown');
  });
});

describe('조사 맞추기', () => {
  it('은/는·이/가·을/를·과/와 를 양방향으로 고른다', () => {
    expect(adjustParticle('요한', '는')).toBe('은');
    expect(adjustParticle('요한', '은')).toBe('은');
    expect(adjustParticle('유리', '은')).toBe('는');
    expect(adjustParticle('유리', '는')).toBe('는');

    expect(adjustParticle('요한', '가')).toBe('이');
    expect(adjustParticle('유리', '이')).toBe('가');

    expect(adjustParticle('요한', '를')).toBe('을');
    expect(adjustParticle('유리', '을')).toBe('를');

    expect(adjustParticle('요한', '와')).toBe('과');
    expect(adjustParticle('유리', '과')).toBe('와');
  });

  it('으로/로 는 ㄹ 받침이면 로 를 쓴다', () => {
    expect(adjustParticle('요한', '로')).toBe('으로');
    expect(adjustParticle('요한', '으로')).toBe('으로');
    expect(adjustParticle('유리', '으로')).toBe('로');
    expect(adjustParticle('서울', '으로')).toBe('로');
    expect(adjustParticle('서울', '로')).toBe('로');
    expect(adjustParticle('요한', '로서')).toBe('으로서');
    expect(adjustParticle('유리', '으로서')).toBe('로서');
    expect(adjustParticle('서울', '으로서')).toBe('로서');
    expect(adjustParticle('요한', '로써')).toBe('으로써');
    expect(adjustParticle('서울', '으로써')).toBe('로써');
    expect(adjustParticle('요한', '로부터')).toBe('으로부터');
    expect(adjustParticle('서울', '으로부터')).toBe('로부터');
  });

  it('이나/나·이랑/랑 을 고른다', () => {
    expect(adjustParticle('요한', '나')).toBe('이나');
    expect(adjustParticle('유리', '이나')).toBe('나');
    expect(adjustParticle('요한', '랑')).toBe('이랑');
    expect(adjustParticle('유리', '이랑')).toBe('랑');
  });

  it('받침을 모르면 조사를 그대로 둔다', () => {
    expect(adjustParticle('apple', '은')).toBe('은');
    expect(adjustParticle('apple', '는')).toBe('는');
    expect(adjustParticle('note1', '를')).toBe('를');
  });

  it('맞추지 않는 조사(아/야·서술형)는 그대로 둔다', () => {
    expect(adjustParticle('요한', '야')).toBe('야');
    expect(adjustParticle('요한', '아')).toBe('아');
    expect(adjustParticle('요한', '이다')).toBe('이다');
    expect(adjustParticle('요한', '이에요')).toBe('이에요');
    expect(adjustParticle('요한', '이며')).toBe('이며');
  });
});

describe('일치 뒤 조사 찾기', () => {
  it('뒤가 공백·문장부호·문단 끝이면 조사로 본다', () => {
    expect(adjustParticleAt('요한', '는 뒤')).toEqual({ length: 1, text: '은' });
    expect(adjustParticleAt('요한', '는.')).toEqual({ length: 1, text: '은' });
    expect(adjustParticleAt('요한', '는')).toEqual({ length: 1, text: '은' });
    expect(adjustParticleAt('요한', '를 "인용"')).toEqual({ length: 1, text: '을' });
    expect(adjustParticleAt('요한', '과)')).toEqual({ length: 1, text: '과' });
    expect(adjustParticleAt('유리', '으로 끝')).toEqual({ length: 2, text: '로' });
  });

  it('긴 꼴을 먼저 본다', () => {
    expect(adjustParticleAt('유리', '으로서 ')).toEqual({ length: 3, text: '로서' });
    expect(adjustParticleAt('요한', '로부터 ')).toEqual({ length: 3, text: '으로부터' });
    expect(adjustParticleAt('유리', '이나, ')).toEqual({ length: 2, text: '나' });
  });

  it('뒤에 글자가 붙으면 조사가 아니다', () => {
    expect(adjustParticleAt('요한', '는요')).toBeNull();
    expect(adjustParticleAt('요한', '가게')).toBeNull();
    expect(adjustParticleAt('요한', '야')).toBeNull();
    expect(adjustParticleAt('요한', '이다')).toBeNull();
    expect(adjustParticleAt('요한', '')).toBeNull();
  });
});
