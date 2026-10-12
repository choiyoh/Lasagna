import { defineConfig } from 'vite';
import { EXTERNAL_NATIVE } from './native-modules';

// 네이티브 모듈은 번들하지 않고 런타임에 require 한다.
export default defineConfig({
  build: { rollupOptions: { external: EXTERNAL_NATIVE } },
  resolve: { mainFields: ['module', 'jsnext:main', 'jsnext'] },
});
