import { defineConfig } from 'vite';
import { EXTERNAL_NATIVE } from './native-modules';

// IndexWorker는 main 번들과 같은 디렉터리에 index-worker.js 로 출력된다.
export default defineConfig({
  build: { rollupOptions: { external: EXTERNAL_NATIVE } },
});
