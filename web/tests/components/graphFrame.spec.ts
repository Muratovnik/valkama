/**
 * An epic's frame on the graph, as the reader meets its header: how its work
 * stands in words with each number beside its word, what folding and opening
 * it are called, and the work under no epic, which has nothing to open.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import GraphFrame from '@/widgets/work-item-graph/components/GraphFrame.vue'
import { NO_EPIC_FRAME } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { FrameProgress, PlacedFrame } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { boardItem } from '../fixtures/board.ts'

afterEach(() => {
  document.body.innerHTML = ''
})

const EPIC = boardItem(12, 'dev', {
  kind: 'epic',
  container: true,
  title: 'Frames on the graph',
})

const progress = (counts: Partial<FrameProgress>): FrameProgress => {
  const whole = { done: 0, review: 0, active: 0, blocked: 0, ahead: 0, ...counts }
  const total = whole.done + whole.review + whole.active + whole.blocked + whole.ahead
  return { ...whole, total }
}

function frame(overrides: Partial<PlacedFrame> = {}): PlacedFrame {
  return {
    id: EPIC.work_item_id,
    epic: EPIC,
    parentId: null,
    folded: false,
    x: 0,
    y: 0,
    width: 600,
    height: 200,
    progress: progress({ done: 8, active: 2, blocked: 1, ahead: 10 }),
    members: [],
    ...overrides,
  }
}

function header(props: { frame: PlacedFrame; overview?: boolean }, locale: 'en' | 'ru' = 'en') {
  return mount(GraphFrame, {
    attachTo: document.body,
    props,
    global: {
      plugins: [createI18n({ legacy: false, locale, messages, pluralRules })],
      stubs: { Handle: true },
    },
  })
}

/** The counts as the header writes them, each one a number and its word. */
const countsOf = (wrapper: ReturnType<typeof header>) =>
  wrapper.findAll('.graph-frame-count').map((count) => count.text().replaceAll(/\s+/g, ' '))

describe("a frame's header", () => {
  it('says how the work stands in words, and writes no group that holds nothing', () => {
    const wrapper = header({ frame: frame() })
    expect(countsOf(wrapper)).toEqual(['8 of 21 done', '2 in progress', '1 blocked'])
    // Review holds nothing here, so it is not written.
    expect(wrapper.find('[data-group="review"]').exists()).toBe(false)
  })

  it('takes the Russian plural of each word from its own number', () => {
    const one = header({ frame: frame({ progress: progress({ done: 1, blocked: 1 }) }) }, 'ru')
    expect(countsOf(one)).toEqual(['1 из 2 готово', '1 заблокирована'])
    one.unmount()
    const few = header({ frame: frame({ progress: progress({ review: 3, blocked: 4 }) }) }, 'ru')
    expect(countsOf(few)).toEqual(['0 из 7 готово', '3 на проверке', '4 заблокированы'])
    few.unmount()
    const many = header({ frame: frame({ progress: progress({ blocked: 15 }) }) }, 'ru')
    expect(countsOf(many)).toEqual(['0 из 15 готово', '15 заблокировано'])
  })

  it('stands each number beside its word rather than inside the translated words', () => {
    const wrapper = header({ frame: frame() })
    const badges = wrapper.findAll('.graph-frame-count .count-badge').map((badge) => badge.text())
    expect(badges).toEqual(['8', '21', '2', '1'])
  })

  it('counts an epic far past a badge’s ninety-nine whole', () => {
    const wrapper = header({ frame: frame({ progress: progress({ done: 300, ahead: 158 }) }) })
    expect(countsOf(wrapper)).toEqual(['300 of 458 done'])
  })

  it('folds and opens with two buttons, each named for what it does', () => {
    const wrapper = header({ frame: frame() })
    const fold = wrapper.get('.graph-frame-fold')
    expect(fold.attributes('aria-label')).toBe('Collapse epic MAIN-12 “Frames on the graph”')
    expect(fold.attributes('aria-expanded')).toBe('true')
    expect(fold.attributes('data-walk-target')).toBe(`frame:${EPIC.work_item_id}:fold`)
    const open = wrapper.get('button.graph-frame-open')
    expect(open.attributes('aria-label')).toBe(
      'Epic MAIN-12 “Frames on the graph” · 8 of 21 done · 2 in progress · 1 blocked',
    )
    expect(open.attributes('data-walk-target')).toBe(`frame:${EPIC.work_item_id}`)
  })

  it('hands its id to fold and its reference to open', async () => {
    const wrapper = header({ frame: frame() })
    await wrapper.get('.graph-frame-fold').trigger('click')
    await wrapper.get('button.graph-frame-open').trigger('click')
    expect(wrapper.emitted('toggle')).toEqual([[EPIC.work_item_id]])
    expect(wrapper.emitted('open')).toEqual([['MAIN-12']])
  })

  it('folded, offers to expand it and keeps its counts and its edge', () => {
    const wrapper = header({ frame: frame({ folded: true, width: 288, height: 72 }) }, 'ru')
    const fold = wrapper.get('.graph-frame-fold')
    expect(fold.attributes('aria-label')).toBe('Развернуть эпик MAIN-12 «Frames on the graph»')
    expect(fold.attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('.graph-frame').classes()).toContain('folded')
    expect(countsOf(wrapper)).toEqual(['8 из 21 готово', '2 в работе', '1 заблокирована'])
    expect(wrapper.findAll('.frame-progress-part')).toHaveLength(4)
  })

  it('over the work under no epic, folds and opens nothing', async () => {
    const wrapper = header({
      frame: frame({ id: NO_EPIC_FRAME, epic: null, progress: progress({ ahead: 3 }) }),
    })
    expect(wrapper.find('button.graph-frame-open').exists()).toBe(false)
    expect(wrapper.find('[data-walk-target="frame:none"]').exists()).toBe(false)
    expect(wrapper.get('.graph-frame-title').text()).toBe('No epic')
    expect(wrapper.get('.graph-frame-fold').attributes('aria-label')).toBe(
      'Collapse the work under no epic',
    )
    expect(wrapper.get('.graph-frame-fold').attributes('data-walk-target')).toBe('frame:none:fold')
    await wrapper.get('.graph-frame-open').trigger('click')
    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('names an item that grew children as an item, not an epic', () => {
    const parent = { ...EPIC, kind: 'task' as const }
    const wrapper = header({ frame: frame({ epic: parent }) })
    expect(wrapper.get('.graph-frame-fold').attributes('aria-label')).toBe(
      'Collapse item MAIN-12 “Frames on the graph”',
    )
  })

  it('says the epic’s state only once it has moved from where work starts', () => {
    const moved = header({ frame: frame() })
    expect(moved.get('.graph-frame-state').text()).toBe('Dev')
    moved.unmount()
    const resting = header({ frame: frame({ epic: { ...EPIC, state: boardItem(1).state } }) })
    expect(resting.find('.graph-frame-state').exists()).toBe(false)
  })

  it('zoomed out, keeps the reference and the edge and drops the words', () => {
    const wrapper = header({ frame: frame(), overview: true })
    expect(wrapper.get('.graph-frame-reference').text()).toBe('MAIN-12')
    expect(wrapper.findAll('.graph-frame-count')).toHaveLength(0)
    expect(wrapper.find('.frame-progress').exists()).toBe(true)
  })

  it('lets the walk give Tab to either of its two targets', () => {
    const wrapper = header({ frame: { ...frame(), id: EPIC.work_item_id } })
    expect(wrapper.get('.graph-frame-fold').attributes('tabindex')).toBe('-1')
    wrapper.unmount()
    const stop = mount(GraphFrame, {
      attachTo: document.body,
      props: { frame: frame(), tabStop: `frame:${EPIC.work_item_id}` },
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages, pluralRules })],
        stubs: { Handle: true },
      },
    })
    expect(stop.get('button.graph-frame-open').attributes('tabindex')).toBe('0')
    expect(stop.get('.graph-frame-fold').attributes('tabindex')).toBe('-1')
  })
})

describe("a frame's progress edge", () => {
  it('runs finished, review, under way, blocked, then ahead, each as long as its share', () => {
    const wrapper = header({
      frame: frame({ progress: progress({ done: 6, review: 1, active: 2, blocked: 1, ahead: 3 }) }),
    })
    const parts = wrapper.findAll('.frame-progress-part')
    expect(parts.map((part) => part.attributes('data-part'))).toEqual([
      'done',
      'review',
      'active',
      'blocked',
      'ahead',
    ])
    expect(parts.map((part) => part.attributes('style'))).toEqual([
      'flex-grow: 6;',
      'flex-grow: 1;',
      'flex-grow: 2;',
      'flex-grow: 1;',
      'flex-grow: 3;',
    ])
    expect(parts.map((part) => part.attributes('data-tone'))).toEqual([
      'success',
      'warning',
      'info',
      'danger',
      'neutral',
    ])
  })
})
