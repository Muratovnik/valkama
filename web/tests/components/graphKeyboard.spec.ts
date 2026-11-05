/**
 * The field's one Tab stop when frames fold: the target the keyboard stood on
 * while it is drawn, the fold of the frame that hid it once a fold took it off
 * the field, and the camera's anchor otherwise.
 */
import { effectScope, nextTick, ref } from 'vue'

import { afterEach, describe, expect, it } from 'vitest'

import { useGraphKeyboard } from '@/widgets/work-item-graph/composables/useGraphKeyboard.ts'
import type { PlacedFrame } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { GraphLayout } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import { foldTarget, frameTarget } from '@/widgets/work-item-graph/utils/graphWalk.ts'

import { boardItem } from '../fixtures/board.ts'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
})

function frame(id: string, folded: boolean, parentId: string | null = null): PlacedFrame {
  return {
    id,
    epic: { ...boardItem(1, 'backlog'), work_item_id: id },
    parentId,
    folded,
    foldable: true,
    x: 0,
    y: parentId ? 80 : 0,
    width: folded ? 288 : 640,
    height: folded ? 72 : 400,
    progress: { active: 0, ahead: 1, blocked: 0, done: 0, review: 0, total: 1 },
    members: ['card'],
  }
}

/** Outer frame O holds inner frame I, which holds one card. */
function field(outer: boolean, inner: boolean): GraphLayout {
  const frames = outer ? [frame('O', true)] : [frame('O', false), frame('I', inner, 'O')]
  const nodes =
    outer || inner
      ? []
      : [
          {
            ...boardItem(2, 'backlog'),
            work_item_id: 'card',
            x: 16,
            y: 152,
            width: 264,
            height: 112,
            frameId: 'I',
          },
        ]
  return { frames, nodes, edges: [], width: 700, height: 500 }
}

function keyboard(anchor = foldTarget('O')) {
  const placed = ref<GraphLayout | null>(field(false, false))
  const overview = ref(false)
  const scope = effectScope()
  scopes.push(scope)
  const keys = scope.run(() =>
    useGraphKeyboard({
      anchorId: ref(anchor),
      canvas: ref(null),
      fitted: ref(true),
      overview,
      placed,
      focusRequest: () => {},
      reveal: () => {},
    }),
  )
  if (!keys) throw new Error('Keyboard scope did not start')
  return { keys, overview, placed }
}

describe('the Tab stop as frames fold', () => {
  it('is the card the keyboard stood on while it is drawn', async () => {
    const { keys } = keyboard()
    keys.onFocus('card')
    await nextTick()
    expect(keys.isTabStop('card')).toBe(true)
    expect(keys.isTabStop(foldTarget('O'))).toBe(false)
  })

  it('becomes the fold of the frame that hid it, the innermost one still drawn', async () => {
    const { keys, placed } = keyboard()
    keys.onFocus('card')
    placed.value = field(false, true)
    await nextTick()
    expect(keys.isTabStop(foldTarget('I'))).toBe(true)
    placed.value = field(true, false)
    await nextTick()
    expect(keys.isTabStop(foldTarget('O'))).toBe(true)
  })

  it('stays on a header target the keyboard stood on while its frame folds', async () => {
    const { keys, placed } = keyboard()
    keys.onFocus(foldTarget('I'))
    placed.value = field(false, true)
    await nextTick()
    expect(keys.isTabStop(foldTarget('I'))).toBe(true)
    keys.onFocus(frameTarget('O'))
    expect(keys.isTabStop(frameTarget('O'))).toBe(true)
  })

  it('is the anchor before the keyboard stood anywhere', () => {
    const { keys } = keyboard()
    expect(keys.isTabStop(foldTarget('O'))).toBe(true)
  })

  it('leaves a fold the overview hides for the anchor, and comes back to it at reading size', async () => {
    const { keys, overview, placed } = keyboard(frameTarget('O'))
    keys.onFocus('card')
    placed.value = field(false, true)
    await nextTick()
    expect(keys.isTabStop(foldTarget('I'))).toBe(true)
    // Zoomed out, the fold is hidden and takes no focus: the stop is the anchor.
    overview.value = true
    await nextTick()
    expect(keys.isTabStop(foldTarget('I'))).toBe(false)
    expect(keys.isTabStop(frameTarget('O'))).toBe(true)
    overview.value = false
    await nextTick()
    expect(keys.isTabStop(foldTarget('I'))).toBe(true)
  })

  it('gives way from a fold the overview hides to the epic button beside it, and back', async () => {
    const { keys, overview } = keyboard(frameTarget('I'))
    keys.onFocus(foldTarget('O'))
    await nextTick()
    expect(keys.isTabStop(foldTarget('O'))).toBe(true)
    overview.value = true
    await nextTick()
    // Not the anchor: the same header's other button.
    expect(keys.isTabStop(frameTarget('O'))).toBe(true)
    expect(keys.isTabStop(frameTarget('I'))).toBe(false)
    overview.value = false
    await nextTick()
    expect(keys.isTabStop(foldTarget('O'))).toBe(true)
  })
})
