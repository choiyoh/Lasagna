import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  // _electron 테스트는 Playwright 의 page 픽스처를 쓰지 않아 자동 스크린샷이 없다.
  // app.spec.ts 의 afterEach 가 실패 화면을 이 폴더에 남기고 CI 가 아티팩트로 올린다.
  outputDir: 'test-results',
});
