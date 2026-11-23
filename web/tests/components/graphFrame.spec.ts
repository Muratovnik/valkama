/**
 * A goal's frame on the graph, as the reader meets its header: how its work
 * stands in words with each number beside its word, what folding and opening
 * it are called, and the work under no goal, which has nothing to open.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import GraphFrame from '@/widgets/work-item-graph/components/GraphFrame.vue'
import { NO_PARENT_FRAME, spaceFrameId } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { FrameProgress, PlacedFrame } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { boardItem } from '../fixtures/board.ts'

afterEach(() => {
  document.body.innerHTML = ''
})

const GOAL = boardItem(12, 'dev', {
  kind: 'goal',
  title: 'Frames on the graph',
})

const progress = (counts: Partial<FrameProgress>): FrameProgress => {
  const whole = { done: 0, review: 0, active: 0, blocked: 0, ahead: 0, ...counts }
  const total = whole.done + whole.review + whole.active + whole.blocked + whole.ahead
  return { ...whole, total }
}

function frame(overrides: Partial<PlacedFrame> = {}): PlacedFrame {
  return {
    id: GOAL.work_item_id,
    goal: GOAL,
    parentId: null,
    folded: false,
    foldable: true,
    x: 0,
    y: 0,
    width: 600,
    height: 200,
    header: 120,
    progress: progress({ done: 8, active: 2, blocked: 1, ahead: 10 }),
    members: [],
    ...overrides,
  }
}

function header(
  props: { frame: PlacedFrame; far?: boolean; overview?: boolean },
  locale: 'en' | 'ru' = 'en',
) {
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
    expect(countsOf(one)).toEqual(['1 из 2 выполнено', '1 заблокирована'])
    one.unmount()
    const few = header({ frame: frame({ progress: progress({ review: 3, blocked: 4 }) }) }, 'ru')
    expect(countsOf(few)).toEqual(['0 из 7 выполнено', '3 на проверке', '4 заблокированы'])
    few.unmount()
    const many = header({ frame: frame({ progress: progress({ blocked: 15 }) }) }, 'ru')
    expect(countsOf(many)).toEqual(['0 из 15 выполнено', '15 заблокировано'])
  })

  it('stands each number beside its word rather than inside the translated words', () => {
    const wrapper = header({ frame: frame() })
    const badges = wrapper.findAll('.graph-frame-count .count-badge').map((badge) => badge.text())
    expect(badges).toEqual(['8', '21', '2', '1'])
  })

  it('counts a goal far past a badge’s ninety-nine whole', () => {
    const wrapper = header({ frame: frame({ progress: progress({ done: 300, ahead: 158 }) }) })
    expect(countsOf(wrapper)).toEqual(['300 of 458 done'])
  })

  it('folds and opens with two buttons, each named for what it does', () => {
    const wrapper = header({ frame: frame() })
    const fold = wrapper.get('.graph-frame-fold')
    expect(fold.attributes('aria-label')).toBe('Collapse goal MAIN-12 “Frames on the graph”')
    expect(fold.attributes('aria-expanded')).toBe('true')
    expect(fold.attributes('data-walk-target')).toBe(`frame:${GOAL.work_item_id}:fold`)
    const open = wrapper.get('button.graph-frame-open')
    expect(open.attributes('aria-label')).toBe(
      'Goal MAIN-12 “Frames on the graph” · 8 of 21 done · 2 in progress · 1 blocked',
    )
    expect(open.attributes('data-walk-target')).toBe(`frame:${GOAL.work_item_id}`)
  })

  it('hands its id to fold and its reference to open', async () => {
    const wrapper = header({ frame: frame() })
    await wrapper.get('.graph-frame-fold').trigger('click')
    await wrapper.get('button.graph-frame-open').trigger('click')
    expect(wrapper.emitted('toggle')).toEqual([[GOAL.work_item_id]])
    expect(wrapper.emitted('open')).toEqual([['MAIN-12']])
  })

  it('folded, offers to expand it and keeps its counts and its edge', () => {
    const wrapper = header({ frame: frame({ folded: true, width: 288, height: 72 }) }, 'ru')
    const fold = wrapper.get('.graph-frame-fold')
    expect(fold.attributes('aria-label')).toBe(
      'Развернуть цель MAIN-12 «Frames on the graph» · 13 открытых внутри',
    )
    expect(fold.attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('.graph-frame').classes()).toContain('folded')
    expect(countsOf(wrapper)).toEqual(['8 из 21 выполнено', '2 в работе', '1 заблокирована'])
    expect(wrapper.findAll('.frame-progress-part')).toHaveLength(4)
  })

  it('over the work under no goal, folds and opens nothing', async () => {
    const wrapper = header({
      frame: frame({ id: NO_PARENT_FRAME, goal: null, progress: progress({ ahead: 3 }) }),
    })
    expect(wrapper.find('button.graph-frame-open').exists()).toBe(false)
    expect(wrapper.find('[data-walk-target="frame:none"]').exists()).toBe(false)
    expect(wrapper.get('.graph-frame-title').text()).toBe('No goal')
    expect(wrapper.get('.graph-frame-fold').attributes('aria-label')).toBe(
      'Collapse the work under no goal',
    )
    expect(wrapper.get('.graph-frame-fold').attributes('data-walk-target')).toBe('frame:none:fold')
    await wrapper.get('.graph-frame-open').trigger('click')
    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('says «Без цели» over the work under no goal, as the board’s lane and the list’s group do', () => {
    const none = frame({ id: NO_PARENT_FRAME, goal: null, folded: true })
    const wrapper = header({ frame: none }, 'ru')
    expect(wrapper.get('.graph-frame-title').text()).toBe('Без цели')
    expect(wrapper.get('.graph-frame-fold').attributes('aria-label')).toMatch(
      /^Развернуть работу без цели · /u,
    )
  })

  it('names another space’s frame as the list’s group of that space, and opens nothing there', async () => {
    const space = { key: 'BETA', name: 'Beta' }
    const wrapper = header(
      { frame: frame({ id: spaceFrameId('BETA'), goal: null, space, folded: true }) },
      'ru',
    )
    expect(wrapper.get('.graph-frame-title').text()).toBe('Пространство BETA · Beta')
    expect(wrapper.find('button.graph-frame-open').exists()).toBe(false)
    expect(wrapper.get('.graph-frame-fold').attributes('aria-label')).toMatch(
      /^Развернуть работу пространства BETA · Beta · /u,
    )
    await wrapper.get('.graph-frame-open').trigger('click')
    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('names a stage as a stage, not as the goal it stands under', () => {
    const stage = { ...GOAL, kind: 'stage' as const, parent_id: boardItem(3).work_item_id }
    const wrapper = header({ frame: frame({ goal: stage }) })
    expect(wrapper.get('.graph-frame-fold').attributes('aria-label')).toBe(
      'Collapse stage MAIN-12 “Frames on the graph”',
    )
  })

  it('says the goal’s state only once it has moved from where work starts', () => {
    const moved = header({ frame: frame() })
    expect(moved.get('.graph-frame-state').text()).toBe('In progress')
    moved.unmount()
    const resting = header({ frame: frame({ goal: { ...GOAL, state: boardItem(1).state } }) })
    expect(resting.find('.graph-frame-state').exists()).toBe(false)
  })

  it('zoomed out, keeps the reference and the edge and drops the words', () => {
    const wrapper = header({ frame: frame(), overview: true })
    expect(wrapper.get('.graph-frame-reference').text()).toBe('MAIN-12')
    expect(wrapper.findAll('.graph-frame-count')).toHaveLength(0)
    expect(wrapper.find('.frame-progress').exists()).toBe(true)
  })

  it('lets the walk give Tab to either of its two targets', () => {
    const wrapper = header({ frame: { ...frame(), id: GOAL.work_item_id } })
    expect(wrapper.get('.graph-frame-fold').attributes('tabindex')).toBe('-1')
    wrapper.unmount()
    const stop = mount(GraphFrame, {
      attachTo: document.body,
      props: { frame: frame(), tabStop: `frame:${GOAL.work_item_id}` },
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages, pluralRules })],
        stubs: { Handle: true },
      },
    })
    expect(stop.get('button.graph-frame-open').attributes('tabindex')).toBe('0')
    expect(stop.get('.graph-frame-fold').attributes('tabindex')).toBe('-1')
  })
})

const empty = () => frame({ folded: true, foldable: false, progress: progress({}) })

describe('a frame with nothing to unfold', () => {
  it('says it has no tasks, in place of counting none of none, in both languages', () => {
    const ru = header({ frame: empty() }, 'ru')
    expect(countsOf(ru)).toEqual(['Нет задач'])
    ru.unmount()
    const en = header({ frame: empty() })
    expect(countsOf(en)).toEqual(['No tasks'])
    expect(en.get('button.graph-frame-open').attributes('aria-label')).toBe(
      'Goal MAIN-12 “Frames on the graph” · No tasks',
    )
  })

  it('draws no empty edge and no fold, and still opens the goal', async () => {
    const wrapper = header({ frame: empty() })
    expect(wrapper.find('.frame-progress').exists()).toBe(false)
    expect(wrapper.find('.graph-frame-fold').exists()).toBe(false)
    await wrapper.get('button.graph-frame-open').trigger('click')
    expect(wrapper.emitted('open')).toEqual([['MAIN-12']])
  })

  it('zoomed out, keeps its reference and draws no edge either', () => {
    const wrapper = header({ frame: empty(), overview: true })
    expect(wrapper.get('.graph-frame-reference').text()).toBe('MAIN-12')
    expect(wrapper.find('.frame-progress').exists()).toBe(false)
  })

  it('whose work the view hides, counts it and draws its edge, with no fold to press', () => {
    const wrapper = header({
      frame: frame({ folded: true, foldable: false, progress: progress({ done: 7 }) }),
    })
    expect(countsOf(wrapper)).toEqual(['7 of 7 done'])
    expect(wrapper.findAll('.frame-progress-part')).toHaveLength(1)
    expect(wrapper.find('.graph-frame-fold').exists()).toBe(false)
  })

  it('that holds another goal and no tasks, says so and keeps the fold', () => {
    const wrapper = header({ frame: frame({ foldable: true, progress: progress({}) }) })
    expect(countsOf(wrapper)).toEqual(['No tasks'])
    expect(wrapper.find('.frame-progress').exists()).toBe(false)
    expect(wrapper.find('.graph-frame-fold').exists()).toBe(true)
  })
})

const folded = () => frame({ folded: true, progress: progress({ done: 180, active: 90 }) })
const inside = (props: { far?: boolean; overview?: boolean }) =>
  header({ frame: folded(), ...props }, 'ru')
    .get('.graph-frame-inside')
    .text()

describe('a folded frame', () => {
  it('says what it hides at every zoom, shorter as the words stop being read', () => {
    expect(inside({})).toBe('90 открытых внутри')
    expect(inside({ overview: true })).toBe('90 внутри')
    expect(inside({ overview: true, far: true })).toBe('+90')
  })

  it('takes the plural from its own number, and says the same in English', () => {
    const one = frame({ folded: true, progress: progress({ done: 3, ahead: 1 }) })
    expect(header({ frame: one }, 'ru').get('.graph-frame-inside').text()).toBe('1 открытая внутри')
    expect(header({ frame: folded() }).get('.graph-frame-inside').text()).toBe('90 open inside')
  })

  it('tells the keyboard what the header shows, on each button and at every zoom', () => {
    const near = header({ frame: folded() })
    expect(near.get('.graph-frame-fold').attributes('aria-label')).toBe(
      'Expand goal MAIN-12 “Frames on the graph” · 90 open inside',
    )
    const far = header({ frame: folded(), overview: true, far: true })
    expect(far.get('button.graph-frame-open').attributes('aria-label')).toBe(
      'Goal MAIN-12 “Frames on the graph” · 180 of 270 done · 90 in progress · 90 open inside',
    )
  })

  it('with nothing open says what closed work it hides rather than none', () => {
    const closed = frame({ folded: true, progress: progress({ done: 7 }) })
    expect(header({ frame: closed }, 'ru').get('.graph-frame-inside').text()).toBe(
      '7 закрытых внутри',
    )
  })

  it('is marked as a stack by more than its words; an open one and one with nothing inside are not', () => {
    expect(header({ frame: folded() }).get('.graph-frame').classes()).toContain('holding')
    const open = header({ frame: frame({ progress: progress({ active: 90 }) }) })
    expect(open.get('.graph-frame').classes()).not.toContain('holding')
    expect(open.find('.graph-frame-inside').exists()).toBe(false)
    const nothing = header({
      frame: frame({ folded: true, foldable: false, progress: progress({ done: 7 }) }),
    })
    expect(nothing.get('.graph-frame').classes()).not.toContain('holding')
    expect(nothing.find('.graph-frame-inside').exists()).toBe(false)
  })

  it('far out gives its band to the count, and a goal with nothing hidden keeps its reference', () => {
    const counted = header({ frame: folded(), overview: true, far: true })
    expect(counted.find('.graph-frame-reference').exists()).toBe(false)
    const empty = header({
      frame: frame({ folded: true, foldable: false, progress: progress({}) }),
      overview: true,
      far: true,
    })
    expect(empty.get('.graph-frame-reference').text()).toBe('MAIN-12')
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
