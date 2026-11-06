/**
 * Live-work frames for tests, in the contract's shape: a row is an open task with no live
 * work unless a test says otherwise, and a space binds the example project.
 */
import type { LiveFrame } from '@/shared/api/liveFrameModel.ts'

type Space = LiveFrame['spaces'][number]
type Row = Space['rows'][number]

export function liveRow(reference: string, overrides: Partial<Row> = {}): Row {
  return {
    reference,
    title: `Work ${reference}`,
    kind: 'task',
    parent: null,
    state: null,
    agents: 0,
    quiet_since: null,
    pinned: false,
    state_name: 'Dev',
    is_terminal: false,
    ...overrides,
  } as Row
}

export function liveSpace(key: string, rows: Row[], overrides: Partial<Space> = {}): Space {
  return {
    key,
    name: `${key} space`,
    project_id: 'example-project',
    unplaced: 0,
    rows,
    ...overrides,
  }
}

export function liveFrame(spaces: Space[], elsewhere = 0): LiveFrame {
  return { spaces, elsewhere }
}

/**
 * A busy frame: two spaces, an epic at work heading its own group, every live state, a
 * quiet row, a pinned row with no work, a pinned closed row, agents on no row, and
 * numbers of one, two and three digits side by side at both levels.
 */
export function busyFrame(): LiveFrame {
  const silent = { state: 'quiet', quiet_since: '2026-11-02T09:00:00Z' } as const
  return liveFrame(
    [
      liveSpace(
        'MAIN',
        [
          liveRow('MAIN-4', { kind: 'epic', title: 'Structured answers', state: 'working' }),
          liveRow('MAIN-9', { parent: 'MAIN-4', title: 'Name the form', ...silent }),
          liveRow('MAIN-12', {
            parent: 'MAIN-4',
            title: 'Answer a review in one form',
            state: 'working',
            agents: 2,
          }),
          liveRow('MAIN-13', { parent: 'MAIN-4', title: 'Tell other work', state: 'held' }),
          liveRow('MAIN-14', {
            parent: 'MAIN-4',
            title: 'Quiet claim',
            state: 'quiet',
            quiet_since: '2026-11-03T18:02:11Z',
          }),
          liveRow('MAIN-7', {
            title: 'Old migration',
            pinned: true,
            state_name: 'Done',
            is_terminal: true,
          }),
          liveRow('MAIN-20', { title: 'Notes for the owner', pinned: true, state_name: 'Backlog' }),
          liveRow('MAIN-31', { title: 'Waiting for a person', state: 'waiting' }),
          liveRow('MAIN-118', {
            title: 'Decide which route a reply takes when the owner answers from a phone',
            ...silent,
          }),
          liveRow('MAIN-140', { parent: 'MAIN-4', title: 'Export the answers', ...silent }),
        ],
        { unplaced: 2 },
      ),
      liveSpace('NEXT', [liveRow('NEXT-5', { title: 'Second space work', state: 'working' })], {
        project_id: 'second-project',
      }),
    ],
    1,
  )
}
