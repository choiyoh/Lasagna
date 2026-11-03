import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  NOTE_COLOR_DARK,
  NOTE_COLOR_LIGHT,
  TAG_COLOR_DARK,
  TAG_COLOR_LIGHT,
} from './graph/palette';
import { ThemeMonitorIcon, ThemeMoonIcon, ThemeSunIcon } from './icons';
import { THEME_ICON } from './theme';

/**
 * 테마 토큰의 대비를 실제 styles.css에서 다시 계산한다.
 * 제안서 수치를 복사하지 않고 파일이 바뀌면 테스트가 같이 깨지도록 한다.
 */
const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');

type Tokens = Record<string, string>;

/** selector 뒤의 첫 블록 내용을 중괄호 깊이로 잘라 낸다. */
function blockOf(source: string, selector: string): string {
  const start = source.indexOf(selector);
  if (start < 0) throw new Error(`셀렉터를 찾지 못함: ${selector}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`닫히지 않은 블록: ${selector}`);
}

function tokensOf(source: string, selector: string): Tokens {
  const tokens: Tokens = {};
  for (const match of blockOf(source, selector).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[match[1]!] = match[2]!.trim();
  }
  return tokens;
}

const light = tokensOf(css, ':root {');

const darkMediaBlock = blockOf(css, '@media (prefers-color-scheme: dark) {');
const darkMedia = tokensOf(darkMediaBlock, ":root:not([data-theme='light'])");
const darkExplicit = tokensOf(css, ":root[data-theme='dark']");

type Rgb = [number, number, number];

function hex(value: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) throw new Error(`hex 색이 아님: ${value}`);
  const n = Number.parseInt(match[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(color: string): number {
  const [r, g, b] = hex(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** color-mix(in srgb, accent alpha%, transparent) 를 배경 위에 합성한 불투명 색. */
function mixOver(background: string, foreground: string, alpha: number): string {
  const bg = hex(background);
  const fg = hex(foreground);
  const [r, g, b] = bg.map((v, i) => Math.round(v + (fg[i]! - v) * alpha)) as Rgb;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function expectTokens(name: string, tokens: Tokens) {
  const need = (key: string) => {
    const value = tokens[key];
    if (!value) throw new Error(`${name}에 --${key} 가 없음`);
    return value;
  };
  // 대비 기준은 4.5:1 — accent·muted 는 13px 텍스트로도 쓰인다.
  expect(contrast(need('fg'), need('bg')), `${name} fg/bg`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(need('muted'), need('bg-side')), `${name} muted/bg-side`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(need('accent'), need('bg')), `${name} accent/bg`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(need('on-accent'), need('accent')), `${name} on-accent/accent`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(need('danger'), need('bg')), `${name} danger/bg`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(need('warn'), need('bg')), `${name} warn/bg`).toBeGreaterThanOrEqual(4.5);
  // 사이드바 선택 행: accent 18% 를 bg-side 위에 얹고 accent 글자를 읽는다.
  const selected = mixOver(need('bg-side'), need('accent'), 0.18);
  expect(contrast(need('accent'), selected), `${name} accent/선택 배경`).toBeGreaterThanOrEqual(4.5);
}

describe('테마 토큰 대비', () => {
  it('라이트 토큰이 4.5:1 을 넘는다', () => {
    expectTokens('light', light);
  });

  it('OS 다크 토큰과 명시적 다크 토큰이 각각 4.5:1 을 넘는다', () => {
    expectTokens('dark(media)', darkMedia);
    expectTokens('dark(data-theme)', darkExplicit);
  });

  it('다크 미디어 블록과 data-theme 블록의 값이 같다', () => {
    expect(darkMedia).toEqual(darkExplicit);
  });

  it('error/warn 토큰이 새 배경에서 4.5:1 을 넘는다', () => {
    expect(contrast(light.danger!, light.bg!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.danger!, light['bg-side']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.warn!, light.bg!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.warn!, light['bg-side']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkExplicit.danger!, darkExplicit.bg!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkExplicit.danger!, darkExplicit['bg-side']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkExplicit.warn!, darkExplicit.bg!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkExplicit.warn!, darkExplicit['bg-side']!)).toBeGreaterThanOrEqual(4.5);
  });

  it('그래프 note/tag 의미색이 배경에서 구분되고 라벨은 본문색으로 읽힌다', () => {
    // note/unresolved 는 노드 채움(그래픽)이고, 라벨 글자는 fg 로 그린다.
    expect(contrast(NOTE_COLOR_LIGHT, light.bg!)).toBeGreaterThanOrEqual(3);
    expect(contrast(TAG_COLOR_LIGHT, light.bg!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(NOTE_COLOR_DARK, darkExplicit.bg!)).toBeGreaterThanOrEqual(3);
    expect(contrast(TAG_COLOR_DARK, darkExplicit.bg!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.fg!, light.bg!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkExplicit.fg!, darkExplicit.bg!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('테마 아이콘', () => {
  it('시스템/라이트/다크가 각각 monitor/sun/moon 아이콘을 가리킨다', () => {
    expect(THEME_ICON.system).toBe(ThemeMonitorIcon);
    expect(THEME_ICON.light).toBe(ThemeSunIcon);
    expect(THEME_ICON.dark).toBe(ThemeMoonIcon);
  });

  it('세 아이콘 모두 16px·24 viewBox·currentColor 라인 SVG로 렌더된다', () => {
    const render = (choice: keyof typeof THEME_ICON) => renderToStaticMarkup(createElement(THEME_ICON[choice], { size: 16 }));
    for (const choice of ['system', 'light', 'dark'] as const) {
      const html = render(choice);
      expect(html).toContain('viewBox="0 0 24 24"');
      expect(html).toContain('width="16"');
      expect(html).toContain('height="16"');
      expect(html).toContain('stroke="currentColor"');
      expect(html).toContain('stroke-width="2"');
      expect(html).toContain('aria-hidden="true"');
    }
    // 세 아이콘이 서로 다른 도형인지 확인한다
    expect(render('system')).toContain('<rect');
    expect(render('light')).toContain('<circle cx="12" cy="12" r="4"');
    expect(render('dark')).not.toContain('<rect');
    expect(render('dark').match(/<path/g)).toHaveLength(1);
  });
});
