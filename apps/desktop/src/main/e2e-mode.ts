/**
 * e2e 전용 **백그라운드 모드** 판정. 테스트 빌드(`NOPS_E2E=1`)에서만 켜지고,
 * 배포 앱에서는 항상 false 다 — 창·포커스·독 동작이 그대로다.
 *
 * 기본값은 켜짐(창을 화면에 띄우지 않아 사용자가 쓰는 화면을 가로채지 않는다).
 * 포커스가 꼭 필요한 스펙은 `NOPS_E2E_BACKGROUND=0`(=`pnpm e2e:fg`)으로 실행한다.
 */
export function e2eBackground(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NOPS_E2E !== '1') return false;
  return env.NOPS_E2E_BACKGROUND !== '0';
}
