/**
 * The hours of a single day, which act as its days do. The oracle is the requirement: an hour that
 * has begun narrows the view to itself when pressed, an hour still to come only shows, and a frame
 * stretched over hours with Shift and an arrow goes out as the moments they run between once Shift
 * is let go, the breakdown left to the page.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SpendingDays from '@/pages/analytics/components/SpendingDays.vue'

import type { Usage } from '@/shared/api/analyticsApi.ts'

import { serveUsage, task } from '../fixtures/analytics.ts'
import { analyticsI18n } from '../support/analyticsReads.ts'

/** Wednesday afternoon, the hour running 14:00 to 15:00. */
const WEDNESDAY = new Date(2026, 10, 11, 14, 30)

const mountDays = (usage: Usage) =>
  mount(SpendingDays, {
    props: {
      usage,
      by: 'work_item',
      measure: 'time',
      readAt: WEDNESDAY,
      accounts: 'loading',
    },
    global: { plugins: [analyticsI18n('en')] },
  })

/** «Today» by the hour, read at Wednesday 14:30: a task worked at ten and at noon. */
/** An hour's work on the task at `hour` of Wednesday. */
const worked = (hour: number) => ({
  at: new Date(2026, 10, 11, hour, 20),
  group: { work_item: task(1, 'One') },
  spend: { seconds: 1200 },
})

function todayByHour(): Usage {
  const offset = String(-WEDNESDAY.getTimezoneOffset())
  const query = new URLSearchParams({
    from: '2026-11-11',
    to: '2026-11-12',
    step: 'hour',
    utc_offset: offset,
    group_by: 'work_item',
  })
  return serveUsage([worked(10), worked(12)], query).usage
}

describe('the hours of a single day', () => {
  it('narrow the view to an hour pressed that has begun, and leave the hours to come to show', async () => {
    const hours = mountDays(todayByHour())
    const columns = hours.findAll('.period-column')
    expect(columns).toHaveLength(24)
    // Up to the hour running at 14:30, each acts; after it, none does.
    expect(columns.map((one) => one.element.tagName === 'BUTTON')).toEqual(
      Array.from({ length: 24 }, (_, hour) => hour <= 14),
    )
    expect(columns[10]?.attributes('aria-label')).toBe('Show the tasks of 10:00–11:00')
    await columns[10]?.trigger('click')
    await columns[20]?.trigger('click')
    expect(hours.emitted('step')).toEqual([
      [{ period: 'custom', from: '2026-11-11T10:00', to: '2026-11-11T11:00' }, '10:00–11:00'],
    ])
  })

  it('send out the hours a frame stretched with Shift covers once Shift is let go', async () => {
    const hours = mountDays(todayByHour())
    const ten = hours.get('[data-cell="10:"]')
    await ten.trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    await hours.get('[data-cell="11:"]').trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    // While Shift is held the frame stands over the three hours, and nothing is sent yet.
    expect(hours.get('.period-spans .axis-frame').attributes('style')).toContain(
      'grid-column: 11 / 14',
    )
    expect(hours.emitted('frame')).toBeUndefined()
    await hours.get('[data-cell="12:"]').trigger('keyup', { key: 'Shift' })
    expect(hours.emitted('frame')).toEqual([
      [{ period: 'custom', from: '2026-11-11T10:00', to: '2026-11-11T13:00' }, '10:00–13:00'],
    ])
    expect(hours.find('.period-spans .axis-frame').exists()).toBe(false)
    expect(hours.emitted('step')).toBeUndefined()
  })

  it('let a stretched frame go on Escape, sending nothing', async () => {
    const hours = mountDays(todayByHour())
    await hours.get('[data-cell="10:"]').trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    await hours.get('[data-cell="11:"]').trigger('keydown', { key: 'Escape' })
    await hours.get('[data-cell="11:"]').trigger('keyup', { key: 'Shift' })
    expect(hours.emitted('frame')).toBeUndefined()
  })
})
