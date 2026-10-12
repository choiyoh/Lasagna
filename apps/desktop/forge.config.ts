import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { copyNativeModules } from './native-modules';

const config: ForgeConfig = {
  packagerConfig: {
    // .node 바이너리는 asar 밖으로 풀어야 로드할 수 있다.
    asar: { unpack: '**/*.node' },
    name: 'Nopsidian',
    executableName: 'nopsidian',
  },
  // better-sqlite3(N-API prebuild)와 @parcel/watcher(플랫폼별 prebuilt 패키지)는 Electron 헤더로 재빌드하지 않는다.
  rebuildConfig: { onlyModules: [] },
  hooks: {
    // Vite 플러그인은 .vite/ 외에는 패키징하지 않으므로 external 네이티브 모듈을 직접 복사한다.
    packageAfterCopy: async (_config, buildPath) => {
      copyNativeModules(buildPath, process.cwd());
    },
  },
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/main.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/preload/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
        { entry: 'src/workers/index/index-worker.ts', config: 'vite.worker.config.ts', target: 'main' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      // Playwright가 Electron에 붙으려면 inspect 인자가 필요하다. E2E 전용 빌드(NOPS_E2E=1)에서만 연다.
      [FuseV1Options.EnableNodeCliInspectArguments]: process.env.NOPS_E2E === '1',
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    }),
  ],
};

export default config;
