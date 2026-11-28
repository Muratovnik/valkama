/**
 * The field's one Tab stop when frames fold: the target the keyboard stood on
 * while it is drawn, the fold of the frame that hid it once a fold took it off
 * the field, and the camera's anchor otherwise. And where focus lands when the
 * card hands the field over: on what it asked to see.
 */
import { effectScope, nextTick, ref } from 'vue'

import { afterEach, describe, expect, it, vi } from 'vitest'

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
    goal: { ...boardItem(1, 'backlog'), work_item_id: id },
    parentId,
    folded,
    foldable: true,
    x: 0,
    y: parentId ? 80 : 0,
    width: folded ? 288 : 640,
    height: folded ? 72 : 400,
    header: 72,
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

type KeyboardInput = Parameters<typeof useGraphKeyboard>[0]

function keyboard(anchor = foldTarget('O'), host: Partial<KeyboardInput> = {}) {
  const placed = ref<GraphLayout | null>(field(false, false))
  const overview = ref(false)
  const scope = effectScope()
  scopes.push(scope)
  const keys = scope.run(() =>
    useGraphKeyboard({
      anchorId: ref(anchor),
      arrivalId: ref(null),
      canvas: ref(null),
      fitted: ref(true),
      overview,
      placed,
      focusRequest: () => {},
      reveal: () => {},
      ...host,
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

  it('gives way from a fold the overview hides to the goal button beside it, and back', async () => {
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

describe('the field the card hands over', () => {
  const canvases: HTMLElement[] = []
  afterEach(() => {
    for (const canvas of canvases.splice(0)) canvas.remove()
  })

  /** The field's targets drawn as buttons the keyboard can take, in the page. */
  function canvasOf(ids: readonly string[]) {
    const canvas = document.createElement('div')
    for (const id of ids) {
      const button = document.createElement('button')
      button.dataset.walkTarget = id
      canvas.append(button)
    }
    document.body.append(canvas)
    canvases.push(canvas)
    return canvas
  }

  for (const [what, arrival, lands] of [
    // The camera still stands where it stood before it moved to the card's branch.
    [
      'gives focus to what the card asked to see, not the target the camera stood on',
      'card',
      'card',
    ],
    ['gives focus to the camera’s anchor when the card asked for nothing', null, foldTarget('O')],
  ] as const) {
    it(what, async () => {
      const request = ref(0)
      const revealed: number[] = []
      keyboard(foldTarget('O'), {
        arrivalId: ref(arrival),
        canvas: ref(canvasOf([foldTarget('O'), 'card'])),
        focusRequest: () => request.value,
        reveal: (box) => revealed.push(box.x),
      })
      request.value = 1
      await vi.waitFor(() => {
        const focused = document.activeElement
        expect(focused instanceof HTMLElement && focused.dataset.walkTarget).toBe(lands)
      })
      // The camera is sent to the target focus took, and to no other.
      expect(revealed).toEqual([lands === 'card' ? 16 : 0])
    })
  }

  for (const [what, moved, lands] of [
    ['follows what was asked for when it reaches the field after focus did', false, 'card'],
    ['leaves focus where the operator moved it when what was asked for comes later', true, 'fold'],
  ] as const) {
    it(what, async () => {
      const request = ref(0)
      const arrival = ref<string | null>(frameTarget('O'))
      const canvas = canvasOf([foldTarget('O'), frameTarget('O'), 'card'])
      keyboard(foldTarget('O'), {
        arrivalId: arrival,
        canvas: ref(canvas),
        focusRequest: () => request.value,
      })
      request.value = 1
      await vi.waitFor(() => expect(focusedTarget()).toBe(frameTarget('O')))
      if (moved) buttonIn(canvas, foldTarget('O'))?.focus()
      // The branch the card chose reaches the field only now.
      arrival.value = 'card'
      const expected = lands === 'card' ? 'card' : foldTarget('O')
      await vi.waitFor(() => expect(focusedTarget()).toBe(expected))
      // Time for a move the field should not make.
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(focusedTarget()).toBe(expected)
    })
  }

  for (const [what, opener, lands] of [
    // The card gives focus back to the header that opened it, out of the branch's sight.
    ['moves focus the card gave back to the field onto what it asked to see', 'field', 'card'],
    ['leaves focus the card gave back outside the field where it landed', 'page', 'page'],
  ] as const) {
    it(what, async () => {
      const request = ref(0)
      const canvas = canvasOf([foldTarget('O'), frameTarget('O'), 'card'])
      const page = canvasOf(['page'])
      keyboard(foldTarget('O'), {
        arrivalId: ref('card'),
        canvas: ref(canvas),
        focusRequest: () => request.value,
      })
      const back = opener === 'field' ? buttonIn(canvas, frameTarget('O')) : buttonIn(page, 'page')
      back?.focus()
      request.value = 1
      await nextTick()
      await vi.waitFor(() => expect(focusedTarget()).toBe(lands))
    })
  }
})

/** The target the focused button stands for, if any. */
function focusedTarget() {
  const focused = document.activeElement
  return focused instanceof HTMLElement ? focused.dataset.walkTarget : undefined
}

/** The button drawn for a target inside a container. */
function buttonIn(container: HTMLElement, id: string) {
  return container.querySelector<HTMLElement>(`[data-walk-target="${CSS.escape(id)}"]`)
}
