import { describe, expect, it } from 'vitest';
import { isWorkTemplatePath, readGoalChars } from './index.js';
import { characterNoteMarkdown, characterSheetMarkdown, episodeMarkdown, validateWorkName, workNames, workPlan, worldbuildingMarkdown } from './work.js';
import { splitFrontmatter } from './markdown/frontmatter.js';

describe('작품 만들기 — 구조와 이름', () => {
  it('한국어 구조: 폴더 5개와 템플릿 노트 3개', () => {
    const plan = workPlan('달빛 조각사', 'ko');
    expect(plan?.folders).toEqual(['달빛 조각사', '달빛 조각사/회차', '달빛 조각사/캐릭터', '달빛 조각사/설정집', '달빛 조각사/템플릿']);
    expect(plan?.files.map((f) => f.path)).toEqual([
      '달빛 조각사/템플릿/캐릭터 시트.md',
      '달빛 조각사/템플릿/회차.md',
      '달빛 조각사/템플릿/세계관·복선.md',
    ]);
  });

  it('영어 구조: 만드는 시점 언어로 폴더·템플릿 이름', () => {
    const plan = workPlan('Moonlight', 'en');
    expect(plan?.folders).toEqual(['Moonlight', 'Moonlight/Episodes', 'Moonlight/Characters', 'Moonlight/Story bible', 'Moonlight/Templates']);
    expect(plan?.files.map((f) => f.path)).toEqual([
      'Moonlight/Templates/Character sheet.md',
      'Moonlight/Templates/Episode.md',
      'Moonlight/Templates/Worldbuilding.md',
    ]);
  });

  it('이름 검증: 빈 이름·금지 문자·상대 경로·긴 이름 거부, 앞뒤 공백은 다듬는다', () => {
    expect(validateWorkName('   ')).toBe('empty');
    expect(validateWorkName('가/나')).toBe('badChars');
    expect(validateWorkName('가\\나')).toBe('badChars');
    expect(validateWorkName('가:나')).toBe('badChars');
    expect(validateWorkName('..')).toBe('badChars');
    expect(validateWorkName('가..나')).toBe('badChars');
    expect(validateWorkName('가.')).toBe('badChars');
    expect(validateWorkName('x'.repeat(81))).toBe('tooLong');
    expect(validateWorkName(' 달빛 ')).toBeNull();
    expect(workPlan(' 달빛 ', 'ko')?.name).toBe('달빛');
  });

  it('캐릭터 시트: 영문 속성 키 4개와 빈 섹션(안내 문구 없음)', () => {
    for (const [locale, sections] of [
      ['ko', ['외모', '성격', '말투·어휘 습관', '관계', '비밀·복선', '메모']],
      ['en', ['Appearance', 'Personality', 'Speech and vocabulary', 'Relationships', 'Secrets and foreshadowing', 'Notes']],
    ] as const) {
      const md = characterSheetMarkdown(locale);
      const fm = splitFrontmatter(md);
      expect(Object.keys(fm?.data ?? {})).toEqual(['name', 'role', 'age', 'first_appears']);
      for (const key of ['name', 'role', 'age', 'first_appears']) expect(fm?.data?.[key]).toBeNull();
      for (const section of sections) expect(md).toContain(`## ${section}`);
      expect(md).not.toMatch(/입력|작성하세요|예:/); // 빈 섹션 — 안내 문구 없음
    }
  });

  it('회차 템플릿에는 goal_chars 속성이 없다', () => {
    expect(episodeMarkdown('ko')).toBe('# 회차\n');
    expect(episodeMarkdown('en')).toBe('# Episode\n');
    expect(readGoalChars(episodeMarkdown('ko'))).toBeNull();
  });

  it('세계관·복선 템플릿은 빈 섹션 두 개', () => {
    expect(worldbuildingMarkdown('ko')).toBe('# 세계관·복선\n\n## 세계관\n\n## 복선 목록\n');
    expect(worldbuildingMarkdown('en')).toBe('# Worldbuilding\n\n## World\n\n## Foreshadowing\n');
  });

  it('작품 템플릿 경로 판별', () => {
    expect(isWorkTemplatePath('달빛/템플릿/캐릭터 시트.md')).toBe(true);
    expect(isWorkTemplatePath('Moonlight/Templates/Episode.md')).toBe(true);
    expect(isWorkTemplatePath('템플릿/회차.md')).toBe(false); // 볼트 공용 템플릿 폴더는 작품 템플릿이 아니다
    expect(isWorkTemplatePath('달빛/회차/1화.md')).toBe(false);
    expect(workNames('ko').characters).toBe('캐릭터');
  });
});

describe('새 캐릭터 노트 내용', () => {
  it('작품 템플릿 내용을 그대로 복사하고 name 속성만 채운다', () => {
    const template = characterSheetMarkdown('ko');
    const note = characterNoteMarkdown(template, '서연', 'ko');
    expect(note).toContain('name: 서연');
    expect(note).toContain('first_appears:');
    expect(note).toContain('## 외모');
    expect(note.slice(note.indexOf('# '))).toBe(template.slice(template.indexOf('# '))); // 본문 그대로
  });

  it('템플릿이 없으면 기본 캐릭터 시트로 만들고 이름을 채운다', () => {
    expect(characterNoteMarkdown(null, '서연', 'en')).toContain('name: 서연');
    expect(characterNoteMarkdown(null, '서연', 'en')).toContain('## Appearance');
  });
});
