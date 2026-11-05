/**
 * hover 중인 노드의 기본 라벨은 그리지 않는다.
 * sigma 는 같은 노드의 기본 라벨 위에 호버 라벨을 위치·크기를 조금 바꿔 한 번 더 그려서
 * 글자가 겹쳐(고스트) 보인다. 호버 라벨만 남기면 강조는 그대로고 겹침만 사라진다.
 */
export function drawsBaseLabel(nodeId: string, hoveredNodeId: string | null): boolean {
  return nodeId !== hoveredNodeId;
}

/** 그래프를 다시 만들 때(데이터·필터 변경) 이전 hover 를 지운다. 새 sigma 에는 hover 가 없다. */
export function resetHover(refs: {
  hover: { current: string | null };
  hoverNode: { current: string | null };
}): void {
  refs.hover.current = null;
  refs.hoverNode.current = null;
}

/**
 * sigma 의 기본 라벨 그리기를 감싸, hover 중인 노드만 건너뛴다.
 * hover 판정은 호출 시점에 읽으므로 렌더 사이에 hover 가 바뀌어도 따라간다.
 */
export function drawBaseLabelUnlessHovered<Ctx, Data, Settings>(
  hoveredNodeId: () => string | null,
  draw: (ctx: Ctx, data: Data, settings: Settings) => void,
): (ctx: Ctx, data: Data, settings: Settings) => void {
  return (ctx, data, settings) => {
    const key = (data as { key?: string }).key;
    if (key && !drawsBaseLabel(key, hoveredNodeId())) return;
    draw(ctx, data, settings);
  };
}
