/**
 * Work items for the frame projection's cases, built by hand: a state from three, a goal or
 * a task, and the parent each is filed under; the link between two of them; and the lines a
 * projection draws.
 */
import type { FrameProjection } from '@/widgets/work-item-graph/utils/graphFrames.ts'

import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'

export const STATES = {
  todo: { state_id: 'todo', key: 'todo', name: 'Todo', category: 'ready', is_terminal: false },
  dev: { state_id: 'dev', key: 'dev', name: 'Dev', category: 'active', is_terminal: false },
  done: { state_id: 'done', key: 'done', name: 'Done', category: 'completed', is_terminal: true },
} as const

export function item(
  id: string,
  number: number,
  options: { goal?: boolean; parent?: string; state?: keyof typeof STATES } = {},
): WorkItemBrief {
  return {
    work_item_id: id,
    planning_space_id: 'space',
    reference: `MAIN-${number}`,
    number,
    title: `Item ${number}`,
    kind: options.goal ? 'goal' : 'task',
    priority: 'medium',
    state: STATES[options.state ?? 'todo'],
    claim_ref: '',
    claim_state: null,
    parent_id: options.parent ?? null,
    open: !STATES[options.state ?? 'todo'].is_terminal,
    container_state: null,
    acceptance: null,
    started_at: null,
    waits_for: [],
    workable: true,
    withheld: [],
    lapsed_claim: null,
    labels: [],
    projects: [],
    source: '',
    checklist: [],
    revision: 0,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    comment_count: 0,
  }
}

export const link = (from: string, to: string, kind: PlanningEdge['kind'] = 'discovered-from') => ({
  from,
  to,
  kind,
})

/** The lines a projection draws, each as its ends, its kind and how many links it stands for. */
export const lines = (projected: FrameProjection) =>
  projected.edges.map((edge) => [edge.source, edge.target, edge.kind, edge.links.length])
