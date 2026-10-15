import { defineConfig } from 'vitest/config';

// 퍼즈·합성 데이터 테스트가 느린 CI 러너에서 기본 5초를 넘을 수 있다
export default defineConfig({ test: { testTimeout: 30000 } });
