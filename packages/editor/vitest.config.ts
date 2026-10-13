import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    css: true,
    // 퍼즈·합성 노트 테스트가 느린 CI 러너에서 기본 5초를 넘을 수 있다
    testTimeout: 30000
  }
});
