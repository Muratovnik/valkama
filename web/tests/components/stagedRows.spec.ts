import { defineComponent, h, shallowRef } from 'vue'
import type { ShallowRef } from 'vue'

/**
 * A long list's first frame: what fills its height and the row with each
 * column's widest word, then every row. The widths a browser lays out are stood
 * in for here; that the columns really hold still is the browser suite's.
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useStagedRows } from '@/widgets/work-item-views/composables/useStagedRows.ts'

interface Row {
  id: number
  name: string
}

const makeRows = (count: number): Row[] =>
  Array.from({ length: count }, (_, index) => ({ id: index, name: 'x' }))

const drawNothing = () => h('div')

/** A list of `height` pixels, `rows` long, staged as it mounts. */
function staged(all: ShallowRef<readonly Row[]>, height: number) {
  const root = { clientHeight: height } as HTMLElement
  let list!: ReturnType<typeof useStagedRows<Row>>
  const wrapper = mount(
    defineComponent({
      setup() {
        list = useStagedRows<Row>({
          columns: [{ font: '--font-line', word: (row) => row.name }],
          root: () => root,
          rows: () => all.value,
        })
        list.stage()
        return drawNothing
      },
    }),
  )
  return { list, wrapper }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText: (text: string) => ({ width: text.length * 7 }),
  } as unknown as CanvasRenderingContext2D)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Past the frame the first rows are painted in. */
const nextFrame = () => vi.advanceTimersByTime(40)

describe('a long list drawn in two steps', () => {
  it('draws what fills its height, then every row in order', () => {
    const all = shallowRef(makeRows(500))
    const { list } = staged(all, 720)
    // Twenty rows of the shortest height fill it, and twelve lie beyond the fold.
    expect(list.rows.value).toHaveLength(32)
    expect(list.rows.value[0]).toBe(all.value[0])
    nextFrame()
    expect(list.rows.value).toEqual(all.value)
  })

  it('holds the row with a column widest word in the first frame, drawn for its widths', () => {
    const rows = makeRows(500)
    const widest = rows[400] as Row
    widest.name = 'the widest word of the column'
    const { list } = staged(shallowRef(rows), 720)
    expect(list.rows.value).toContain(widest)
    expect(list.held(widest)).toBe(true)
    expect(list.held(rows[0] as Row)).toBe(false)
    nextFrame()
    expect(list.held(widest)).toBe(false)
  })

  it('holds nothing extra when the widest word is already on screen', () => {
    const rows = makeRows(500)
    ;(rows[3] as Row).name = 'the widest word of the column'
    const { list } = staged(shallowRef(rows), 720)
    expect(list.rows.value).toHaveLength(32)
  })

  it('draws every row at once when they change before the rest arrived', async () => {
    const all = shallowRef<readonly Row[]>(makeRows(500))
    const { list } = staged(all, 720)
    expect(list.rows.value).toHaveLength(32)
    all.value = makeRows(400)
    await vi.advanceTimersByTimeAsync(0)
    expect(list.rows.value).toHaveLength(400)
  })

  it('draws a short list whole', () => {
    const all = shallowRef(makeRows(30))
    const { list } = staged(all, 720)
    expect(list.rows.value).toHaveLength(30)
  })

  it('draws every row at once where nothing is laid out', () => {
    const all = shallowRef(makeRows(500))
    const { list } = staged(all, 0)
    expect(list.rows.value).toHaveLength(500)
  })

  it('draws the rest in a window with no frames', () => {
    const frames = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1)
    const { list } = staged(shallowRef(makeRows(500)), 720)
    expect(frames).toHaveBeenCalled()
    expect(list.rows.value).toHaveLength(32)
    vi.advanceTimersByTime(300)
    expect(list.rows.value).toHaveLength(500)
  })

  it('leaves nothing behind when the list closes first', () => {
    const { list, wrapper } = staged(shallowRef(makeRows(500)), 720)
    wrapper.unmount()
    nextFrame()
    vi.advanceTimersByTime(300)
    expect(list.rows.value).toHaveLength(32)
  })
})
