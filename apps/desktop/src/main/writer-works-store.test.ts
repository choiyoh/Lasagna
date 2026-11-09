import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WriterWorksStore } from './writer-works-store.js';

const file = () => path.join(mkdtempSync(path.join(tmpdir(), 'works-')), 'writer-works.json');
const goal = { episodes: 80, perEpisode: 4000, basis: 'include' as const, deadline: '2026-12-31', preset: 'naver' as const };

describe('작품 목표 저장소', () => {
  it('볼트·작품별로 저장하고 다시 읽는다(원자적 파일)', () => {
    const f = file();
    const store = new WriterWorksStore(f);
    store.set('v1', '달빛', goal);
    store.set('v2', 'Moon', { ...goal, basis: 'exclude', preset: 'ridi' });
    const reopened = new WriterWorksStore(f);
    expect(reopened.all('v1')).toEqual({ 달빛: goal });
    expect(reopened.all('v2').Moon?.basis).toBe('exclude');
    expect(JSON.parse(readFileSync(f, 'utf8')).version).toBe(1);
  });

  it('null 은 삭제, 없는 파일·깨진 파일은 빈 값', () => {
    const f = file();
    const store = new WriterWorksStore(f);
    expect(store.all('v1')).toEqual({});
    store.set('v1', 'A', goal);
    expect(store.set('v1', 'A', null)).toEqual({});
    writeFileSync(f, '{ 깨짐');
    expect(new WriterWorksStore(f).all('v1')).toEqual({});
  });

  it('형식이 틀린 목표는 읽지 않는다', () => {
    const f = file();
    writeFileSync(f, JSON.stringify({ version: 1, vaults: { v1: { bad: { episodes: 'x' }, good: goal } } }));
    expect(new WriterWorksStore(f).all('v1')).toEqual({ good: goal });
  });
});
