import { describe, expect, it } from 'vitest';
import { cleanSearchSnippet, cleanSnippet, noteNameOf } from './link-snippet';

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

  it('인접한 링크는 한 단어로 붙지 않게 띄운다', () => {
    expect(cleanSnippet('[[노트 000]][[노트 290]][[노트 077]]')).toBe('노트 000 노트 290 노트 077');
    expect(cleanSnippet('[[a]] [[b]]')).toBe('a b');
    expect(cleanSnippet('![[그림]][[b]]')).toBe('그림 b');
  });

  it('링크에 붙은 조사는 원문대로 둔다', () => {
    expect(cleanSnippet('[[프로젝트/로드맵]]도 참고')).toBe('프로젝트/로드맵도 참고');
    expect(cleanSnippet('[[클린 코드#1장|1장]]이다')).toBe('1장이다');
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


describe('cleanSearchSnippet', () => {
  it('끝에서 잘린 링크 조각을 지운다', () => {
    expect(cleanSearchSnippet('# 노트 100 - [[노트 172')).toBe('노트 100 -');
    expect(cleanSearchSnippet('본문 [[노트')).toBe('본문');
    expect(cleanSearchSnippet('그림 ![[첨부')).toBe('그림');
  });

  it('선행 헤딩 마커만 지운다', () => {
    expect(cleanSearchSnippet('# 제목 본문')).toBe('제목 본문');
    expect(cleanSearchSnippet('### 소제목')).toBe('소제목');
    // 본문 중간의 # 은 태그/문장 일부라 그대로
    expect(cleanSearchSnippet('본문 # 태그')).toBe('본문 # 태그');
  });

  it('정상 링크는 그대로 정리한다', () => {
    expect(cleanSearchSnippet('[[노트 172]] 참고')).toBe('노트 172 참고');
  });

  it('잘린 조각을 지운 뒤 남는 구분자는 유지한다(FTS 대괄호 포함)', () => {
    expect(cleanSearchSnippet('# [노트 100] - [[노트 172')).toBe('[노트 100] -');
  });

  it('FTS 센티넬을 남기지 않는다', () => {
    expect(cleanSearchSnippet('\uE000디자인\uE001 원칙')).toBe('디자인 원칙');
    expect(cleanSearchSnippet('[[\uE000디자인\uE001 원칙]]')).toBe('디자인 원칙');
  });

  it('제목 안의 대괄호를 보존한다', () => {
    expect(cleanSearchSnippet('[[[디자인] 원칙]]')).toBe('[디자인] 원칙');
    expect(cleanSearchSnippet('# [디자인] 데모')).toBe('[디자인] 데모');
  });

  it('끝에서 잘린 링크는 지우고 앞 글자는 남긴다', () => {
    expect(cleanSearchSnippet('본문 [[디자인 원칙')).toBe('본문');
  });

  it('목록 경계에서 앞 항목과 링크 사이에 공백을 둔다', () => {
    expect(cleanSearchSnippet('- 디자인 리뷰 받기\n- [[프로젝트/로드맵]]')).toBe('디자인 리뷰 받기 프로젝트/로드맵');
  });
});
