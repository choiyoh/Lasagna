/**
 * e2e 전용 **백그라운드 모드** 판정.
 *
 * 두 조건을 모두 만족해야 켜진다.
 * 1. **빌드 시점 플래그** `__NOPS_E2E_BUILD__` — e2e 빌드(`NOPS_E2E=1 electron-forge package/make`)에서만 true,
 *    배포 빌드는 false 로 치환된다. 사용자가 셸에서 `NOPS_E2E=1` 을 주고 배포 앱을 실행해도 켜지지 않는다.
 * 2. 런타임 `NOPS_E2E=1` 이고 `NOPS_E2E_BACKGROUND` 가 `0` 이 아닐 것(기본 켜짐).
 *
 * 배포 앱 동작(창·포커스·독)은 전혀 바뀌지 않는다.
 */
declare const __NOPS_E2E_BUILD__: boolean;

/** 빌드 상수(테스트에서는 인자로 바꿔 넣을 수 있다). */
function buildFlag(): boolean {
  try {
    return typeof __NOPS_E2E_BUILD__ === 'boolean' ? __NOPS_E2E_BUILD__ : false;
  } catch {
    // 상수가 치환되지 않은 환경(단위 테스트 등)
    return false;
  }
}

export function e2eBackground(env: NodeJS.ProcessEnv = process.env, buildE2e: boolean = buildFlag()): boolean {
  if (!buildE2e) return false;
  if (env.NOPS_E2E !== '1') return false;
  return env.NOPS_E2E_BACKGROUND !== '0';
}
