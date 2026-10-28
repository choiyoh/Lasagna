import { defaultServerName, type McpClientId } from './mcp-snippet';

export interface McpSettingsConfig {
  write: boolean;
  folder: string;
  allowDailyFolder: boolean;
  name: string;
  client: McpClientId;
}

/** 예전 전역 키. 볼트 id 가 없던 시절 설정은 볼트별 설정이 없을 때 기본값으로 물려받는다. */
export const LEGACY_KEY = 'nops.mcp';
/** 볼트별 설정 키 접두사. 두 볼트를 오가도 이름·폴더가 섞이지 않는다. */
export const KEY_PREFIX = 'nops.mcp.v2.';

export const storageKey = (vaultId: string) => `${KEY_PREFIX}${vaultId}`;

type Store = Pick<Storage, 'getItem' | 'setItem'>;
type ReadStore = Pick<Storage, 'length' | 'key' | 'getItem'>;

const CLIENT_IDS: McpClientId[] = ['claude-code', 'claude-desktop', 'codex', 'cursor', 'vscode', 'gemini-cli'];

const parse = (raw: string | null): Partial<McpSettingsConfig> | null => {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<McpSettingsConfig>;
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
};

const normalize = (v: Partial<McpSettingsConfig> | null, vaultName: string, vaultId: string): McpSettingsConfig => ({
  write: !!v?.write,
  folder: typeof v?.folder === 'string' ? v.folder : 'AI',
  allowDailyFolder: !!v?.allowDailyFolder,
  name: typeof v?.name === 'string' && v.name.trim() ? v.name.trim() : defaultServerName({ vaultName, vaultId }),
  client: CLIENT_IDS.includes(v?.client as McpClientId) ? (v!.client as McpClientId) : 'claude-code',
});

/** 이 볼트의 설정을 읽는다. 볼트별 설정이 없으면 예전 전역 설정을 한 번 물려받는다. */
export function loadMcpSettings(vaultId: string, vaultName: string, storage: Store = localStorage): McpSettingsConfig {
  const own = parse(storage.getItem(storageKey(vaultId)));
  return normalize(own ?? parse(storage.getItem(LEGACY_KEY)), vaultName, vaultId);
}

/** 이 볼트의 설정만 저장한다. 저장 못 해도(사생활 보호 모드 등) 이번 실행에는 적용된다. */
export function saveMcpSettings(vaultId: string, cfg: McpSettingsConfig, storage: Store = localStorage): void {
  try {
    storage.setItem(storageKey(vaultId), JSON.stringify(cfg));
  } catch {
    /* 저장 못 해도 이번 실행에는 적용된다 */
  }
}

/** 다른 볼트의 설정이 같은 서버 이름을 쓰고 있는가. 이름을 바꾸기 전에 경고하는 데 쓴다. */
export function serverNameConflict(name: string, vaultId: string, storage: ReadStore = localStorage): boolean {
  const wanted = name.trim();
  if (!wanted) return false;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(KEY_PREFIX) || key === storageKey(vaultId)) continue;
    if (parse(storage.getItem(key))?.name?.trim() === wanted) return true;
  }
  return false;
}
