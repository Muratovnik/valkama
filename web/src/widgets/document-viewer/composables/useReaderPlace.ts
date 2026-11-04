/**
 * Where the reader is in a document drawn by one viewer, as the view asks for it: to come
 * back after a link, to stay put as the text changes under them, and to go on from the same
 * place in the viewer of another host. The line it comes to is where the editor opens.
 */
import { nextTick, onBeforeUnmount, onMounted } from 'vue'
import type { Ref, ShallowRef } from 'vue'

import type {
  DocumentView,
  ReaderPlace,
} from '@/widgets/document-viewer/composables/useDocumentView.ts'

import type { RichDocument } from '@/shared/lib/richText.ts'
import { suffixTarget } from '@/shared/lib/textReferences.ts'

/** What the viewer's text can say about its blocks. */
interface DocumentBlocks {
  box: (index: number) => HTMLElement | null
  indexOf: (element: Element) => number
  topIndex: (scroller: HTMLElement) => number
}

const nothing = () => {}

/** Whether any of a box stands in the scroller's window. */
function inView(box: HTMLElement | null, scroller: HTMLElement): boolean {
  if (!box) return false
  const shown = scroller.getBoundingClientRect()
  const { top, bottom } = box.getBoundingClientRect()
  return bottom > shown.top && top < shown.bottom
}

export function useReaderPlace(options: {
  anchorMissing: Ref<string>
  marked: ShallowRef<ReadonlySet<number>>
  parsed: Readonly<ShallowRef<RichDocument | null>>
  root: Ref<HTMLElement | null>
  scroller: Ref<HTMLElement | null>
  text: Readonly<Ref<DocumentBlocks | null>>
  view: DocumentView
  focusHead: () => void
}) {
  const { anchorMissing, marked, parsed, root, scroller, text, view } = options

  /**
   * Kept by the heading above the reader: what was added or cut above it then moves nothing
   * they are reading. Without a heading above them the scroller holds its own place, which
   * the browser keeps as the text changes under it.
   */
  function holdPlace(): () => void {
    const shown = parsed.value
    const body = scroller.value
    const blocks = text.value
    if (!shown || !body || !blocks) return nothing
    for (let index = blocks.topIndex(body); index >= 0; index--) {
      const entry = shown.blocks[index]
      const box = blocks.box(index)
      const anchor = entry?.block.kind === 'heading' ? entry.anchors.at(-1) : undefined
      if (anchor && box) {
        const past = body.scrollTop - box.offsetTop
        return () => {
          const at = parsed.value?.blocks.findIndex(({ anchors }) => anchors.includes(anchor)) ?? -1
          const found = at === -1 ? null : text.value?.box(at)
          if (found) scroller.value?.scrollTo({ top: found.offsetTop + past })
        }
      }
    }
    return nothing
  }

  /** The block at the scroller's top and how far down it, which outlasts a change of width. */
  function leavePlace(): ReaderPlace {
    const body = scroller.value
    const blocks = text.value
    const active = document.activeElement
    let focus: ReaderPlace['focus'] = 'outside'
    if (active && root.value?.contains(active)) {
      const holding = blocks?.indexOf(active) ?? -1
      focus = holding === -1 ? 'head' : holding
    }
    const block = body && blocks ? blocks.topIndex(body) : -1
    const box = block === -1 ? null : blocks?.box(block)
    const edge = body?.getBoundingClientRect().top ?? 0
    const measure = box?.getBoundingClientRect()
    const within = measure?.height ? (edge - measure.top) / measure.height : 0
    return { block, focus, marked: [...marked.value], missing: anchorMissing.value, within }
  }

  /** The reader as the host before this one left them, at this host's width. */
  async function takePlace(place: ReaderPlace) {
    marked.value = new Set(place.marked)
    anchorMissing.value = place.missing
    await nextTick()
    const body = scroller.value
    const box = place.block === -1 ? null : text.value?.box(place.block)
    if (body && box) {
      const measure = box.getBoundingClientRect()
      const top = measure.top - body.getBoundingClientRect().top
      body.scrollTop += top + place.within * measure.height
    }
    if (place.focus === 'head') options.focusHead()
    else if (typeof place.focus === 'number')
      text.value?.box(place.focus)?.focus({ preventScroll: true })
  }

  const detach = view.attachReader({
    hold: holdPlace,
    leave: leavePlace,
    position: () => scroller.value?.scrollTop ?? 0,
  })
  onBeforeUnmount(detach)
  onMounted(() => {
    const handed = view.takeOver()
    if (handed) void takePlace(handed)
  })

  /**
   * The source line the reader is at, for an editor to open on. A link that sent them to a
   * line or an anchor names it while the block it marked is still in view, even where the
   * text ends too soon for that block to reach the top; after that, the first line of the
   * top block in view is where they are. The block that starts above the edge may end above
   * it too, in the room before a heading, and then the reader is at the next one.
   */
  function lineAt(): number | null {
    const shown = parsed.value
    const body = scroller.value
    const blocks = text.value
    if (!shown || !body || !blocks) return null
    const sent = Math.min(...marked.value)
    if (Number.isFinite(sent) && inView(blocks.box(sent), body)) {
      const aim = suffixTarget(view.place.value?.suffix ?? '')
      return aim?.kind === 'lines' ? aim.first : (shown.blocks[sent]?.firstLine ?? null)
    }
    const top = blocks.topIndex(body)
    const read = inView(blocks.box(top), body) ? top : top + 1
    return (shown.blocks[read] ?? shown.blocks[top])?.firstLine ?? null
  }

  return { lineAt }
}
