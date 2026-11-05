import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

/**
 * The hover card of a work item as a reader meets it, state by state: what it
 * prints, what it leaves out, and the sentences a screen reader hears instead.
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import WorkItemPreview from '@/entities/work-item/components/WorkItemPreview.vue'
import { useWorkItemPreviewWords } from '@/entities/work-item/composables/useWorkItemPreviewWords.ts'
import type { WorkItemPreviewSubject } from '@/entities/work-item/composables/useWorkItemPreviewWords.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { i18n as appI18n, messages, pluralRules } from '@/shared/i18n/index.ts'

import { boardItem } from '../fixtures/board.ts'

afterEach(() => {
  document.body.innerHTML = ''
})

const i18n = (locale: 'en' | 'ru') =>
  createI18n({
    legacy: false,
    locale,
    messages,
    pluralRules,
    datetimeFormats: appI18n.global.datetimeFormats.value,
  })

const thisYear = new Date().getFullYear()
const UPDATED = new Date(thisYear, 10, 3, 22, 40).toISOString()
const CLOSED = new Date(thisYear, 10, 2, 18, 5).toISOString()
/** The list's date words for this year: month, day and time, no year. */
const day = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

const steps = (done: number, total: number) =>
  Array.from({ length: total }, (_, index) => ({
    id: `00000000-0000-4000-8000-00000000070${index}`,
    text: `Step ${index}`,
    done: index < done,
    claimed_by: '',
    done_by: '',
  }))

const item = (overrides: Partial<WorkItemBrief>, state: 'backlog' | 'dev' | 'done' = 'dev') =>
  boardItem(1394, state, { title: 'Show a short card on hover', updated_at: UPDATED, ...overrides })

const CLAIMED = item({
  kind: 'bug',
  claim_ref: 'claude (session f5f838f4-74fc-4a1b-9c2d-0123456789ab)',
  claim_state: 'live',
  checklist: steps(1, 5),
})
const CLOSED_ITEM = item(
  { claim_ref: '', last_claim_ref: 'claude', closed_at: CLOSED, checklist: steps(3, 3) },
  'done',
)

function card(subject: Partial<WorkItemPreviewSubject>, locale: 'en' | 'ru' = 'en') {
  return mount(WorkItemPreview, {
    attachTo: document.body,
    props: { reference: 'MAIN-1394', item: null, ...subject },
    global: { plugins: [i18n(locale)] },
  })
}

function spoken(subject: WorkItemPreviewSubject, locale: 'en' | 'ru' = 'en') {
  const Probe = defineComponent({
    setup() {
      const { describe } = useWorkItemPreviewWords()
      return () => h('p', describe(subject))
    },
  })
  return mount(Probe, { global: { plugins: [i18n(locale)] } }).text()
}

describe('WorkItemPreview', () => {
  it('shows a held item: reference, kind, state, title, holder as the board names it, steps, date', () => {
    const wrapper = card({ item: CLAIMED })
    expect(wrapper.get('.preview-reference').text()).toBe('MAIN-1394')
    expect(wrapper.get('[data-facet="kind"]').text()).toBe('Bug')
    expect(wrapper.get('.preview-head').text()).toContain('Dev')
    expect(wrapper.get('.preview-title').text()).toBe('Show a short card on hover')
    expect(wrapper.get('[data-facet="holder"]').text()).toBe('claude · f5f838f4-74fc')
    expect(wrapper.get('[data-facet="steps"]').text()).toBe('1/5')
    expect(wrapper.get('time').text()).toBe(day(UPDATED, 'en'))
    expect(wrapper.get('time').attributes('datetime')).toBe(UPDATED)
  })

  it('prints nothing for nobody, no steps and an ordinary priority', () => {
    const wrapper = card({ item: item({ priority: 'medium' }, 'backlog') })
    expect(wrapper.find('[data-facet="holder"]').exists()).toBe(false)
    expect(wrapper.find('[data-facet="steps"]').exists()).toBe(false)
    expect(wrapper.find('[data-facet="priority"]').exists()).toBe(false)
    expect(wrapper.find('.preview-facts').exists()).toBe(false)
  })

  it('marks a stale claim as the tile does, beside the holder', () => {
    const wrapper = card({ item: item({ claim_ref: 'codex', claim_state: 'stale' }) })
    expect(wrapper.get('.preview-facts').text()).toContain('Stale claim')
    expect(wrapper.get('[data-facet="holder"]').attributes('data-tone')).toBe(
      wrapper.get('.preview-facts .semantic-state').attributes('data-tone'),
    )
  })

  it('shows a finished item’s former holder and its close, without steps', () => {
    const wrapper = card({ item: CLOSED_ITEM })
    expect(wrapper.get('[data-facet="holder"]').text()).toBe('Previously responsible: claude')
    expect(wrapper.find('[data-facet="steps"]').exists()).toBe(false)
    expect(wrapper.get('time').text()).toBe(day(CLOSED, 'en'))
  })

  it('keeps a 200-letter title whole', () => {
    const title = 'Ж'.repeat(200)
    expect(
      card({ item: item({ title }) })
        .get('.preview-title')
        .text(),
    ).toBe(title)
  })

  it('says what an item waits on, and the project of an item from elsewhere', () => {
    const wrapper = card({
      item: item({}, 'backlog'),
      waitingOn: 'MAIN-12',
      project: 'example-project',
    })
    expect(wrapper.get('[data-facet="readiness"]').text()).toBe('Waiting on MAIN-12')
    expect(wrapper.get('.preview-when').text()).toBe(`example-project · ${day(UPDATED, 'en')}`)
  })

  it.each([
    [undefined, 'Reading…'],
    ['failed', 'Could not read the work item.'],
    ['missing', 'Task MAIN-1394 was not found.'],
    ['unavailable', "The work item's store is unavailable right now."],
  ] as const)('without an item (%s) the reference stands with one line', (failure, line) => {
    const wrapper = card({ failure })
    expect(wrapper.get('.preview-reference').text()).toBe('MAIN-1394')
    expect(wrapper.get('.preview-note').text()).toBe(line)
    expect(wrapper.find('.preview-title').exists()).toBe(false)
  })

  it('hides its facts from assistive technology and brings hover text only to its controls', () => {
    const wrapper = card({ item: { ...CLAIMED, priority: 'urgent' }, waitingOn: 'MAIN-12' })
    for (const line of ['.preview-head-marks', '.preview-title', '.preview-facts', '.preview-when'])
      expect(wrapper.get(line).attributes('aria-hidden'), line).toBe('true')
    expect(wrapper.attributes('aria-hidden')).toBeUndefined()
    expect(wrapper.findAll('[title]').map((node) => node.element.tagName)).toEqual([
      'BUTTON',
      'BUTTON',
    ])
  })

  it('speaks in Russian with the same words as the board', () => {
    const wrapper = card({ item: CLOSED_ITEM }, 'ru')
    expect(wrapper.get('[data-facet="holder"]').text()).toBe('Ранее отвечал: claude')
    expect(wrapper.get('time').text()).toBe(day(CLOSED, 'ru'))
  })
})

describe('what a screen reader hears', () => {
  it('reads the card as sentences, in the order it is drawn', () => {
    expect(spoken({ reference: 'MAIN-1394', item: CLAIMED })).toBe(
      `Bug. Dev. Show a short card on hover. Held by claude · f5f838f4-74fc. Steps: 1 of 5. Updated ${day(UPDATED, 'en')}.`,
    )
  })

  it('says a finished item’s former holder and its close, and a stale claim', () => {
    expect(spoken({ reference: 'MAIN-1394', item: CLOSED_ITEM })).toBe(
      `Done. Show a short card on hover. Previously responsible: claude. Closed ${day(CLOSED, 'en')}.`,
    )
    expect(
      spoken({ reference: 'MAIN-1394', item: item({ claim_ref: 'codex', claim_state: 'stale' }) }),
    ).toContain('Held by codex. Stale claim.')
  })

  it('says what the card says when there is no item', () => {
    expect(spoken({ reference: 'MAIN-77', item: null, failure: 'missing' })).toBe(
      'Task MAIN-77 was not found.',
    )
    expect(spoken({ reference: 'MAIN-77', item: null }, 'ru')).toBe('Читаю…')
  })
})
