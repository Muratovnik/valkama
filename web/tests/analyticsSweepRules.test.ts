/**
 * The rules the Analytics sweep judges real pages by (`tests/sweep/sweepRules.ts`), on made-up
 * geometry worked out by hand from the rules as `DESIGN.md` and `src/shared/ui/hintReach.ts` state
 * them: within a mark's reach its own hint wins, the nearest of several, twins within a pixel
 * answering either; a step line finds a place before a reading; a mark's hint stands at the mark;
 * only a table or a row of like items scrolls sideways, by a reachable amount, and never the page
 * or because of content out of flow; a forbidden text counts where the product writes it, not
 * where a name of the data shown quotes it. Its misses are counted by the measure each view was
 * opened with too, and the measures it may open with are the page's. A sweep whose rules pass a
 * defect closes no remark.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { MEASURES } from '@/shared/api/analyticsAddress.ts'

import {
  answeringMarks,
  expectedAmong,
  expectedOnLine,
  hintSays,
  judge,
  judgedMark,
  namesIn,
  occurrences,
  panelNote,
  placementMiss,
  scrollMiss,
} from './sweep/sweepRules.ts'
import type { Answer, Box, ScrollReading } from './sweep/sweepRules.ts'
import { MEASURES as SWEPT_MEASURES } from './sweep/sweepStates.ts'
import { summarize } from './sweep/sweepSummary.ts'
import type { Miss } from './sweep/sweepSummary.ts'

const box = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
})

/** A frame 300px wide holding a 400px table, changed by `more`. */
const frame = (more: Partial<ScrollReading>): ScrollReading => ({
  clientWidth: 300,
  escapes: false,
  inflow: 400,
  maker: { kind: 'table', unit: 80 },
  page: false,
  scrolls: true,
  scrollWidth: 400,
  ...more,
})

/** A sliver of `path` at `width` and `period`, owned by `owner`. */
const miss = (
  width: number,
  period: string,
  path: string,
  { owner = 'ChartTable', measure = '' } = {},
): Miss => ({
  class: 'overflow',
  rule: 'sliver',
  owner,
  path,
  detail: {},
  state: { width, period, section: 'one', measure, view: 'opening', panel: false },
})

/** A hint 6px right of the box mark at 100..140, saying `says`, painting `painted`. */
const answer = (says: string[], painted: string[] | null = null): Answer => ({
  box: box(146, 100, 120, 40),
  painted,
  says,
  text: says.join(' '),
})

describe('what may answer the pointer among boxes', () => {
  test('the box under the pointer answers, a neighbour near it does not', () => {
    const marks = [
      { id: 'a', box: box(0, 0, 20, 20) },
      { id: 'b', box: box(22, 0, 20, 20) },
    ]
    assert.deepEqual(expectedAmong(marks, 'a', { x: 10, y: 10 }), ['a'])
    // 1px past a's right edge and 1px short of b's left edge: one each way, both may answer.
    assert.deepEqual(expectedAmong(marks, 'a', { x: 21, y: 10 }), ['a', 'b'])
    // On b, 3px past a: b is the nearer.
    assert.deepEqual(expectedAmong(marks, 'a', { x: 23, y: 10 }), ['b'])
  })

  test('the pointer is taken as the pixel square right and down of its point', () => {
    // Columns 3px wide and 2px apart, as a day's minutes stand at a phone's width.
    const marks = [
      { id: 'a', box: box(0, 0, 3, 100) },
      { id: 'b', box: box(5, 0, 3, 100) },
    ]
    // 0.4px past a and 1.6px short of b: the square reaches within 0.6px of b, and either answers.
    assert.deepEqual(expectedAmong(marks, 'b', { x: 3.4, y: 50 }), ['a', 'b'])
    // On a, 2px short of b: the square stays 1px short, and a is the nearer by more than a pixel.
    assert.deepEqual(expectedAmong(marks, 'a', { x: 2, y: 50 }), ['a'])
    // 0.4px past b's right edge the square gains nothing: b is still 0.4px away.
    assert.deepEqual(expectedAmong(marks, 'b', { x: 8.4, y: 50 }), ['b'])
  })

  test('a point no mark reaches within 3px still expects the mark aimed at', () => {
    assert.deepEqual(expectedAmong([{ id: 'a', box: box(0, 0, 2, 2) }], 'a', { x: 8, y: 1 }), ['a'])
  })

  test('a drawn shape answers only where it takes the pointer, on its fill or its stroke', () => {
    const marks = [
      { id: 'ring', box: box(0, 0, 100, 100), onShape: false },
      { id: 'key', box: box(40, 40, 20, 20) },
    ]
    assert.deepEqual(expectedAmong(marks, 'ring', { x: 50, y: 50 }), ['key'])
  })
})

describe('what may answer the pointer on a step line', () => {
  const marks = [
    { id: 'r1', x: 10, place: false },
    { id: 'r2', x: 14, place: false },
    { id: 'r3', x: 14.5, place: false },
    { id: 'restart', x: 16, place: true },
    { id: 'now', x: 60, place: true },
  ]

  test('a place within reach is found before a nearer reading', () => {
    assert.deepEqual(expectedOnLine(marks, 14, 6), ['restart'])
  })

  test('without a place in reach the nearest reading answers, twins within 1px either', () => {
    assert.deepEqual(expectedOnLine(marks, 14.2, 1.5), ['r2', 'r3'])
    assert.deepEqual(expectedOnLine(marks, 9, 1.5), ['r1'])
  })

  test("out of every mark's reach the mark whose stretch holds the pointer answers", () => {
    assert.deepEqual(expectedOnLine(marks, 40, 6), ['restart'])
    assert.deepEqual(expectedOnLine(marks, 2, 6), ['r1'])
  })
})

describe("where a mark's hint stands", () => {
  const bar = { kind: 'box' as const, box: box(100, 100, 40, 10) }

  test('a hint 6px past a box mark stands at it, one 30px off does not', () => {
    assert.equal(placementMiss(box(146, 100, 120, 40), bar, { x: 120, y: 105 }), null)
    assert.deepEqual(placementMiss(box(170, 100, 120, 40), bar, { x: 120, y: 105 }), {
      rule: 'away-from-mark',
      by: 30,
    })
  })

  test("a point's hint has its corner 6px off the point and stands near the pointer", () => {
    const point = { kind: 'point' as const, box: box(200, 200, 0, 0) }
    // Bottom left corner 6px right of and 6px over the point.
    const hint = box(206, 154, 120, 40)
    assert.equal(placementMiss(hint, point, { x: 201, y: 199 }), null)
    // The same hint read from a pointer 80px along the shape the point stands for.
    assert.deepEqual(placementMiss(hint, point, { x: 126, y: 200 }), {
      rule: 'far-from-pointer',
      by: 80,
    })
  })

  test('a point a drawn shape names off the shape is no place of its mark, however near', () => {
    const hint = box(206, 154, 120, 40)
    const on = { kind: 'point' as const, box: box(200, 200, 0, 0), onShape: true }
    assert.equal(placementMiss(hint, on, { x: 201, y: 199 }), null)
    // The same corner 6px off the point and by the pointer, the point beside the sector.
    assert.deepEqual(placementMiss(hint, { ...on, onShape: false }, { x: 201, y: 199 }), {
      rule: 'away-from-mark',
      by: 8,
    })
  })
})

describe('what the sweep notes of the value panel', () => {
  test('a state whose marks act and open no panel is noted', () => {
    assert.equal(panelNote(3, false), 'no mark opened the value panel')
  })

  test('nothing is noted where a mark opened it, or where no mark acts, as a token kind', () => {
    assert.equal(panelNote(3, true), null)
    assert.equal(panelNote(0, false), null)
  })
})

describe('how the page answered the pointer', () => {
  const aimed = { id: 'a', place: { kind: 'box' as const, box: box(100, 100, 40, 10) } }
  const at = { x: 120, y: 105 }

  test('its own hint, standing at the mark and painting it, is no miss', () => {
    assert.deepEqual(judge(answer(['a'], ['a']), ['a'], aimed, at), [])
    // A twin may answer for it.
    assert.deepEqual(judge(answer(['b']), ['a', 'b'], aimed, at), [])
  })

  test("no hint and another mark's hint are misses, naming what was found", () => {
    assert.deepEqual(judge(null, ['a'], aimed, at), [{ rule: 'no-hint', found: { ids: [] } }])
    assert.deepEqual(judge(answer(['b']), ['a'], aimed, at), [
      { rule: 'other-hint', found: { ids: ['b'] } },
    ])
    assert.deepEqual(judge({ ...answer([]), text: 'words' }, ['a'], aimed, at), [
      { rule: 'other-hint', found: { text: 'words' } },
    ])
  })

  test('its own hint over another mark painted as pointed at is a miss', () => {
    assert.deepEqual(judge(answer(['a'], ['b']), ['a'], aimed, at), [
      { rule: 'painted-other', found: { ids: ['b'] } },
    ])
  })

  test('its own hint standing away from the mark is a miss', () => {
    const away = { ...answer(['a']), box: box(170, 100, 120, 40) }
    assert.deepEqual(judge(away, ['a'], aimed, at), [
      { rule: 'away-from-mark', found: { text: 'hint 30px off' } },
    ])
  })
})

describe('which marks a shown hint says', () => {
  test("a hint says its element's words, the one whose words it is whole before the others", () => {
    const marks = [
      { id: 'name', own: 'Alpha', words: 'Alpha' },
      { id: 'longer', own: 'Alphabet', words: 'Alphabet' },
      { id: 'other', own: 'Beta', words: 'Beta' },
    ]
    assert.deepEqual(hintSays('Alpha', marks), ['name'])
    assert.deepEqual(hintSays('Gamma', marks), [])
  })

  test('a detail on cut words says them whole before the detail, as the hint of a row name', () => {
    // A rail tile cut to its first value's name, marked with that value's detail alone, and a
    // table's row name, marked with the name and the detail: both hints read the same.
    const marks = [
      { id: 'tile', own: 'Planningthesystem', words: 'agent·a1b2' },
      { id: 'row', own: 'Planningthesystemagent·a1b2', words: 'Planningthesystemagent·a1b2' },
    ]
    assert.deepEqual(hintSays('Planningthesystemagent·a1b2', marks), ['tile', 'row'])
  })

  test("a place's hint says the words of the place near it after its own", () => {
    const marks = [
      { id: 'first', own: '', words: 'Reset13:00Reset13:05' },
      { id: 'second', own: '', words: 'Reset13:05Reset13:00' },
    ]
    assert.deepEqual(hintSays('Reset13:05Reset13:00', marks), ['second'])
    // Its words read twice, as a hint drawn as a grid holds them, hold the other's in between.
    assert.deepEqual(hintSays('Reset13:05Reset13:00Reset13:05', marks), ['first', 'second'])
  })
})

describe("which mark's place a hint that answered is judged at", () => {
  const places = ['a', 'b']

  test('the one aimed at, where it may answer and the hint says it, before the places', () => {
    assert.deepEqual(answeringMarks(['a'], ['a'], { aimed: 'a', places }), ['a'])
    assert.deepEqual(answeringMarks(['a', 'b'], ['a', 'b'], { aimed: 'a', places }), ['a', 'b'])
  })

  test('the nearer place, where it alone may answer, though the hint says both', () => {
    assert.deepEqual(answeringMarks(['a', 'b'], ['b'], { aimed: 'a', places }), ['b'])
    assert.deepEqual(answeringMarks(['b'], ['a', 'b'], { aimed: 'a', places }), ['b'])
  })

  test("the one aimed at, where the hint is another's, which is a miss of its own", () => {
    assert.deepEqual(answeringMarks(['c'], ['a'], { aimed: 'a', places }), ['a'])
  })

  test('the reading aimed at, where another reading answered, which stands at its own dot', () => {
    // A reading 3px off another is a third one, or one of several saying the same words.
    assert.deepEqual(answeringMarks(['r2', 'r3'], ['r1', 'r2', 'r3'], { aimed: 'r1', places }), [
      'r1',
    ])
    assert.deepEqual(answeringMarks(['r2'], ['r2'], { aimed: 'r1', places: [] }), ['r1'])
  })

  test("a hint at the nearer place's mark is judged there, not at the place aimed at", () => {
    // Two restarts 3px apart on falls of their own, the pointer 3px past the first onto the
    // second: the second's hint stands 6px past its mark, 22px from the first's.
    const first = { kind: 'box' as const, box: box(97, 80, 6, 6) }
    const second = { kind: 'box' as const, box: box(100, 106, 6, 6) }
    const shown = { ...answer(['a', 'b']), box: box(112, 106, 120, 40) }
    const pointer = { x: 103, y: 109 }
    const [judged] = answeringMarks(shown.says, ['b'], { aimed: 'a', places })
    const place = judged === 'b' ? second : first
    assert.deepEqual(judge(shown, ['b'], { id: judged ?? 'a', place }, pointer), [])
    assert.deepEqual(judge(shown, ['b'], { id: 'a', place: first }, pointer), [
      { rule: 'away-from-mark', found: { text: 'hint 22px off' } },
    ])
  })

  test("a reading another reading answered for is not judged at the other's dot", () => {
    // The pointer 3px past a reading on a steep rise finds the reading 13px above it, whose hint
    // stands at its own dot, 27px from the pointer: judged at the one aimed at, which the hint
    // does not say, it is no miss of placement.
    const aimed = { kind: 'point' as const, box: box(100, 100, 8, 8) }
    const found = { kind: 'point' as const, box: box(106, 87, 8, 8) }
    const shown = { ...answer(['r2']), box: box(120, 27, 170, 54) }
    const [judged] = answeringMarks(shown.says, ['r1', 'r2'], { aimed: 'r1', places: [] })
    const place = judged === 'r2' ? found : aimed
    const at = { x: 107, y: 104 }
    assert.deepEqual(judge(shown, ['r1', 'r2'], { id: judged ?? 'r1', place }, at), [])
    assert.deepEqual(judge(shown, ['r1', 'r2'], { id: 'r2', place: found }, at), [
      { rule: 'far-from-pointer', found: { text: 'hint 26px off' } },
    ])
  })

  test('of two places as near the pointer, the one whose mark the hint stands right at', () => {
    // «Now» 2px off the pointer and the forecast's end 3px off it: «now» answered, its hint 6px
    // left of its dot, 13px left of the end's.
    const end = { id: 'end', place: { kind: 'box' as const, box: box(223, 80, 8, 8) } }
    const now = { id: 'now', place: { kind: 'box' as const, box: box(218, 85, 8, 8) } }
    const hint = box(8, 60, 204, 200)
    const at = { x: 224, y: 84 }
    assert.equal(judgedMark([end, now], hint, at)?.id, 'now')
    assert.equal(judgedMark([end], hint, at)?.id, 'end')
    assert.equal(judgedMark([], hint, at), undefined)
  })
})

describe("whether a sideways scroll is the design's", () => {
  test('a table wider than its frame by more than the least target scrolls by design', () => {
    assert.equal(scrollMiss(frame({})), null)
    assert.equal(scrollMiss(frame({ maker: { kind: 'row', unit: 30 } })), null)
  })

  test('a scroll shorter than the least target is a sliver', () => {
    assert.deepEqual(scrollMiss(frame({ scrollWidth: 316, inflow: 316 })), {
      rule: 'sliver',
      by: 16,
    })
  })

  test('content out of flow that widens a box is no row of it', () => {
    assert.deepEqual(scrollMiss(frame({ escapes: true, inflow: 300, scrollWidth: 450 })), {
      rule: 'out-of-flow',
      by: 150,
    })
    // Out-of-flow content inside the reach of the in-flow table changes nothing.
    assert.equal(scrollMiss(frame({ escapes: true })), null)
  })

  test('the page never scrolls sideways, and what is neither a table nor a row does not', () => {
    assert.deepEqual(scrollMiss(frame({ page: true })), { rule: 'page-scroll', by: 100 })
    assert.deepEqual(scrollMiss(frame({ maker: { kind: 'other', unit: 0 } })), {
      rule: 'not-a-row',
      by: 100,
    })
  })

  test('a box that does not scroll cuts its text, which is not a scroll', () => {
    assert.equal(scrollMiss(frame({ scrolls: false, maker: { kind: 'other', unit: 0 } })), null)
    assert.equal(scrollMiss(frame({ scrollWidth: 301 })), null)
  })
})

test('a forbidden text is counted wherever it stands, whatever space it is written with', () => {
  assert.equal(
    occurrences('a: less than a minute · b: less than a minute', 'less than a minute'),
    2,
  )
  assert.equal(occurrences('a minute', 'less than a minute'), 0)
})

describe('a forbidden text a name of the data quotes', () => {
  const UNDER = 'less than a minute'
  const TITLE = 'Fix «less than a minute» in the legend'

  test('in a hint, is the name’s and not counted, while the product’s own words beside it are', () => {
    const hint = `MAIN-7 ${TITLE} 3 min`
    assert.equal(occurrences(hint, UNDER, [TITLE]), 0)
    assert.equal(occurrences(`${hint} · Unknown ${UNDER} <1 %`, UNDER, [TITLE]), 1)
    // Without the names a sweep counts the title as the product's words.
    assert.equal(occurrences(hint, UNDER), 1)
  })

  test('in a title drawn in runs, whose code stands alone and without its backticks', () => {
    // The code run's own text, read in the name it stands in, four letters after the name's start.
    const contexts = [{ context: `Say ${UNDER} once`, at: 4 }]
    assert.equal(occurrences(UNDER, UNDER, [`Say \`${UNDER}\` once`], contexts), 0)
  })

  test('in a cell beside a name that quotes it, the cell is still the product’s', () => {
    const name = `MAIN-7 ${TITLE}`
    const contexts = [{ context: `${name}${UNDER}`, at: name.length }]
    assert.equal(occurrences(UNDER, UNDER, [TITLE], contexts), 1)
  })
})

test('the names of the data are every title and name an answer holds, at any depth', () => {
  const answer = {
    label: 'no name',
    rows: [{ group: { work_item: { id: 'w-1', title: 'A task' }, model: { name: 'model-a' } } }],
    total: { title: 7 },
  }
  assert.deepEqual(namesIn(answer), ['A task', 'model-a'])
})

test('misses are grouped by class, rule and owner, counted by width, period and section', () => {
  const summary = summarize([
    miss(1280, 'week', 'a'),
    miss(1280, 'today', 'a'),
    miss(390, 'week', 'b'),
    miss(390, 'week', 'c', { owner: 'Other' }),
  ])
  assert.equal(summary.total, 4)
  assert.deepEqual(summary.byClass, { overflow: 4 })
  assert.equal(summary.groups.length, 2)
  const [table] = summary.groups
  assert.equal(table.owner, 'ChartTable')
  assert.equal(table.count, 3)
  assert.equal(table.paths, 2)
  assert.deepEqual(table.byWidth, { 1280: 2, 390: 1 })
  assert.deepEqual(table.byPeriod, { week: 2, today: 1 })
})

test('misses are counted by the measure their view was opened with, the opening one apart', () => {
  const summary = summarize([
    miss(1280, 'week', 'a', { measure: 'cost' }),
    miss(1280, 'week', 'b', { measure: 'cost' }),
    miss(1024, 'week', 'a', { measure: 'tokens' }),
    miss(1024, 'week', 'a'),
  ])
  const [table] = summary.groups
  assert.equal(summary.groups.length, 1)
  assert.deepEqual(table.byMeasure, { cost: 2, tokens: 1, opening: 1 })
  assert.equal(table.examples[0]?.state, '1280 one week cost opening')
})

test('the sweep opens views with the measures the page has, every one of them', () => {
  assert.deepEqual([...SWEPT_MEASURES].sort(), [...MEASURES].sort())
})
