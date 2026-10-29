export interface GdriveBuildClient {
  clientId: string;
  clientSecret: string;
  source: 'env' | 'file' | 'mixed' | 'none';
  file: string | null;
}
export function parseEnv(text: string): Record<string, string>;
export function findGdriveEnvFile(cwd?: string): string | null;
export function loadGdriveClient(options?: { cwd?: string; env?: NodeJS.ProcessEnv }): GdriveBuildClient;
export function gdriveSourceLabel(info: GdriveBuildClient): string;
