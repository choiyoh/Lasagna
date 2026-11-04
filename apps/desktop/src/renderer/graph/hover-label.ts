/**
 * hover 중인 노드의 기본 라벨은 그리지 않는다.
 * sigma 는 같은 노드의 기본 라벨 위에 호버 라벨을 위치·크기를 조금 바꿔 한 번 더 그려서
 * 글자가 겹쳐(고스트) 보인다. 호버 라벨만 남기면 강조는 그대로고 겹침만 사라진다.
 */
export function drawsBaseLabel(nodeId: string, hoveredNodeId: string | null): boolean {
  return nodeId !== hoveredNodeId;
}
