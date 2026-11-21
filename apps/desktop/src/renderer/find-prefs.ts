/**
 * 찾기 막대의 '조사 맞추기' 선택(localStorage). 기기별 설정이고 볼트에는 쓰지 않는다.
 * 기본은 켜짐 — 끄면 찾기·바꾸기가 조사를 맞추지 않고 예전과 똑같이 동작한다.
 */
const KEY = 'nops.find.particles';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function loadFindParticles(storage: Store = localStorage): boolean {
  try {
    return storage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveFindParticles(on: boolean, storage: Store = localStorage): void {
  try {
    storage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* 저장 못 해도 이번 실행에는 적용된다 */
  }
}
