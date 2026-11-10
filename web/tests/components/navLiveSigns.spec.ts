/**
 * The sign each row of the rail's list draws in its lead, a session's row too, and how a row
 * with no work moving looks and says why it is there.
 */
import { createPinia, setActivePinia } from 'pinia'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { tooltipOf } from '@/shared/ui/tooltipAnchors.ts'

import { busyFrame, liveFrame, liveRow, liveSession, liveSpace } from '../support/liveFrame.ts'
import { hintOf, rail, row, unmountRails } from '../support/navRail.ts'
import type { Rail } from '../support/navRail.ts'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

afterEach(() => {
  unmountRails()
  document.body.innerHTML = ''
})

/** The sign a row draws in its lead, by the class that names it; null for none. */
const signOf = (wrapper: Rail, name: string) => {
  const lead = row(wrapper, name).querySelector('.nav-row-lead')
  const signs = [...(lead?.querySelectorAll('.session-sign') ?? [])]
  expect(signs.length).toBeLessThanOrEqual(1)
  const sign = signs[0]
  if (!sign) return null
  // Its host says the state in words; the sign says nothing to assistive technology.
  expect(sign.closest('[aria-hidden="true"]')).not.toBeNull()
  return [...sign.classList].find((each) => each.startsWith('session-sign-')) ?? null
}

describe('the sign of a row', () => {
  it('draws the sign of its session in the lead, one per live state, a session’s too', () => {
    const { wrapper } = rail(
      liveFrame([
        liveSpace(
          'MAIN',
          [
            liveRow('MAIN-1', { state: 'working' }),
            liveRow('MAIN-2', { state: 'waiting', asks: true }),
            liveRow('MAIN-3', { state: 'waiting' }),
            liveRow('MAIN-4', { state: 'waiting', long: true }),
            liveRow('MAIN-5', { state: 'held' }),
            liveRow('MAIN-6', { state: 'quiet', quiet_since: '2026-11-01T00:00:00Z' }),
            liveRow('MAIN-7', { pinned: true }),
            liveRow('MAIN-8', { pinned: true, state_name: 'Done', is_terminal: true }),
          ],
          {
            sessions: [
              liveSession('00000000-0000-4000-8000-000000000001', { title: 'Asks', asks: true }),
            ],
          },
        ),
      ]),
    )
    expect(
      ['MAIN-1', 'MAIN-2', 'MAIN-3', 'MAIN-4', 'MAIN-5', 'MAIN-6', 'MAIN-7', 'MAIN-8', 'Asks'].map(
        (name) => signOf(wrapper, name),
      ),
    ).toEqual([
      'session-sign-working',
      'session-sign-asks',
      'session-sign-waiting',
      'session-sign-waiting',
      'session-sign-held',
      'session-sign-quiet',
      null,
      null,
      'session-sign-asks',
    ])
  })

  it('draws a closed item’s sign while a session is still on it', () => {
    const { wrapper } = rail(
      liveFrame([
        liveSpace('MAIN', [
          liveRow('MAIN-9', { state: 'working', state_name: 'Done', is_terminal: true }),
        ]),
      ]),
    )
    expect(signOf(wrapper, 'MAIN-9')).toBe('session-sign-working')
  })
})

describe('rows with no work moving', () => {
  it('mutes a quiet row, draws its quiet sign, and says since when it is silent', () => {
    const { wrapper } = rail(busyFrame(), 'ru')
    const quiet = row(wrapper, 'MAIN-14')
    expect(quiet.classList).toContain('muted')
    expect(quiet.querySelector('.nav-row-lead .session-sign-quiet')).not.toBeNull()
    expect(hintOf(quiet)).toMatch(
      /^MAIN-14 Quiet claim, часть «Structured answers»: молчит с 03 нояб\.?$/u,
    )
    expect(tooltipOf(quiet)?.clipped).toBe(false)
  })

  it('keeps the sign’s room on a pinned row with no work, and says why it is there', () => {
    const { wrapper } = rail(busyFrame())
    const idle = row(wrapper, 'MAIN-20')
    const working = row(wrapper, 'MAIN-31')
    expect(idle.classList).toContain('muted')
    expect(idle.querySelector('.nav-row-lead')?.children).toHaveLength(0)
    expect(working.querySelector('.nav-row-lead')?.children).toHaveLength(1)
    expect(hintOf(idle)).toBe('MAIN-20 Notes for the owner: Pinned · no work now · Backlog')
    expect(idle.querySelector('.nav-row-meta')).toBeNull()
    expect(idle.querySelector('.nav-row-pin')?.getAttribute('aria-label')).toBe(
      'Pinned to Work: press to remove the pin',
    )
  })

  it('says a pinned closed item’s state where the agents would be counted', () => {
    const { wrapper } = rail(busyFrame())
    const closed = row(wrapper, 'MAIN-7')
    expect(closed.classList).toContain('muted')
    expect(closed.querySelector('.nav-row-meta')?.textContent?.trim()).toBe('Done')
  })

  it('draws no caption counting the agents on no row', () => {
    const { wrapper } = rail(busyFrame(), 'ru')
    const notes = wrapper.findAll('.nav-tree-note').map((note) => note.text())
    expect(notes).toEqual(['Закреплённые'])
  })
})
