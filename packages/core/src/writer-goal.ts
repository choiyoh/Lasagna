import { splitFrontmatter } from './markdown/frontmatter.js';

/** 문서 목표 글자수를 담는 노트 속성 키(언어와 무관한 영문 키). */
export const GOAL_CHARS_KEY = 'goal_chars';

/** `goal_chars:` / `"goal_chars":` / `'goal_chars':` 줄을 찾는다(중복이면 첫 줄만). */
const GOAL_LINE = /^([ \t]*)(?:"goal_chars"|'goal_chars'|goal_chars)[ \t]*:(.*)$/;

interface FrontmatterBlock {
  /** 여는 `---` 줄부터 닫는 `---` 줄 끝(줄바꿈 포함)까지의 원문 */
  raw: string;
  /** 닫는 `---` 줄 시작 오프셋(원문 기준) */
  closeAt: number;
  /** 여는 줄 뒤(YAML 본문 시작) 오프셋 */
  bodyAt: number;
}

/** 프런트매터 블록의 위치를 **문자열 그대로** 찾는다(YAML 재직렬화 없음). */
function locateFrontmatter(source: string): FrontmatterBlock | null {
  const fm = splitFrontmatter(source);
  if (!fm) return null;
  const raw = fm.raw;
  const eol = raw.startsWith('---\r\n') ? '\r\n' : '\n';
  const closeAt = raw.lastIndexOf('---');
  const bodyAt = raw.indexOf(eol) + eol.length;
  return { raw, closeAt, bodyAt };
}

/** 값 부분에서 인라인 주석(` #…`)을 떼어 낸다(따옴표 안의 # 은 값으로 본다). */
function splitComment(value: string): { value: string; comment: string } {
  let quote: string | null = null;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charAt(i);
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(value.charAt(i - 1)))) {
      return { value: value.slice(0, i), comment: value.slice(i) };
    }
  }
  return { value, comment: '' };
}

/**
 * 노트 원문의 목표 글자수를 설정/삭제한다(null 이면 속성 삭제).
 *
 * **YAML 을 다시 쓰지 않고 텍스트 수준으로 `goal_chars` 한 줄만** 삽입/치환/삭제한다. 따라서
 * 다른 속성의 서식(인라인 배열 `[작품]`, 따옴표, 주석, 들여쓰기, 키 순서)과 본문 바이트,
 * 줄바꿈(CRLF/LF), 마지막 줄바꿈 여부가 그대로 남는다. 값이 그대로면 원문을 바꾸지 않는다.
 */
export function withGoalChars(content: string, goal: number | null): string {
  const value = goal !== null && Number.isFinite(goal) && goal > 0 ? Math.floor(goal) : null;
  const block = locateFrontmatter(content);
  const eol = block ? (block.raw.startsWith('---\r\n') ? '\r\n' : '\n') : content.includes('\r\n') ? '\r\n' : '\n';

  // 프런트매터가 없으면: 목표를 정할 때만 맨 앞에 한 블록을 만든다(본문은 그대로).
  if (!block) {
    if (value === null) return content;
    return `---${eol}${GOAL_CHARS_KEY}: ${value}${eol}---${eol}${content}`;
  }

  const yamlText = block.raw.slice(block.bodyAt, block.closeAt);
  const lines = yamlText.split(/\r?\n/); // 마지막 원소는 닫는 줄 앞의 빈 조각일 수 있다
  const lineEol = block.raw.includes('\r\n') ? '\r\n' : '\n';
  const findIndex = lines.findIndex((line) => GOAL_LINE.test(line));
  const nextLines = [...lines];
  let changed = false;

  if (findIndex >= 0) {
    const match = GOAL_LINE.exec(nextLines[findIndex] ?? '');
    if (match) {
      if (value === null) {
        nextLines.splice(findIndex, 1);
        changed = true;
      } else {
        const { comment } = splitComment(match[2] ?? '');
        const current = (splitComment(match[2] ?? '').value ?? '').trim();
        if (current !== String(value) || comment) {
          // 값만 바꾸고 인라인 주석은 그 자리에 남긴다.
          nextLines[findIndex] = `${match[1]}${match[0].trimStart().startsWith('"') ? '"goal_chars"' : match[0].trimStart().startsWith("'") ? "'goal_chars'" : GOAL_CHARS_KEY}: ${value}${comment ? ` ${comment}` : ''}`;
          changed = true;
        }
      }
    }
  } else if (value !== null) {
    // YAML 마지막 줄 뒤(닫는 줄 앞)에 한 줄 추가. 기존 줄 서식은 건드리지 않는다.
    const insertAt = nextLines.length > 0 && nextLines[nextLines.length - 1] === '' ? nextLines.length - 1 : nextLines.length;
    nextLines.splice(insertAt, 0, `${GOAL_CHARS_KEY}: ${value}`);
    changed = true;
  }

  if (!changed) return content;

  let nextYaml = nextLines.join(lineEol);
  // 남은 속성이 없으면 빈 프런트매터(`---\n{}\n---`)를 만들지 않고 블록째 없앤다.
  const empty = nextYaml.replace(/\s+/g, '') === '';
  if (empty) {
    const rest = content.slice(block.raw.length);
    return rest;
  }
  const open = block.raw.slice(0, block.bodyAt);
  const close = block.raw.slice(block.closeAt);
  nextYaml = nextYaml.replace(/\r?\n$/, '');
  return `${open}${nextYaml}${lineEol}${close}${content.slice(block.raw.length)}`;
}

/**
 * 노트 원문의 목표 글자수. 없거나 숫자가 아니거나 0 이하이면 `null`(목표 없음).
 * 원문은 읽기만 하고 바꾸지 않는다.
 */
export function readGoalChars(content: string): number | null {
  const fm = splitFrontmatter(content);
  const raw = fm?.data?.[GOAL_CHARS_KEY];
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}
