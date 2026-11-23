/**
 * The Volumes page's goals and states against a double of the server's read (`volumesDouble`).
 * The oracle is the page's contract in DESIGN.md («Volumes»): the goals' tree says «closed N of
 * M», the count at acceptance or «—» with its reason, the two spending figures and the estimate
 * with the done tasks it is judged by; each goal's spending figures are the sums of the rows
 * under it, in fixtures whose sums the test writes out; under the kind and label filter the read
 * is asked for matching tasks alone; and the page's states — empty, failed, spending not counted,
 * a count at acceptance unknown, a space without goals, a project without spending.
 */
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'

import { goalRow, spentOf, volumesAnswer, volumesDouble } from '../support/volumesDouble.ts'
import { figure, forgetShell, mountPage, PROJECT, SPACE } from './volumesPageHost.ts'

enableAutoUnmount(afterEach)
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  forgetShell()
})

/** A goal whose two stages hold all its work, so each of its figures is the sum of theirs. */
function goalOfTwoStages() {
  // The stages: one hour and 10,000 tokens without the cancelled, two hours and 30,000 with
  // them; two hours and 20,000 tokens, the same with them.
  const first = goalRow({
    reference: 'MAIN-11',
    kind: 'stage',
    parent: 'MAIN-10',
    total: 4,
    closed: 1,
    spent: spentOf(3600, 10_000),
    spentWithCancelled: spentOf(7200, 30_000),
  })
  const second = goalRow({
    reference: 'MAIN-12',
    kind: 'stage',
    parent: 'MAIN-10',
    total: 2,
    closed: 2,
    spent: spentOf(7200, 20_000),
  })
  // The goal: 1 h + 2 h = 3 h and 10,000 + 20,000 = 30,000 tokens; with the cancelled
  // 2 h + 2 h = 4 h and 30,000 + 20,000 = 50,000.
  return goalRow({
    reference: 'MAIN-10',
    total: 6,
    closed: 3,
    baseline: 5,
    spent: spentOf(3 * 3600, 30_000),
    spentWithCancelled: spentOf(4 * 3600, 50_000),
    remaining: { seconds: 5 * 3600, anew: 40_000, basis: 7, estimated: 3, unestimated: 0 },
    children: [first, second],
  })
}

describe('the Volumes page’s goals', () => {
  it('says closed N of M, K, both spending figures and the estimate with its basis', async () => {
    const page = mountPage(volumesDouble(() => volumesAnswer({ goals: [goalOfTwoStages()] })))
    await flushPromises()

    expect(figure(page, 'MAIN-10', 'closed').text()).toBe('3 of 6')
    expect(figure(page, 'MAIN-10', 'baseline').text()).toBe('5')
    expect(figure(page, 'MAIN-10', 'remaining').text()).toBe('≈\u{A0}5\u{A0}h · 40K by 7 tasks')
  })

  it('adds up each goal’s two spending figures from the rows under it', async () => {
    const page = mountPage(volumesDouble(() => volumesAnswer({ goals: [goalOfTwoStages()] })))
    await flushPromises()

    // The sums the fixture writes out: 1 h + 2 h and 10K + 20K; 2 h + 2 h and 30K + 20K.
    expect(figure(page, 'MAIN-11', 'spent').text()).toBe('1\u{A0}h · 10K')
    expect(figure(page, 'MAIN-12', 'spent').text()).toBe('2\u{A0}h · 20K')
    expect(figure(page, 'MAIN-10', 'spent').text()).toBe('3\u{A0}h · 30K')
    expect(figure(page, 'MAIN-11', 'spent-all').text()).toBe('2\u{A0}h · 30K')
    expect(figure(page, 'MAIN-12', 'spent-all').text()).toBe('2\u{A0}h · 20K')
    expect(figure(page, 'MAIN-10', 'spent-all').text()).toBe('4\u{A0}h · 50K')
  })

  it('draws a goal of five levels, each under the one over it', async () => {
    let row = goalRow({ reference: 'MAIN-25', kind: 'stage', parent: 'MAIN-24' })
    for (let level = 4; level >= 1; level -= 1)
      row = goalRow({
        reference: `MAIN-${20 + level}`,
        kind: level === 1 ? 'goal' : 'stage',
        parent: level === 1 ? null : `MAIN-${19 + level}`,
        children: [row],
      })
    const page = mountPage(volumesDouble(() => volumesAnswer({ goals: [row] })))
    await flushPromises()

    const levels = page
      .findAll('tr[data-reference]')
      .map((one) => [one.attributes('data-reference'), one.attributes('aria-level')])
    expect(levels).toEqual([
      ['MAIN-21', '1'],
      ['MAIN-22', '2'],
      ['MAIN-23', '3'],
      ['MAIN-24', '4'],
      ['MAIN-25', '5'],
    ])
  })

  it('asks for the kind and label chosen, and shows K as «—» with why under them', async () => {
    const filtered = { kinds: ['task' as const], labels: ['ui'] }
    const double = volumesDouble((query) =>
      volumesAnswer({
        filter: query.getAll('kind').length ? filtered : null,
        goals: [
          goalRow({
            reference: 'MAIN-10',
            total: 2,
            baselineAbsent: query.getAll('kind').length ? 'filtered' : null,
          }),
        ],
      }),
    )
    const page = mountPage(double)
    await flushPromises()
    expect(figure(page, 'MAIN-10', 'baseline').text()).toBe('2')

    const [kind, label] = page.findAllComponents(ChoiceSelect)
    kind.vm.$emit('update:modelValue', 'task')
    await flushPromises()
    label.vm.$emit('update:modelValue', 'ui')
    await flushPromises()

    const last = double.asked.at(-1)
    expect(last?.getAll('kind')).toEqual(['task'])
    expect(last?.getAll('label')).toEqual(['ui'])
    expect(figure(page, 'MAIN-10', 'baseline').text()).toBe('—')
    expect(figure(page, 'MAIN-10', 'baseline').attributes('aria-description')).toBe(
      'Under a filter K is not counted: it was taken of the whole goal.',
    )
  })

  it('offers the labels the read names, and keeps the one chosen', async () => {
    const page = mountPage(
      volumesDouble(() =>
        volumesAnswer({
          categories: { ready: 2 },
          outside: {
            byLabel: [
              { label: 'ui', tasks: 1 },
              { label: null, tasks: 1 },
            ],
          },
        }),
      ),
      SPACE,
      { state: { label: 'docs' } },
    )
    await flushPromises()

    const label = page.findAllComponents(ChoiceSelect)[1]
    const { options } = label.props() as { options: { value: string }[] }
    const offered = options.map((option) => option.value)
    expect(offered).toEqual(['all', 'docs', 'ui'])
  })
})

describe('the Volumes page’s states', () => {
  it('says there is no work in a scope with none', async () => {
    const page = mountPage(volumesDouble(() => volumesAnswer()))
    await flushPromises()
    expect(page.text()).toContain('There is no work in this scope')
    expect(page.find('[data-number]').exists()).toBe(false)
  })

  it('shows the shared error panel when the first read fails, and reads again on retry', async () => {
    const double = volumesDouble(() => volumesAnswer({ categories: { active: 1 } }))
    const page = mountPage(double, SPACE, { fail: 1 })
    await flushPromises()
    expect(page.text()).toContain('Could not read the volumes.')

    const retry = page.findAll('button').find((one) => one.text().includes('Retry'))
    await retry?.trigger('click')
    await flushPromises()
    expect(page.find('[data-number="active"]').exists()).toBe(true)
  })

  it('says «—» with a hint, never 0, for spending of tasks begun before it was counted', async () => {
    const page = mountPage(
      volumesDouble(() =>
        volumesAnswer({
          goals: [goalRow({ reference: 'MAIN-10', total: 2, spent: spentOf(0, null, 2) })],
        }),
      ),
    )
    await flushPromises()
    const spent = figure(page, 'MAIN-10', 'spent')
    expect(spent.text()).toBe('—')
    expect(spent.attributes('aria-description')).toBe(
      'Not counted: its tasks began before usage was counted.',
    )
  })

  it('says «—» with why for the count at acceptance of a goal moved from before it was counted', async () => {
    const page = mountPage(
      volumesDouble(() =>
        volumesAnswer({
          goals: [goalRow({ reference: 'MAIN-10', total: 2, baselineAbsent: 'migrated' })],
        }),
      ),
    )
    await flushPromises()
    const baseline = figure(page, 'MAIN-10', 'baseline')
    expect(baseline.text()).toBe('—')
    expect(baseline.attributes('aria-description')).toBe(
      'Unknown: it was accepted before tasks at acceptance were counted.',
    )
  })

  it('says a space without goals has none, and counts its work outside goals', async () => {
    const page = mountPage(
      volumesDouble(() =>
        volumesAnswer({
          categories: { ready: 3 },
          outside: {
            byProject: [
              { project: 'alpha', tasks: 2 },
              { project: null, tasks: 1 },
            ],
          },
        }),
      ),
    )
    await flushPromises()
    expect(page.text()).toContain('There are no goals in this scope')
    expect(page.findAll('tr[data-reference]')).toHaveLength(0)
    expect(page.get('tr[data-row="alpha"] [data-category="ready"]').text()).toBe('2')
    expect(page.get('tr[data-row="-"]').text()).toContain('No project')
    expect(page.text()).toContain('3 tasks outside goals')
  })

  it('says a project’s goal that spent nothing spent nothing, neither «—» nor 0', async () => {
    const page = mountPage(
      volumesDouble(() => volumesAnswer({ goals: [goalRow({ reference: 'MAIN-10', total: 1 })] })),
      PROJECT,
    )
    await flushPromises()
    expect(figure(page, 'MAIN-10', 'spent').text()).toBe('nothing spent')
    expect(figure(page, 'MAIN-10', 'spent-all').text()).toBe('nothing spent')
  })
})
