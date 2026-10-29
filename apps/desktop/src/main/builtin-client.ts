/**
 * 사용자 전용 빌드에만 주입되는 Google OAuth 클라이언트.
 * 값은 vite.main.config.ts 가 환경 변수나 git 제외 로컬 파일에서 읽어 define 으로 넣는다.
 * 이 파일은 main 번들에만 포함되고 renderer/preload 는 참조하지 않는다.
 */
export interface BuiltinClient {
  clientId: string;
  clientSecret?: string;
}

declare const __NOPS_GDRIVE_CLIENT_ID__: string;
declare const __NOPS_GDRIVE_CLIENT_SECRET__: string;

const clientId = typeof __NOPS_GDRIVE_CLIENT_ID__ === 'string' ? __NOPS_GDRIVE_CLIENT_ID__ : '';
const clientSecret = typeof __NOPS_GDRIVE_CLIENT_SECRET__ === 'string' ? __NOPS_GDRIVE_CLIENT_SECRET__ : '';

export const BUILTIN_CLIENT: BuiltinClient | null = clientId === '' ? null : { clientId, ...(clientSecret === '' ? {} : { clientSecret }) };
