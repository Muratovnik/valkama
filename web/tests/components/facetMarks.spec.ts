import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

/**
 * The marks a surface prints, as a reader and a screen reader meet them: the
 * glyph, its word, the tone the state owner gave it, and what a click does.
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import FacetMarks from '@/entities/work-item/components/FacetMarks.vue'
import LabelChip from '@/entities/work-item/components/LabelChip.vue'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { boardItem } from '../fixtures/board.ts'

afterEach(() => {
  document.body.innerHTML = ''
})

const i18n = (locale: 'en' | 'ru' = 'en') =>
  createI18n({ legacy: false, locale, messages, pluralRules })

function marks(
  props: Record<string, unknown> & { item: WorkItemBrief },
  locale: 'en' | 'ru' = 'en',
) {
  return mount(FacetMarks, {
    attachTo: document.body,
    props: { surface: 'tile', ...props },
    global: { plugins: [i18n(locale)] },
  })
}

/** The tone the card's mark of one facet carries, for one item. */
const tone = (overrides: Partial<WorkItemBrief>, facet: string) =>
  marks({ item: boardItem(1, 'backlog', overrides), surface: 'card' })
    .get(`[data-facet="${facet}"]`)
    .attributes('data-tone')

describe('FacetMarks', () => {
  it('draws a lone glyph with its word as the name a screen reader and a pointer get', () => {
    const wrapper = marks({ item: boardItem(1, 'backlog', { kind: 'bug', priority: 'urgent' }) })
    const priority = wrapper.get('[data-facet="priority"]')
    // The word is in the DOM, visually hidden, and the hover text says it too.
    expect(priority.get('.facet-word').text()).toBe('Urgent')
    expect(priority.get('.facet-word').classes()).toContain('facet-word-hidden')
    expect(priority.attributes('title')).toBe('Urgent — blocks work or loses data')
    expect(priority.find('svg').exists()).toBe(true)
    expect(wrapper.get('[data-facet="kind"] .facet-word').text()).toBe('Bug')
  })

  it('says what each priority means after its name on hover, in both languages', () => {
    const hovers = [
      ['en', 'urgent', 'Urgent — blocks work or loses data'],
      ['en', 'high', 'High — serious; could block work'],
      ['en', 'medium', 'Medium — noticeably affects work, with a workaround'],
      ['en', 'low', 'Low — minor'],
      ['ru', 'urgent', 'Срочный — блокирует работу или теряет данные'],
      ['ru', 'high', 'Высокий — серьёзно, может заблокировать'],
      ['ru', 'medium', 'Средний — заметно влияет, есть обход'],
      ['ru', 'low', 'Низкий — мелочь'],
    ] as const
    for (const [locale, priority, hover] of hovers) {
      // The card prints every level as a word, so each level has a mark to hover.
      const mark = marks(
        { item: boardItem(1, 'backlog', { priority }), surface: 'card', facets: ['priority'] },
        locale,
      ).get('[data-facet="priority"]')
      expect(mark.attributes('title'), `${locale} ${priority}`).toBe(hover)
    }
  })

  it('takes each tone from the state owner: urgent is danger, high warning, a kind none', () => {
    expect(tone({ priority: 'urgent' }, 'priority')).toBe('danger')
    expect(tone({ priority: 'high' }, 'priority')).toBe('warning')
    expect(tone({ priority: 'medium' }, 'priority')).toBe('neutral')
    expect(tone({ kind: 'epic' }, 'kind')).toBe('neutral')
  })

  it('names the kind on its mark, which is what its colour hangs on, and on no other', () => {
    const wrapper = marks({ item: boardItem(1, 'backlog', { kind: 'bug', priority: 'urgent' }) })
    expect(wrapper.get('[data-facet="kind"]').attributes('data-kind')).toBe('bug')
    expect(wrapper.get('[data-facet="priority"]').attributes('data-kind')).toBeUndefined()
  })

  it('prints nothing on a tile for an ordinary workable task', () => {
    const wrapper = marks({ item: boardItem(1, 'backlog') })
    expect(wrapper.text()).toBe('')
    expect(wrapper.findAll('.facet-mark')).toHaveLength(0)
  })

  it('names what an item waits on, in both languages', () => {
    const item = boardItem(1, 'todo', { ready: false })
    const context = { waitingOn: 'MAIN-7' }
    const en = marks({ item, context, surface: 'list', facets: ['readiness'] })
    expect(en.get('[data-facet="readiness"]').text()).toBe('Waiting on MAIN-7')
    expect(en.get('[data-facet="readiness"]').attributes('data-tone')).toBe('danger')
    const ru = marks({ item, context, surface: 'list', facets: ['readiness'] }, 'ru')
    expect(ru.get('[data-facet="readiness"]').text()).toBe('Ждёт MAIN-7')
  })

  it('draws the reference on a tile and still says the whole sentence', () => {
    const item = boardItem(1, 'todo', { ready: false })
    const context = { waitingOn: 'MAIN-7' }
    for (const [locale, sentence] of [
      ['en', 'Waiting on MAIN-7'],
      ['ru', 'Ждёт MAIN-7'],
    ] as const) {
      const mark = marks({ item, context, facets: ['readiness'] }, locale).get(
        '[data-facet="readiness"]',
      )
      // On screen: the glyph and the reference, which the reader cannot hear twice.
      const drawn = mark.get('.facet-word')
      expect(drawn.text()).toBe('MAIN-7')
      expect(drawn.attributes('aria-hidden')).toBe('true')
      expect(mark.find('svg').exists()).toBe(true)
      // Heard and hovered: the sentence.
      expect(mark.get('.facet-word-hidden').text()).toBe(sentence)
      expect(mark.attributes('title')).toBe(sentence)
    }
  })

  it('folds a run that must keep one line, keeping the word as name and hover text', () => {
    const item = boardItem(1, 'todo', { ready: false })
    const context = { waitingOn: 'MAIN-7' }
    const loose = marks({ item, context, surface: 'list', facets: ['readiness'] })
    expect(loose.get('.facet-marks').classes()).not.toContain('fold')
    // Unfolded, a glyph shown with its word needs no hover text.
    expect(loose.get('[data-facet="readiness"]').attributes('title')).toBeUndefined()
    const folded = marks({ item, context, surface: 'list', facets: ['readiness'], fold: true })
    expect(folded.get('.facet-marks').classes()).toContain('fold')
    const mark = folded.get('[data-facet="readiness"]')
    // The word stays in the mark, so a screen reader still reads it out.
    expect(mark.get('.facet-word').text()).toBe('Waiting on MAIN-7')
    expect(mark.attributes('title')).toBe('Waiting on MAIN-7')
  })

  it('gives the graph one quiet label for workable, the same words the queue uses', () => {
    const wrapper = marks(
      { item: boardItem(1, 'backlog'), surface: 'graph', facets: ['state', 'readiness'] },
      'ru',
    )
    expect(wrapper.text()).toBe('Можно брать')
    expect(wrapper.get('[data-facet="readiness"]').classes()).toContain('quiet')
    expect(wrapper.find('.semantic-state').exists()).toBe(false)
  })

  it('draws a state as the shared state mark, dot and name', () => {
    const wrapper = marks({
      item: boardItem(1, 'dev', { ready: false }),
      surface: 'list',
      facets: ['state'],
    })
    const state = wrapper.get('.semantic-state')
    expect(state.attributes('data-tone')).toBe('info')
    expect(state.text()).toBe('Dev')
  })

  it('is text, not buttons, unless the host lets it filter', () => {
    const item = boardItem(1, 'backlog', { kind: 'bug', priority: 'high', labels: ['ui'] })
    const quiet = marks({ item })
    expect(quiet.findAll('button')).toHaveLength(0)
    expect(quiet.get('.label-chip').element.tagName).toBe('SPAN')
  })

  it('adds a kind, a priority or a label to the filter, and offers to take it out once it is in', async () => {
    const item = boardItem(1, 'backlog', { kind: 'bug', priority: 'high', labels: ['ui', 'board'] })
    const wrapper = marks({
      item,
      surface: 'card',
      filterable: true,
      filter: { text: '', labels: ['ui'] },
    })
    await wrapper.get('[data-facet="kind"]').trigger('click')
    await wrapper.get('[data-facet="priority"]').trigger('click')
    const [ui, board] = wrapper.findAll('.label-chip')
    await board.trigger('click')
    expect(wrapper.emitted('filter')).toEqual([
      [{ facet: 'kind', value: 'bug' }],
      [{ facet: 'priority', value: 'high' }],
      [{ facet: 'labels', value: 'board' }],
    ])
    expect(wrapper.get('[data-facet="kind"]').attributes('aria-label')).toBe('Filter: kind Bug')
    expect(board.attributes('aria-label')).toBe('Filter: label board')
    expect(ui.attributes('aria-label')).toBe('Remove from filter: label ui')
    expect(ui.attributes('data-active')).toBe('true')
  })

  it('keeps its buttons out of the Tab order inside a container that is one Tab stop', () => {
    const item = boardItem(1, 'backlog', { kind: 'bug', labels: ['ui'] })
    const inRow = marks({
      item,
      surface: 'list',
      facets: ['kind'],
      lead: true,
      filterable: true,
      tabbable: false,
    })
    expect(inRow.get('[data-facet="kind"]').attributes('tabindex')).toBe('-1')
    const inTile = marks({ item, filterable: true, tabbable: false })
    expect(inTile.get('.label-chip').attributes('tabindex')).toBe('-1')
    const inCard = marks({ item, surface: 'card', filterable: true })
    expect(inCard.get('[data-facet="kind"]').attributes('tabindex')).toBeUndefined()
  })

  it('draws a tile’s glyphs as text even where its chips filter', async () => {
    const item = boardItem(1, 'backlog', { kind: 'bug', priority: 'high', labels: ['ui'] })
    const wrapper = marks({ item, filterable: true, tabbable: false })
    for (const facet of ['kind', 'priority']) {
      const glyph = wrapper.get(`[data-facet="${facet}"]`)
      expect(glyph.element.tagName, facet).toBe('SPAN')
      expect(glyph.attributes('tabindex'), facet).toBeUndefined()
      await glyph.trigger('click')
    }
    // The glyph keeps its word as the pointer's hover text, not a filter's name.
    expect(wrapper.get('[data-facet="priority"]').attributes('title')).toBe(
      'High — serious; could block work',
    )
    expect(wrapper.emitted('filter')).toBeUndefined()
    await wrapper.get('.label-chip').trigger('click')
    expect(wrapper.emitted('filter')).toEqual([[{ facet: 'labels', value: 'ui' }]])
  })

  it('folds labels past the tile’s three into a count', () => {
    const wrapper = marks(
      { item: boardItem(1, 'backlog', { labels: ['a', 'b', 'c', 'd', 'e'] }), facets: ['labels'] },
      'ru',
    )
    expect(wrapper.findAll('.label-chip').map((chip) => chip.text())).toEqual(['a', 'b', 'c'])
    expect(wrapper.get('[data-facet="labels"]').text()).toBe('+2')
  })
})

describe('LabelChip', () => {
  it('filters without opening what it lies in', async () => {
    const opened: string[] = []
    const wrapper = mount(
      {
        components: { LabelChip },
        template: `<div @click="opened.push('card')"><LabelChip label="ui" @filter="(label) => opened.push(label)" /></div>`,
        setup: () => ({ opened }),
      },
      { global: { plugins: [i18n()] } },
    )
    await wrapper.get('.label-chip').trigger('click')
    expect(opened).toEqual(['ui'])
  })
})

describe('FacetMarks in a column', () => {
  it('prints a word form as the word alone, and the lead run as glyphs alone', () => {
    const held = boardItem(1, 'dev', {
      claim_ref: 'codex',
      priority: 'high',
      checklist: [{ id: 'a', text: 'one', done: true, claimed_by: '', done_by: '' }],
    })
    // The holder and steps columns name their facet in the heading.
    const column = marks({ item: held, surface: 'list', facets: ['holder', 'steps'] })
    expect(column.findAll('svg')).toHaveLength(0)
    expect(column.text()).toContain('codex')
    const lead = marks({ item: held, surface: 'list', facets: ['priority', 'kind'], lead: true })
    expect(lead.findAll('[data-facet]').map((mark) => mark.attributes('data-facet'))).toEqual([
      'priority',
    ])
    expect(lead.get('.facet-word').classes()).toContain('facet-word-hidden')
  })
})

describe('the words of a mark', () => {
  it('follows a change of language though it keeps what it has looked up', async () => {
    const plugin = i18n('en')
    const wrapper = mount(FacetMarks, {
      props: {
        surface: 'list',
        item: boardItem(1, 'backlog', { kind: 'bug' }),
        facets: ['kind'],
        filterable: true,
      },
      global: { plugins: [plugin] },
    })
    const name = () => wrapper.get('[data-facet="kind"]').attributes('aria-label')
    const english = name()
    expect(english).toContain('Bug')
    plugin.global.locale.value = 'ru'
    await nextTick()
    expect(name()).not.toBe(english)
    plugin.global.locale.value = 'en'
    await nextTick()
    expect(name()).toBe(english)
  })

  it('says a pressed glyph in its name and draws no second word for it', () => {
    const wrapper = marks({
      surface: 'list',
      item: boardItem(1, 'backlog', { kind: 'bug' }),
      facets: ['kind'],
      filterable: true,
    })
    const mark = wrapper.get('[data-facet="kind"]')
    expect(mark.attributes('aria-label')).toContain('Bug')
    expect(mark.find('.facet-word').exists()).toBe(false)
  })
})
