import { translate } from '@nopsidian/i18n';

/**
 * 작품(폴더) 만들기 — 폴더 구조·템플릿 노트 내용·이름 검증의 순수 함수.
 *
 * 작품 하나는 볼트 루트 아래 폴더이고, 그 안에 회차·캐릭터·설정집·템플릿 폴더와 템플릿 노트 3개를 만든다.
 * 이름과 섹션 제목은 **만드는 시점의 앱 언어**를 따른다(파일·폴더 이름을 나중에 바꾸지 않는다).
 * 속성 키는 언어와 무관한 영문 키다(`name` `role` `age` `first_appears`).
 */

export type WorkLocale = 'ko' | 'en';

export interface WorkNames {
  /** 작품 안 폴더 이름 */
  episodes: string;
  characters: string;
  storyBible: string;
  templates: string;
  /** 템플릿 노트 파일 이름(확장자 제외) */
  characterSheet: string;
  episode: string;
  worldbuilding: string;
}

/** 만드는 시점 언어의 폴더·템플릿 이름. */
export function workNames(locale: WorkLocale): WorkNames {
  const tr = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  return {
    episodes: tr('work.folder.episodes'),
    characters: tr('work.folder.characters'),
    storyBible: tr('work.folder.storyBible'),
    templates: tr('work.folder.templates'),
    characterSheet: tr('work.template.characterSheet'),
    episode: tr('work.template.episode'),
    worldbuilding: tr('work.template.worldbuilding'),
  };
}

/** 캐릭터 시트 본문 섹션(빈 섹션, 안내 문구 없음). */
function characterSections(locale: WorkLocale): string[] {
  const keys = ['work.section.appearance', 'work.section.personality', 'work.section.speech', 'work.section.relationships', 'work.section.secrets', 'work.section.notes'] as const;
  return keys.map((key) => translate(locale, key));
}

/** 캐릭터 시트 템플릿 — 속성 4개(영문 키)와 빈 섹션. */
export function characterSheetMarkdown(locale: WorkLocale): string {
  const title = workNames(locale).characterSheet;
  const sections = characterSections(locale).map((s) => `## ${s}`).join('\n\n');
  return `---\nname:\nrole:\nage:\nfirst_appears:\n---\n# ${title}\n\n${sections}\n`;
}

/** 회차 템플릿 — 빈 제목 한 줄만. `goal_chars` 는 넣지 않는다(사용자가 목표를 정할 때만 기록). */
export function episodeMarkdown(locale: WorkLocale): string {
  return `# ${workNames(locale).episode}\n`;
}

/** 세계관·복선 템플릿 — 빈 섹션 두 개. */
export function worldbuildingMarkdown(locale: WorkLocale): string {
  return `# ${workNames(locale).worldbuilding}\n\n## ${translate(locale, 'work.section.world')}\n\n## ${translate(locale, 'work.section.foreshadowing')}\n`;
}

export interface WorkPlan {
  /** 검증을 통과한 작품 이름(= 볼트 루트의 폴더 이름) */
  name: string;
  folders: string[];
  files: { path: string; content: string }[];
}

export type WorkNameError = 'empty' | 'tooLong' | 'badChars';

/**
 * 작품 이름 검증. 폴더 이름 하나라 경로 구분자·`..`·예약 문자를 거부하고, 앞뒤 공백은 다듬는다.
 * 문제가 없으면 null.
 */
export function validateWorkName(raw: string): WorkNameError | null {
  const name = raw.trim();
  if (!name) return 'empty';
  if (name.length > 80) return 'tooLong';
  // 경로 구분자·윈도우 예약 문자·제어 문자, 그리고 '.'/'..' 같은 상대 경로 조각 금지
  // eslint-disable-next-line no-control-regex -- 제어 문자를 이름에서 막는다
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name)) return 'badChars';
  if (name === '.' || name === '..' || name.includes('..')) return 'badChars';
  if (name.endsWith('.')) return 'badChars';
  return null;
}

/**
 * 작품 생성 계획. 이름이 잘못되면 `null`(호출자가 오류 문구를 고른다).
 * 계획은 만들기만 하고 아무것도 쓰지 않는다(중복 확인은 호출자 몫).
 */
export function workPlan(rawName: string, locale: WorkLocale): WorkPlan | null {
  if (validateWorkName(rawName) !== null) return null;
  const name = rawName.trim();
  const names = workNames(locale);
  const folders = [name, `${name}/${names.episodes}`, `${name}/${names.characters}`, `${name}/${names.storyBible}`, `${name}/${names.templates}`];
  const files = [
    { path: `${name}/${names.templates}/${names.characterSheet}.md`, content: characterSheetMarkdown(locale) },
    { path: `${name}/${names.templates}/${names.episode}.md`, content: episodeMarkdown(locale) },
    { path: `${name}/${names.templates}/${names.worldbuilding}.md`, content: worldbuildingMarkdown(locale) },
  ];
  return { name, folders, files };
}

/** 템플릿 선택기에서 작품 템플릿만 골라내는 데 쓰는 하위 폴더 이름들(두 언어 모두). */
export function workTemplateFolders(): string[] {
  return [translate('ko', 'work.folder.templates'), translate('en', 'work.folder.templates')];
}

/** 노트 경로가 작품 템플릿(`<작품>/템플릿/…` 또는 `<작품>/Templates/…`)인지. */
export function isWorkTemplatePath(path: string): boolean {
  const parts = path.split('/');
  return parts.length >= 3 && workTemplateFolders().includes(parts[1] ?? '');
}
