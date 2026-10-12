import { parse as parseYaml } from 'yaml';
import type { Frontmatter } from './types.js';

// 문서 맨 앞의 `---` … `---` (닫는 줄 뒤 줄바꿈 포함)
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(source: string): Frontmatter | null {
  const m = FRONTMATTER.exec(source);
  if (!m) return null;
  const raw = m[0];
  const yamlText = m[1] ?? '';
  try {
    const data = parseYaml(yamlText);
    const isObj = data !== null && typeof data === 'object' && !Array.isArray(data);
    return { raw, data: isObj ? (data as Record<string, unknown>) : {}, end: raw.length };
  } catch (e) {
    return { raw, data: {}, end: raw.length, error: e instanceof Error ? e.message : String(e) };
  }
}

export function asStringList(v: unknown): string[] {
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean);
  return [];
}
