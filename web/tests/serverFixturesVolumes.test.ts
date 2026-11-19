/**
 * The Volumes answers and the four numbers of a space's card, as the real server gave
 * them (`tests/test_web_contract_fixtures.py` writes the fixtures), read through the
 * web's strict validators: what each section carries and what a reader may not take.
 */

import { describe, expect, it } from 'vitest'

import { validatePlatformPlanningPayload } from '@/shared/api/platformPlanningPayload.ts'
import { validateGoalVolumesAnswer, validateVolumesAnswer } from '@/shared/api/volumesApi.ts'

import { readServerFixture as read } from './support/serverFixtures.ts'

describe('the server fixtures of volumes', () => {
  it('carry a waiting question, a commit on no card and rows of work outside goals', () => {
    const { counts, outside } = validateVolumesAnswer(read('volumes-project.json'))
    expect(counts.unattached_commits).toBe(1)
    expect(outside.by_project.map((row) => row.project.id)).toEqual(['example-project'])
    expect(outside.by_label.map((row) => row.label)).toEqual(['ui'])
    const space = validateVolumesAnswer(read('volumes-space.json'))
    expect(space.counts.waiting_owner.oldest?.reference).toMatch(/^MAIN-\d+$/u)
    expect(space.outside.by_project.map((row) => row.project.id)).toContain(null)
  })

  it('carry a filter that keeps only tasks, and count no goals or stages under it', () => {
    const filtered = validateVolumesAnswer(read('volumes-filtered.json'))
    expect(filtered.filter).toEqual({ kinds: ['task', 'bug'], labels: ['ui'] })
    expect(filtered.counts.categories.map((row) => row.tasks).reduce((all, n) => all + n)).toBe(2)
    expect(filtered.outside.by_label.map((row) => row.label)).toEqual(['ui'])
    expect(validateVolumesAnswer(read('volumes-space.json')).filter).toBeNull()
    const counted = read('volumes-filtered.json') as {
      volumes: { counts: { categories: { goals: number | null }[] } }
    }
    counted.volumes.counts.categories[0].goals = 0
    expect(() => validateVolumesAnswer(counted)).toThrow()
  })

  it('add up under a filter only the tasks that match, and show no count at acceptance', () => {
    // The goal holds the labelled task under its stage, which spent 300 s; the goal spent too.
    const [goal] = validateVolumesAnswer(read('volumes-filtered.json')).goals
    const [stage] = goal.children
    expect([goal.tasks.total, goal.spent.agent_seconds, stage.spent.agent_seconds]).toEqual([
      1, 300, 300,
    ])
    expect([goal.baseline_absent, stage.baseline_absent]).toEqual(['filtered', 'filtered'])
    const whole = validateVolumesAnswer(read('volumes-space.json')).goals
    expect(whole.find((row) => row.reference === goal.reference)?.spent.agent_seconds).toBe(900)
    const shown = read('volumes-filtered.json') as {
      volumes: { goals: { baseline_absent: string }[] }
    }
    shown.volumes.goals[0].baseline_absent = 'not_accepted'
    expect(() => validateVolumesAnswer(shown)).toThrow()
  })

  it("give a space's card the numbers its Volumes page counts, or say why it has none", () => {
    const directory = validatePlatformPlanningPayload(read('planning-portfolio.json'))
    if (directory.state.status !== 'ready') throw new Error('the directory read is not ready')
    const [space] = directory.state.payload.spaces
    const { categories, waiting_owner } = validateVolumesAnswer(read('volumes-space.json')).counts
    const at = (name: string) => categories.find((row) => row.category === name)
    const triage = at('triage')
    expect(space?.numbers).toEqual({
      triage: (triage?.tasks ?? 0) + (triage?.goals ?? 0) + (triage?.stages ?? 0),
      ready: at('ready')?.tasks,
      active: at('active')?.tasks,
      waiting_owner: waiting_owner.count,
    })
    const withSpace = (changed: Record<string, unknown>) => {
      const shown = read('planning-portfolio.json') as {
        state: { payload: { spaces: Record<string, unknown>[] } }
      }
      Object.assign(shown.state.payload.spaces[0] ?? {}, changed)
      return () => validatePlatformPlanningPayload(shown)
    }
    const unread = { numbers: null, numbers_absent: 'unreadable', work_item_count: null }
    expect(withSpace(unread)).not.toThrow()
    expect(withSpace({ numbers: null, numbers_absent: 'old_store' })).not.toThrow()
    // Numbers or why not, never both and never neither; no count only for a store not read.
    expect(withSpace({ numbers: null })).toThrow()
    expect(withSpace({ numbers_absent: 'old_store' })).toThrow()
    expect(withSpace({ ...unread, work_item_count: 3 })).toThrow()
    expect(withSpace({ work_item_count: null })).toThrow()
  })

  it('carry the table of estimates and what open work has left', () => {
    const { estimates, goals } = validateVolumesAnswer(read('volumes-space.json'))
    expect([estimates.min_basis, estimates.basis]).toEqual([5, 1])
    expect(estimates.rows.map((row) => [row.level, row.kind, row.space?.key])).toEqual([
      ['project_kind', 'task', 'MAIN'],
    ])
    const [goal] = validateGoalVolumesAnswer(read('goal-volumes.json'))
    expect([goal.remaining?.estimated, goal.remaining?.unestimated]).toEqual([0, 2])
    expect(goals.every((row) => row.remaining !== undefined)).toBe(true)
    const judged = read('goal-volumes.json') as { goals: { remaining: { basis: number } }[] }
    judged.goals[0].remaining.basis = 3
    expect(() => validateGoalVolumesAnswer(judged)).toThrow()
  })
})
