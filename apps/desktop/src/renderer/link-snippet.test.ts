import { describe, expect, it } from 'vitest';
import { cleanSnippet, noteNameOf } from './link-snippet';

describe('cleanSnippet', () => {
  it('위키링크는 보이는 글자만 남긴다', () => {
    expect(cleanSnippet('[[디자인 원칙]] 그리고 [[프로젝트/로드맵]]도 참고.')).toBe('디자인 원칙 그리고 프로젝트/로드맵도 참고.');
  });

  it('별칭·제목 앵커가 있으면 별칭/노트 이름만 남긴다', () => {
    expect(cleanSnippet('함께 읽을 책은 [[클린 코드#1장|1장]]이다')).toBe('함께 읽을 책은 1장이다');
    expect(cleanSnippet('[[Clean Code]]도')).toBe('Clean Code도');
  });

  it('해시태그의 # 을 벗기고 제목(# + 공백)은 그대로 둔다', () => {
    expect(cleanSnippet('#디자인 #데모')).toBe('디자인 데모');
    expect(cleanSnippet('# 제목은 그대로')).toBe('# 제목은 그대로');
  });

  it('인라인 코드·굵게 표시를 벗긴다', () => {
    expect(cleanSnippet('`클린 코드`를 **다시** 읽는다')).toBe('클린 코드를 다시 읽는다');
  });

  it('임베드는 파일 이름만 보인다', () => {
    expect(cleanSnippet('![[그림.png]] 설명')).toBe('그림.png 설명');
  });

  it('이스케이프된 대괄호는 링크로 바꾸지 않고 백슬래시만 푼다', () => {
    expect(cleanSnippet('\\[\\[가짜\\]\\]')).toBe('[[가짜]]');
  });

  it('제목만 가리키는 링크는 #만 벗긴다', () => {
    expect(cleanSnippet('[[#제목]]')).toBe('제목');
    expect(cleanSnippet('[[#제목|보기]]')).toBe('보기');
  });

  it('공백을 하나로 줄이고 앞뒤를 자른다', () => {
    expect(cleanSnippet('  한 줄\n\n  다음 줄  ')).toBe('한 줄 다음 줄');
  });
});

describe('noteNameOf', () => {
  it('경로에서 파일 이름만 꺼낸다', () => {
    expect(noteNameOf('독서/클린 코드.md')).toBe('클린 코드');
    expect(noteNameOf('노트')).toBe('노트');
  });
});
