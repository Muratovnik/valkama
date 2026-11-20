/**
 * The Volumes page's numbers against a double of the server's read (`volumesDouble`). The oracle
 * is the page's contract in DESIGN.md («Volumes»): ten numbers on top, an open category's and the
 * first question's with their age; an open category's number opens the board of the scope
 * narrowed to it with the page's kind and label, «Waiting for me» the questions window in either
 * scope, and a number that opens nothing — Done and Cancelled, and every category in every space —
 * is a figure whose hint says why.
 */
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { volumesAnswer, volumesDouble } from '../support/volumesDouble.ts'
import {
  forgetShell,
  GLOBAL,
  mountPage,
  NOW,
  number,
  PROJECT,
  shell,
  SPACE,
  went,
} from './volumesPageHost.ts'

enableAutoUnmount(afterEach)
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  forgetShell()
})

const CATEGORY_NUMBERS = [
  'triage',
  'deferred',
  'ready',
  'active',
  'review',
  'completed',
  'blocked',
  'cancelled',
]

describe('the Volumes page’s numbers', () => {
  it('shows ten numbers, an open category’s and the first question’s with their age', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const page = mountPage(
      volumesDouble(() =>
        volumesAnswer({
          categories: { triage: 4, active: 2, completed: 3 },
          waiting: 2,
          unattached: 5,
        }),
      ),
    )
    await flushPromises()

    const keys = page.findAll('[data-number]').map((one) => one.attributes('data-number'))
    expect(keys).toEqual([...CATEGORY_NUMBERS, 'waiting', 'commits'])
    expect(number(page, 'triage').text()).toBe('Triage4oldest 2\u{A0}d')
    expect(number(page, 'active').text()).toBe('In progress2oldest 2\u{A0}d')
    expect(number(page, 'completed').text()).toBe('Done3in the period')
    expect(number(page, 'waiting').text()).toBe('Waiting for me2oldest 2\u{A0}d')
    expect(number(page, 'commits').text()).toBe('Commits on no card5')
  })

  it('opens the board of the scope narrowed to an open category', async () => {
    const page = mountPage(
      volumesDouble(() => volumesAnswer({ categories: { active: 2 } })),
      PROJECT,
    )
    await flushPromises()

    await number(page, 'active').trigger('click')
    expect(went).toEqual([{ module_id: 'planning', scope: PROJECT, state: { cat: 'active' } }])
  })

  it('opens the board with the page’s kind and label beside the category', async () => {
    const filtered = { kinds: ['bug' as const], labels: ['ui'] }
    const page = mountPage(
      volumesDouble(() => volumesAnswer({ categories: { ready: 1 }, filter: filtered })),
      SPACE,
      { state: { kind: 'bug', label: 'ui' } },
    )
    await flushPromises()

    await number(page, 'ready').trigger('click')
    expect(went).toEqual([
      { module_id: 'planning', scope: SPACE, state: { cat: 'ready', kind: 'bug', labels: 'ui' } },
    ])
  })

  it('narrows a label alone to the three kinds of a task, so no goal carrying it comes in', async () => {
    const filtered = { kinds: [], labels: ['ui'] }
    const page = mountPage(
      volumesDouble(() => volumesAnswer({ categories: { ready: 1 }, filter: filtered })),
      SPACE,
      { state: { label: 'ui' } },
    )
    await flushPromises()

    await number(page, 'ready').trigger('click')
    expect(went[0].state).toEqual({ cat: 'ready', kind: 'task,bug,improvement', labels: 'ui' })
  })

  it('opens the questions window from «Waiting for me» in a space and in every space', async () => {
    for (const scope of [SPACE, GLOBAL]) {
      const page = mountPage(
        volumesDouble(() =>
          volumesAnswer({ waiting: 1, space: scope.kind === 'space' ? 'MAIN' : null }),
        ),
        scope,
      )
      await flushPromises()
      await number(page, 'waiting').trigger('click')
      page.unmount()
    }
    expect(shell.questions).toBe(2)
    expect(went).toEqual([])
  })

  it('draws Done and Cancelled as figures that say the period’s cards open nowhere', async () => {
    const page = mountPage(
      volumesDouble(() => volumesAnswer({ categories: { active: 1, completed: 3, cancelled: 1 } })),
    )
    await flushPromises()

    expect(number(page, 'active').element.tagName).toBe('BUTTON')
    for (const key of ['completed', 'cancelled']) {
      expect(number(page, key).element.tagName).toBe('DIV')
      expect(number(page, key).attributes('aria-description')).toContain(
        'no filter of Work narrows to',
      )
    }
  })

  it('draws every category as a figure in every space, which has no board of its own', async () => {
    const page = mountPage(
      volumesDouble(() => volumesAnswer({ categories: { active: 1, ready: 2 }, space: null })),
      GLOBAL,
    )
    await flushPromises()

    for (const key of CATEGORY_NUMBERS) {
      expect(number(page, key).element.tagName).toBe('DIV')
      expect(number(page, key).attributes('aria-description')).toContain('choose a space')
    }
    expect(number(page, 'waiting').element.tagName).toBe('BUTTON')
  })

  it('says «—» for the commits on no card where their list cannot be read for the scope', async () => {
    const page = mountPage(
      volumesDouble(() => volumesAnswer({ categories: { active: 1 }, unattached: null })),
    )
    await flushPromises()

    expect(number(page, 'commits').text()).toBe('Commits on no card—')
    expect(number(page, 'commits').attributes('aria-description')).toBe(
      'The commits on no card cannot be read for this scope.',
    )
  })
})
