/**
 * hover 중인 노드의 기본 라벨은 그리지 않는다.
 * sigma 는 같은 노드의 기본 라벨 위에 호버 라벨을 위치·크기를 조금 바꿔 한 번 더 그려서
 * 글자가 겹쳐(고스트) 보인다. 호버 라벨만 남기면 강조는 그대로고 겹침만 사라진다.
 */
export function drawsBaseLabel(nodeId: string, hoveredNodeId: string | null): boolean {
  return nodeId !== hoveredNodeId;
}

/** 화면의 sigma 중 hover 상태를 지우는 데 필요한 최소 표면(sigma 3 의 `hoveredNode` 는 런타임 공개). */
export interface HoverSigma {
  hoveredNode?: string | null;
  refresh?: (opts?: { skipIndexation?: boolean }) => void;
}

/**
 * canvas 밖으로 나가면 hover 를 지운다. 중간 mousemove(leaveNode) 없이 바로 나가면
 * **sigma 내부의 hoveredNode** 가 남아 라벨이 겹친 채로 남으므로 그것도 함께 지운다.
 */
export function clearHover(
  refs: { hover: { current: string | null }; hoverNode: { current: string | null } },
  sigma?: HoverSigma | null,
  refresh?: () => void,
): void {
  const had = refs.hoverNode.current !== null || (sigma?.hoveredNode ?? null) !== null;
  resetHover(refs);
  if (sigma?.hoveredNode != null) {
    // sigma 3.0.3 은 hover 상태를 내부 필드로 갖고 공개 setter 가 없다 — 값을 직접 비우고 다시 그린다.
    sigma.hoveredNode = null;
  }
  if (had) {
    if (refresh) refresh();
    else sigma?.refresh?.({ skipIndexation: true });
  }
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
 * 라벨 x 를 정한다. 노드 오른쪽에 두되 화면을 넘치면 **노드 왼쪽**으로 옮기고,
 * 양쪽 다 좁으면 가장자리 안쪽에 붙인다(노드·물리·레이아웃은 건드리지 않는다).
 */
export function labelX(opts: { nodeX: number; nodeSize: number; textWidth: number; width: number; gap?: number; pad?: number }): number {
  const gap = opts.gap ?? 8;
  const pad = opts.pad ?? 4;
  const right = opts.nodeX + opts.nodeSize + pad;
  if (right + opts.textWidth <= opts.width - gap) return right;
  const left = opts.nodeX - opts.nodeSize - pad - opts.textWidth;
  if (left >= gap) return left;
  // 양쪽 다 좁다: 잘리지 않는 쪽(오른쪽 정렬)으로 붙인다.
  return Math.max(gap, opts.width - gap - opts.textWidth);
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
