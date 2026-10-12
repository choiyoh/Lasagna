import type { GraphSettings } from '@nopsidian/ipc-contract';

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  filter: '',
  groups: [],
  includeTags: false,
  includeUnresolved: false,
  includeOrphans: true,
  arrows: false,
  forces: { gravity: 0.3, repulsion: 0.3, linkDistance: 0.5 },
};

export const NOTE_COLOR = '#8b8bd6';
export const TAG_COLOR = '#d6a14b';
export const UNRESOLVED_COLOR = '#8a8a8a';
export const GROUP_PALETTE = ['#e5484d', '#30a46c', '#0091ff', '#f5a524', '#a855f7', '#12a594'];
