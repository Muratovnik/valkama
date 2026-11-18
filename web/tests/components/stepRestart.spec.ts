/**
 * A step line where its window's count restarted inside it, held to what `StepLine`,
 * `useStepWalk` and `StepLineTable` state: the restart is a place on the line at the moment of the
 * reading it restarted at, with its own hint, its ring around the fall the line draws there and
 * painted only when pointed at; the pointer finds it at the fall, before that reading, whose step
 * takes the pointer past the ring; the keyboard walks it between the reading before it and that
 * reading; it stands nowhere outside the span shown; and the table lists it before that reading.
 * The oracle is that rule on made-up readings, worked out by hand.
 */
import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import StepLineTable from '@/shared/ui/StepLineTable.vue'

import { declared } from '../support/stepDrawing.ts'
import {
  HIT,
  HOUR,
  openLine,
  point,
  pointAt,
  START,
  stepLine,
  WORDS,
} from '../support/stepLineMount.ts'

/**
 * A window whose count restarted inside it: 99 % at one hour and a half, 0 % at two hours with the
 * reset unchanged, then 10 % at two and a half. Over the whole five hours drawn 300 px wide, the
 * restart stands at 120 px.
 */
const ZEROED = [
  point('12:00', 1, 20),
  point('12:30', 1.5, 99),
  point('13:00', 2, 0),
  point('13:30', 2.5, 10),
]
const RESTART = {
  key: 'restart-0',
  at: START + 2 * HOUR,
  timeText: '13:00',
  name: 'Counter zeroed',
  figure: '13:00',
  notes: ['Window reset time unchanged: h5'],
}

describe('the step line where its count restarted', () => {
  it('marks the restart at its fall with its own hint, a ring painted only when pointed at', async () => {
    const line = await stepLine(ZEROED)
    await line.setProps({ restarts: [RESTART] })
    const restart = line.get('[data-target="restart"]')
    expect(restart.attributes('data-stop')).toBe('2')
    expect(restart.attributes('data-tooltip')).toBe(
      'Counter zeroed: 13:00\nWindow reset time unchanged: h5',
    )
    // A ring around the fall at 40 % across, from 99 % before it to 0 % at it.
    expect(declared(line.get('.step-restart-mark'))).toEqual({
      '--step-high': 0.01,
      '--step-low': 1,
      '--step-side': 50,
    })
    expect(restart.get('.step-target-mark').classes('step-shown')).toBe(false)
    // At the fall the restart, before the reading at its moment; past the ring that reading.
    await pointAt(line, 120)
    expect(restart.get('.step-target-mark').classes('step-shown')).toBe(true)
    expect(line.findAll('.step-mark').filter((one) => one.classes('step-shown'))).toHaveLength(0)
    await pointAt(line, 120 + HIT + 1)
    expect(restart.get('.step-target-mark').classes('step-shown')).toBe(false)
    expect(line.get('[data-reading="2"] .step-mark').classes('step-shown')).toBe(true)
    line.unmount()
  })

  it('walks the restart between the reading before it and the reading at its moment', async () => {
    const line = await stepLine(ZEROED)
    await line.setProps({ restarts: [RESTART] })
    expect(line.get('[data-reading="3"]').attributes('tabindex')).toBe('0')
    const before = line.get('[data-reading="1"]')
    ;(before.element as HTMLElement).focus()
    await before.trigger('keydown', { key: 'ArrowRight' })
    await nextTick()
    expect((document.activeElement as HTMLElement).dataset.target).toBe('restart')
    await line.get('[data-target="restart"]').trigger('keydown', { key: 'ArrowRight' })
    await nextTick()
    expect((document.activeElement as HTMLElement).dataset.reading).toBe('2')
    line.unmount()
  })

  it('stands nowhere outside the span shown', async () => {
    // Opened on its start to now, three hours in, the plot runs to four hours: the restart at two
    // hours stands in it, one at four hours and a half past it.
    const line = openLine([...ZEROED, point('15:30', 4.5, 1)])
    const later = { ...RESTART, key: 'restart-1', at: START + 4.5 * HOUR }
    await line.setProps({ restarts: [RESTART, later] })
    expect(
      line.findAll('[data-target="restart"]').map((one) => one.attributes('data-stop')),
    ).toEqual(['2'])
    line.unmount()
  })

  it('as a table lists the restart before the reading at its moment', () => {
    const table = mount(StepLineTable, {
      props: { label: 'Readings of Work', points: ZEROED, words: WORDS, restarts: [RESTART] },
    })
    expect(
      table.findAll('tbody tr').map((row) => row.findAll('th, td').map((cell) => cell.text())),
    ).toEqual([
      ['12:00', '20%', 'the poll'],
      ['12:30', '99%', 'the poll'],
      ['13:00', '', 'Counter zeroed; Window reset time unchanged: h5'],
      ['13:00', '0%', 'the poll'],
      ['13:30', '10%', 'the poll'],
    ])
    expect(table.find('[data-key="restart-0"]').exists()).toBe(true)
  })
})
