/**
 * Where a hint stands, from its kind, its list and the room beside it, with no page. The window
 * is 1440px wide and a rem 16px, so a hint is drawn at most 320px wide and beside a list no
 * narrower than 192px; a hint stands 6px from what it is placed against and 8px from the edge.
 */
import assert from 'node:assert/strict'

import { test } from 'vitest'

import { placeHint } from '@/shared/ui/hintPlacement.ts'
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

test('a clipped text keeps its place above its element, centred', () => {
  assert.deepEqual(placeHint(setting({ kind: 'clipped' })), {
    align: 'center',
    aside: false,
    side: 'top',
  })
})

test('out of a list the room beside an element does not move a hint', () => {
  // An element at the window's right edge: the library keeps the hint inside, not this rule.
  for (const kind of ['name', 'clipped', 'detail'] as const)
    assert.equal(placeHint(setting({ aside: box(1400, 1436), kind })).aside, false, kind)
})

test('in a list every kind stands aside of it, on the right, level with its row', () => {
  for (const list of ['rows', 'columns'] as const)
    for (const kind of ['name', 'clipped', 'detail'] as const)
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
