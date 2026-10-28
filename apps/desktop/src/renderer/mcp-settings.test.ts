import { describe, expect, it } from 'vitest';
import { KEY_PREFIX, LEGACY_KEY, configFromPolicy, loadMcpSettings, policyFolders, saveMcpSettings, serverNameConflict, storageKey, type McpSettingsConfig } from './mcp-settings';
import { defaultServerName, type McpClientId } from './mcp-snippet';

class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const cfg = (over: Partial<McpSettingsConfig> = {}): McpSettingsConfig => ({
  write: true,
  folder: 'AI',
  allowDailyFolder: true,
  maxWritesPerMinute: 30,
  name: 'nopsidian-a',
  client: 'codex',
  ...over,
});

describe('볼트별 MCP 설정', () => {
  it('같은 기기에서도 볼트마다 설정이 따로 저장된다', () => {
    const store = new MemoryStorage();
    saveMcpSettings('vault-a', cfg({ name: 'nopsidian-a', folder: 'AI' }), store);
    saveMcpSettings('vault-b', cfg({ name: 'nopsidian-b', folder: '메모', write: false }), store);
    expect(loadMcpSettings('vault-a', 'A', store)).toMatchObject({ name: 'nopsidian-a', folder: 'AI', write: true });
    expect(loadMcpSettings('vault-b', 'B', store)).toMatchObject({ name: 'nopsidian-b', folder: '메모', write: false });
    expect(store.getItem(storageKey('vault-a'))).not.toBe(store.getItem(storageKey('vault-b')));
  });

  it('설정이 없는 볼트는 기본값(읽기 전용, AI, Claude Code)을 쓴다', () => {
    const got = loadMcpSettings('vault-new', 'Work Notes', new MemoryStorage());
    expect(got).toEqual({
      write: false,
      folder: 'AI',
      allowDailyFolder: false,
      maxWritesPerMinute: 30,
      name: defaultServerName({ vaultName: 'Work Notes', vaultId: 'vault-new' }),
      client: 'claude-code',
    });
  });

  it('예전 전역 설정은 처음 연 볼트 하나에만 옮긴다', () => {
    const store = new MemoryStorage();
    store.setItem(LEGACY_KEY, JSON.stringify({ write: true, folder: '옛 폴더' }));
    expect(loadMcpSettings('vault-a', 'A', store)).toMatchObject({ write: true, folder: '옛 폴더', name: defaultServerName({ vaultName: 'A', vaultId: 'vault-a' }) });
    // 옮긴 뒤 전역 키는 지운다
    expect(store.getItem(LEGACY_KEY)).toBeNull();
    expect(loadMcpSettings('vault-a', 'A', store)).toMatchObject({ write: true, folder: '옛 폴더' });
    // 새 볼트는 전역 쓰기 설정을 물려받지 않고 읽기 전용으로 시작한다
    expect(loadMcpSettings('vault-b', 'B', store)).toMatchObject({ write: false, folder: 'AI' });
    saveMcpSettings('vault-a', cfg({ folder: '새 폴더' }), store);
    expect(loadMcpSettings('vault-a', 'A', store).folder).toBe('새 폴더');
  });

  it('볼트별 설정이 이미 있어도 전역 설정이 새 볼트로 새지 않는다', () => {
    const store = new MemoryStorage();
    saveMcpSettings('vault-a', cfg({ write: false, folder: 'AI' }), store);
    store.setItem(LEGACY_KEY, JSON.stringify({ write: true, folder: '옛 폴더' }));
    // 이 볼트는 자기 설정을 그대로 쓰고, 남은 전역 설정은 정리한다
    expect(loadMcpSettings('vault-a', 'A', store)).toMatchObject({ write: false, folder: 'AI' });
    expect(store.getItem(LEGACY_KEY)).toBeNull();
    // 나중에 처음 여는 볼트도 전역 write 값을 물려받지 않는다
    expect(loadMcpSettings('vault-c', 'C', store)).toMatchObject({ write: false, folder: 'AI' });
  });

  it('전역 키를 지울 수 없어도 마이그레이션은 한 번만 한다', () => {
    const map = new Map<string, string>([[LEGACY_KEY, JSON.stringify({ write: true, folder: '옛 폴더' })]]);
    const store = {
      get length() {
        return map.size;
      },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
    expect(loadMcpSettings('vault-a', 'A', store as unknown as Storage)).toMatchObject({ write: true, folder: '옛 폴더' });
    expect(loadMcpSettings('vault-b', 'B', store as unknown as Storage)).toMatchObject({ write: false, folder: 'AI' });
  });

  it('망가진 설정·알 수 없는 클라이언트는 기본값으로 되돌린다', () => {
    const store = new MemoryStorage();
    store.setItem(storageKey('vault-a'), '{망가짐');
    expect(loadMcpSettings('vault-a', 'A', store)).toMatchObject({ write: false, client: 'claude-code' });
    store.setItem(storageKey('vault-a'), JSON.stringify({ ...cfg(), client: '없는클라이언트' }));
    expect(loadMcpSettings('vault-a', 'A', store).client).toBe('claude-code');
    store.setItem(storageKey('vault-a'), JSON.stringify({ ...cfg(), name: '   ' }));
    expect(loadMcpSettings('vault-a', 'A', store).name).toBe(defaultServerName({ vaultName: 'A', vaultId: 'vault-a' }));
  });

  it('저장이 막혀도(사생활 보호 모드) 예외를 던지지 않는다', () => {
    const store = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    expect(() => saveMcpSettings('vault-a', cfg(), store as unknown as Storage)).not.toThrow();
  });
});

describe('앱 정책 파일 ↔ 화면 값', () => {
  it('정책의 폴더 목록을 단일 폴더·오늘의 노트 체크로 되돌린다', () => {
    expect(configFromPolicy({ write: true, writeFolders: ['AI', '일기'], maxWritesPerMinute: 12 }, '일기')).toEqual({
      write: true,
      folder: 'AI',
      allowDailyFolder: true,
      maxWritesPerMinute: 12,
    });
    expect(configFromPolicy({ write: true, writeFolders: ['AI'], maxWritesPerMinute: 30 }, '일기')).toMatchObject({ folder: 'AI', allowDailyFolder: false });
    expect(configFromPolicy({ write: true, writeFolders: [''], maxWritesPerMinute: 30 }, '일기')).toMatchObject({ folder: '.', allowDailyFolder: true });
    expect(configFromPolicy({ write: false, writeFolders: ['메모', '일기'], maxWritesPerMinute: 5 }, '일기')).toMatchObject({ write: false, folder: '메모', allowDailyFolder: true });
  });

  it('화면 값을 정책 파일의 폴더 목록으로 바꾸고 덮이는 데일리 폴더는 뺀다', () => {
    expect(policyFolders('AI', true, '일기')).toEqual(['AI', '일기']);
    expect(policyFolders('', true, '일기')).toEqual(['']);
    expect(policyFolders('.', true, '일기')).toEqual(['']);
    expect(policyFolders('Daily', true, 'Daily/2026')).toEqual(['Daily']);
    expect(policyFolders('AI/', false, '일기')).toEqual(['AI']);
  });
});

describe('서버 이름 충돌', () => {
  it('다른 볼트가 같은 이름을 쓰면 충돌로 본다', () => {
    const store = new MemoryStorage();
    saveMcpSettings('vault-a', cfg({ name: 'nopsidian-shared' }), store);
    saveMcpSettings('vault-b', cfg({ name: 'nopsidian-other' }), store);
    expect(serverNameConflict('nopsidian-shared', 'vault-b', store)).toBe(true);
    expect(serverNameConflict('nopsidian-other', 'vault-b', store)).toBe(false);
    expect(serverNameConflict('nopsidian-없음', 'vault-b', store)).toBe(false);
  });

  it('자기 볼트 설정은 충돌로 보지 않는다', () => {
    const store = new MemoryStorage();
    saveMcpSettings('vault-a', cfg({ name: 'nopsidian-shared' }), store);
    expect(serverNameConflict('nopsidian-shared', 'vault-a', store)).toBe(false);
  });

  it('이름이 비었거나 설정 키가 아니면 무시한다', () => {
    const store = new MemoryStorage();
    store.setItem('다른 키', JSON.stringify({ name: 'nopsidian-shared' }));
    store.setItem(`${KEY_PREFIX}broken`, '{');
    expect(serverNameConflict('', 'vault-a', store)).toBe(false);
    expect(serverNameConflict('nopsidian-shared', 'vault-a', store)).toBe(false);
  });

  it('클라이언트 id 는 알려진 6종만 받는다', () => {
    const ids: McpClientId[] = ['claude-code', 'claude-desktop', 'codex', 'cursor', 'vscode', 'gemini-cli'];
    expect(ids).toHaveLength(6);
  });
});
