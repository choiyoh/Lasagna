import { defineConfig } from 'vite';
import { EXTERNAL_NATIVE } from './native-modules';
import { gdriveSourceLabel, loadGdriveClient } from './scripts/gdrive-env.mjs';

const gdrive = loadGdriveClient();
if (gdrive.source !== 'none') console.log(`[gdrive] ${gdriveSourceLabel(gdrive)}`);

// 네이티브 모듈은 번들하지 않고 런타임에 require 한다.
// sourcemap 은 비밀 값이 별도 파일에 남지 않도록 끈다.
export default defineConfig({
  define: {
    __NOPS_GDRIVE_CLIENT_ID__: JSON.stringify(gdrive.clientId),
    __NOPS_GDRIVE_CLIENT_SECRET__: JSON.stringify(gdrive.clientSecret),
    // e2e 전용 빌드인지 — **빌드 시점**에만 정해진다(배포 빌드는 항상 false).
    // 런타임 환경변수만으로는 사용자가 NOPS_E2E=1 을 주고 배포 앱을 띄울 때 켜질 수 있어 AND 로 묶는다.
    __NOPS_E2E_BUILD__: JSON.stringify(process.env.NOPS_E2E === '1'),
  },
  build: { sourcemap: false, rollupOptions: { external: EXTERNAL_NATIVE } },
  resolve: { mainFields: ['module', 'jsnext:main', 'jsnext'] },
});
