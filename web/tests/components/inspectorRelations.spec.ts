/**
 * The card's relations name each other end's state, so a finished blocker reads
 * as finished and an open one as open. A link whose state the server could not
 * say prints no state rather than a guess. A group of more than five links opens
 * folded to a heading that counts them by state; a shorter one opens.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import InspectorRelations from '@/widgets/work-item-inspector/components/InspectorRelations.vue'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { workItemFixture } from '../fixtures/workItem.ts'

type Link = WorkItem['links'][number]

function link(reference: string, end: Partial<Link>): Link {
  return {
    kind: 'blocks',
    direction: 'incoming',
    work_item_id: `00000000-0000-4000-8000-0000000000${reference.slice(-2)}`,
    reference,
    title: `Work of ${reference}`,
    state_name: 'Backlog',
    state_category: 'backlog',
    is_terminal: false,
    state_unavailable: null,
    ...end,
  }
}

function mountRelations(links: Link[], opened?: Record<string, boolean>) {
  const item = { ...workItemFixture('Relations', 1), links }
  return mount(InspectorRelations, {
    props: {
      item,
      writable: false,
      ...(opened ? { opened } : {}),
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages })],
      stubs: { RelatedWorkPicker: true },
    },
  })
}

function row(wrapper: ReturnType<typeof mountRelations>, reference: string) {
  const found = wrapper
    .findAll('.link-row')
    .find((candidate) => candidate.text().includes(reference))
  if (!found) throw new Error(`no relation row for ${reference}`)
  return found
}

describe('relation rows', () => {
  it('shows a finished blocker as finished, by the other end’s state', () => {
    const wrapper = mountRelations([
      link('MAIN-12', { state_name: 'Done', state_category: 'completed', is_terminal: true }),
    ])
    const state = row(wrapper, 'MAIN-12').find('.semantic-state')
    expect(state.exists()).toBe(true)
    expect(state.attributes('data-state')).toBe('completed')
    expect(state.text()).toBe('Done')
  })

  it('names an open end by its own state, not as finished', () => {
    const wrapper = mountRelations([
      link('MAIN-13', { state_name: 'Dev', state_category: 'active', is_terminal: false }),
    ])
    const state = row(wrapper, 'MAIN-13').find('.semantic-state')
    expect(state.attributes('data-state')).toBe('active')
    expect(state.text()).toBe('In progress')
  })

  it('prints no state for an end whose state the server could not say', () => {
    const wrapper = mountRelations([
      link('MAIN-14', {
        state_name: null,
        state_category: null,
        is_terminal: null,
        state_unavailable: 'state_missing',
      }),
    ])
    expect(row(wrapper, 'MAIN-14').find('.semantic-state').exists()).toBe(false)
    expect(row(wrapper, 'MAIN-14').text()).toContain('Work of MAIN-14')
  })
})

/** A group's toggle, by the words its heading starts with. */
function toggle(wrapper: ReturnType<typeof mountRelations>, label: string) {
  const found = wrapper.findAll('h4 button').find((button) => button.text().startsWith(label))
  if (!found) throw new Error(`no group ${label}`)
  return found
}

describe('relation groups', () => {
  const DONE = { state_name: 'Done', state_category: 'completed', is_terminal: true } as const
  /** Six blockers, four of them finished, and two related items. */
  const links = () => [
    ...['MAIN-21', 'MAIN-22', 'MAIN-23', 'MAIN-24'].map((reference) => link(reference, DONE)),
    link('MAIN-25', {}),
    link('MAIN-26', {}),
    link('MAIN-31', { kind: 'relates-to', direction: 'outgoing' }),
    link('MAIN-32', { kind: 'relates-to', direction: 'outgoing' }),
  ]

  it('folds a group past five links to its count by state, and opens a shorter one', async () => {
    const wrapper = mountRelations(links())
    const blockers = toggle(wrapper, 'Blocked by')
    expect(blockers.attributes('aria-expanded')).toBe('false')
    expect(blockers.text()).toBe('Blocked by 6 · 4 done · 2 backlog')
    const related = toggle(wrapper, 'Relates to')
    expect(related.attributes('aria-expanded')).toBe('true')
    expect(related.text()).toBe('Relates to 2')

    await blockers.trigger('click')
    expect(blockers.attributes('aria-expanded')).toBe('true')
    // Open, the rows say their states, and the heading says only how many there are.
    expect(blockers.text()).toBe('Blocked by 6')
    expect(wrapper.emitted('update:opened')).toEqual([[{ 'blocks-incoming': true }]])
  })

  it('stands each group as the host says the reader left it', () => {
    const wrapper = mountRelations(links(), { 'blocks-incoming': true, 'relates-to': false })
    expect(toggle(wrapper, 'Blocked by').attributes('aria-expanded')).toBe('true')
    expect(toggle(wrapper, 'Relates to').attributes('aria-expanded')).toBe('false')
  })
})
