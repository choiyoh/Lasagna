/**
 * 앱의 `data-theme`(light/dark/system)과 OS 색상 설정을 함께 반영한 실제 테마.
 * 에디터 패키지는 앱 밖에서도 쓰이므로 document/window 가 없는 환경을 견딘다.
 */
export function isEffectiveDark(): boolean {
  if (typeof document === 'undefined') return false;
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || (t !== 'light' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
}

/** 앱 테마 변경(nops:theme)과 OS 테마 변경을 함께 구독한다. 반환값은 해제 함수. */
export function onEffectiveThemeChange(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('nops:theme', cb);
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  media?.addEventListener('change', cb);
  return () => {
    window.removeEventListener('nops:theme', cb);
    media?.removeEventListener('change', cb);
  };
}
