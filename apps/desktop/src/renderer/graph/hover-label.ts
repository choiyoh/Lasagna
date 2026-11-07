/**
 * hover 중인 노드의 기본 라벨은 그리지 않는다.
 * sigma 는 같은 노드의 기본 라벨 위에 호버 라벨을 위치·크기를 조금 바꿔 한 번 더 그려서
 * 글자가 겹쳐(고스트) 보인다. 호버 라벨만 남기면 강조는 그대로고 겹침만 사라진다.
 */
export function drawsBaseLabel(nodeId: string, hoveredNodeId: string | null): boolean {
  return nodeId !== hoveredNodeId;
}

/**
 * canvas 밖으로 나가면 hover 를 지운다. 중간 mousemove(leaveNode) 없이 바로 나가면
 * sigma.hoveredNode 가 남아 라벨이 겹친 채로 남는다.
 */
export function clearHover(
  refs: { hover: { current: string | null }; hoverNode: { current: string | null } },
  refresh: () => void,
): void {
  const had = refs.hoverNode.current !== null;
  resetHover(refs);
  if (had) refresh();
}

/** sigma 의 enter/leave 배선. 지우면 hover 라벨이 겹쳐 보인다(테스트가 이 배선을 검사한다). */
export function wireHover<Sigma extends { on(event: 'enterNode' | 'leaveNode', fn: (e: { node: string }) => void): unknown }>(
  sigma: Sigma,
  refs: { hover: { current: string | null }; hoverNode: { current: string | null } },
  refresh: () => void,
): void {
  sigma.on('enterNode', ({ node }) => {
    refs.hover.current = node;
    refs.hoverNode.current = node;
    refresh();
  });
  sigma.on('leaveNode', () => {
    refs.hover.current = null;
    refs.hoverNode.current = null;
    refresh();
  });
}

/**
 * 라벨이 오른쪽으로 잘리지 않게 x 를 당긴다(노드 위치·물리·레이아웃은 건드리지 않는다).
 * 오른쪽 여백이 모자라면 노드 왼쪽에 붙인다.
 */
export function clampLabelX(x: number, textWidth: number, rightEdge: number, leftEdge: number, gap = 8): number {
  if (x + textWidth <= rightEdge - gap) return x;
  const left = leftEdge + gap;
  return Math.max(left, rightEdge - gap - textWidth);
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
