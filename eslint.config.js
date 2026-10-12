import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: [
      '**/dist/**',
      '**/out/**',
      '**/.vite/**',
      'fixtures/**',
      '.scratch/**',
      // 업스트림(oh-new-editor)에는 lint 흐름이 없다. 우리가 고친 파일부터 점진적으로 켠다.
      'packages/editor/**',
    ] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
