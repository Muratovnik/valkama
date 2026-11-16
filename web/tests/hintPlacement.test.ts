/**
 * Where a hint stands, from its kind, its list and the room beside it, with no page. The window
 * is 1440px wide and a rem 16px, so a hint is drawn at most 320px wide and beside a list no
 * narrower than 192px; a hint stands 6px from what it is placed against and 8px from the edge.
 * A cut text's whole words are laid over it rather than placed beside it: first letter on first
 * letter, as wide as the room to 8px short of the window's right edge.
 */
import assert from 'node:assert/strict'

import { test } from 'vitest'

import { placeHint, placeWhole } from '@/shared/ui/hintPlacement.ts'
import type { Box, HintSetting } from '@/shared/ui/hintPlacement.ts'

const box = (left: number, right: number, top = 100, bottom = 120): Box => ({
  bottom,
  left,
  right,
  top,
})

const setting = (over: Partial<HintSetting>): HintSetting => ({
  aside: box(600, 640),
  kind: 'detail',
  list: null,
  rem: 16,
  width: 200,
  window: 1440,
  ...over,
})

test('a detail stands below its element, from its start; a name below its icon, centred', () => {
  assert.deepEqual(placeHint(setting({ kind: 'detail' })), {
    align: 'start',
    aside: false,
    side: 'bottom',
  })
  assert.deepEqual(placeHint(setting({ kind: 'name' })), {
    align: 'center',
    aside: false,
    side: 'bottom',
  })
})

test('a cut text’s whole words start on its first letter and run to 8px short of the edge', () => {
  // Their own first letter stands 5px in from their box's left and 2px down from its top.
  const inset = { left: 5, top: 2 }
  assert.deepEqual(placeWhole({ inset, letter: { left: 100, top: 50 }, scale: 1, window: 1440 }), {
    left: 95,
    top: 48,
    widest: 1337,
  })
  // In the rail, 12px from the window's left, with a 1024px window.
  assert.deepEqual(placeWhole({ inset, letter: { left: 12, top: 300 }, scale: 1, window: 1024 }), {
    left: 7,
    top: 298,
    widest: 1009,
  })
})

test('on a canvas drawn at half size the whole words take as wide a room in their own type', () => {
  // The inset is measured as drawn, so at half size it is half as far; the room of 1334.5px on
  // the window is 2669px of type drawn at half size.
  assert.deepEqual(
    placeWhole({
      inset: { left: 2.5, top: 1 },
      letter: { left: 100, top: 50 },
      scale: 0.5,
      window: 1440,
    }),
    { left: 97.5, top: 49, widest: 2669 },
  )
})

test('a first letter past the room leaves the whole words no width rather than a negative one', () => {
  const laid = placeWhole({
    inset: { left: 0, top: 0 },
    letter: { left: 1436, top: 0 },
    scale: 1,
    window: 1440,
  })
  assert.equal(laid.widest, 0)
})

test('over a text clamped to its lines the whole words are at least as large as those lines', () => {
  // A clamp of two lines 20px high, 150px wide, its first letter 3px down its first line; the
  // whole words' own letter stands 4px in and 4px down their box, so the box starts 1px over the
  // lines and reaches 1px past them.
  const lines = { left: 100, right: 250, top: 50, bottom: 90 }
  assert.deepEqual(
    placeWhole({
      inset: { left: 4, top: 4 },
      letter: { left: 104, top: 53 },
      lines,
      scale: 1,
      window: 1440,
    }),
    { left: 100, top: 49, widest: 1332, least: { block: 42, inline: 150 } },
  )
  // Drawn at half size, they take as large a room in their own type.
  assert.deepEqual(
    placeWhole({
      inset: { left: 2, top: 2 },
      letter: { left: 102, top: 51.5 },
      lines,
      scale: 0.5,
      window: 1440,
    }).least,
    { block: 82, inline: 300 },
  )
  // Never wider than the room to the window's edge.
  const atEdge = placeWhole({
    inset: { left: 0, top: 0 },
    letter: { left: 1400, top: 50 },
    lines: { left: 1400, right: 1440, top: 50, bottom: 90 },
    scale: 1,
    window: 1440,
  })
  assert.equal(atEdge.least?.inline, atEdge.widest)
})

test('out of a list the room beside an element does not move a hint', () => {
  // An element at the window's right edge: the library keeps the hint inside, not this rule.
  for (const kind of ['name', 'detail'] as const)
    assert.equal(placeHint(setting({ aside: box(1400, 1436), kind })).aside, false, kind)
})

test('in a list every kind stands aside of it, on the right, level with its row', () => {
  for (const list of ['rows', 'columns'] as const)
    for (const kind of ['name', 'detail'] as const)
      assert.deepEqual(
        placeHint(setting({ aside: box(0, 260), kind, list })),
        { align: 'start', aside: true, side: 'right' },
        `${list} ${kind}`,
      )
})

test('a list with no room on the right puts the hint on the left', () => {
  // 1440 - 1100 - 14 = 326 >= 200 on the right; with the row ending at 1300 it is 126.
  assert.equal(placeHint(setting({ aside: box(1000, 1100), list: 'columns' })).side, 'right')
  assert.deepEqual(placeHint(setting({ aside: box(1200, 1300), list: 'columns' })), {
    align: 'start',
    aside: true,
    side: 'left',
  })
})

test('along a chart every period puts its hint on one side, inside the frame, whatever its width', () => {
  // Twenty-eight periods 28px wide, 2px apart, in a frame from 532 to 1416; their hints alternate
  // between 180px and the widest, 320px.
  const frame = { left: 532, right: 1416 }
  const placed = Array.from({ length: 28 }, (_, index) => {
    const aside = box(568 + index * 30, 596 + index * 30)
    const place = placeHint(
      setting({ aside, frame, list: 'columns', width: index % 2 ? 320 : 180 }),
    )
    return { aside, place }
  })
  const sides = placed.map(({ place }) => place.side)
  const changes = sides.filter((side, index) => index > 0 && side !== sides[index - 1])
  assert.deepEqual(changes, ['left'], sides.join(' '))
  assert.equal(sides[0], 'right')
  for (const { aside, place } of placed) {
    // Drawn at most 320px, or as wide as its place allows.
    const drawn = place.widest ?? 320
    const [from, to] =
      place.side === 'right'
        ? [aside.right + 6, aside.right + 6 + drawn]
        : [aside.left - 6 - drawn, aside.left - 6]
    assert.ok(from >= frame.left && to <= frame.right, `${place.side} at ${aside.left}`)
  }
})

test('a small chart that keeps its hints inside puts a period’s inside it, away from the period', () => {
  // A chart 209px wide and 90px high, from 978 to 1187 and 497 to 587; its periods stand in its
  // plot, the lower half, and a name over them would stand in its upper half.
  const frame = { left: 978, right: 1187, inside: { top: 497, bottom: 587 } }
  const period = box(1048, 1117, 539, 586)
  for (const width of [180, 320])
    assert.deepEqual(placeHint(setting({ aside: period, frame, list: 'columns', width })), {
      align: 'start',
      aside: false,
      inside: 'top',
      side: 'bottom',
      widest: 209,
    })
  assert.equal(
    placeHint(setting({ aside: box(978, 1187, 497, 513), frame, list: 'columns' })).inside,
    'bottom',
  )
  // A frame that keeps its hints across alone leaves a period's hint beside it, as before.
  assert.equal(
    placeHint(setting({ aside: period, frame: { left: 978, right: 1187 }, list: 'columns' }))
      .inside,
    undefined,
  )
})

test('a chart’s frame narrower than the window leaves less room beside a period', () => {
  // 1440 - 1000 - 14 = 426 in the window; 1200 - 1000 - 6 = 194 inside the frame.
  const aside = box(970, 1000)
  assert.equal(placeHint(setting({ aside, list: 'columns' })).side, 'right')
  assert.equal(
    placeHint(setting({ aside, frame: { left: 300, right: 1200 }, list: 'columns' })).side,
    'left',
  )
  // A frame from 700 to 1200 holds 320px on neither side of it (264 and 194): the roomier side
  // of the window, 956px on the left, at the hint's whole width rather than narrowed.
  assert.deepEqual(
    placeHint(setting({ aside, frame: { left: 700, right: 1200 }, list: 'columns' })),
    { align: 'start', aside: true, side: 'left' },
  )
})

test('a hint wider than either side is drawn narrower on the roomier one, down to 12rem', () => {
  // Drawn at most 320px: beside a row ending at 1200 the right holds 226 and the left 1086.
  const wide = { list: 'columns', width: 400 } as const
  assert.equal(placeHint(setting({ ...wide, aside: box(1100, 1200) })).side, 'left')
  // Neither side holds 320px: 250 - 14 = 236 left, 1440 - 1190 - 14 = 236 right; the right wins
  // a tie, drawn 236px wide.
  assert.deepEqual(placeHint(setting({ ...wide, aside: box(250, 1190) })), {
    align: 'start',
    aside: true,
    side: 'right',
    widest: 236,
  })
  assert.deepEqual(placeHint(setting({ ...wide, aside: box(200, 1190) })), {
    align: 'start',
    aside: true,
    side: 'right',
    widest: 236,
  })
  // 286 on the left, 126 on the right: the left, drawn 286px wide.
  assert.deepEqual(placeHint(setting({ ...wide, aside: box(300, 1300) })), {
    align: 'start',
    aside: true,
    side: 'left',
    widest: 286,
  })
})

test('a list with no room on either side for 12rem puts the hint above its element', () => {
  // 200 - 14 = 186 and 1440 - 1240 - 14 = 186, both under 192.
  assert.deepEqual(placeHint(setting({ aside: box(200, 1240), list: 'rows', width: 400 })), {
    align: 'center',
    aside: false,
    side: 'top',
  })
  // A narrow hint still fits beside it.
  assert.equal(placeHint(setting({ aside: box(200, 1240), list: 'rows', width: 150 })).aside, true)
})

test('a side a registered exception writes is kept, against its element, list or not', () => {
  const asked = { align: 'center', side: 'top' } as const
  assert.deepEqual(placeHint(setting({ asked, list: 'rows' })), { ...asked, aside: false })
  // Beside its element, flipped and narrowed by the same rules as a list's hint.
  const right = { align: 'start', side: 'right' } as const
  assert.deepEqual(placeHint(setting({ asked: right, list: 'rows' })), { ...right, aside: false })
  assert.deepEqual(placeHint(setting({ asked: right, aside: box(1200, 1300) })), {
    align: 'start',
    aside: false,
    side: 'left',
  })
})
