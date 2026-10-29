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
  },
  build: { sourcemap: false, rollupOptions: { external: EXTERNAL_NATIVE } },
  resolve: { mainFields: ['module', 'jsnext:main', 'jsnext'] },
});
