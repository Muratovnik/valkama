/**
 * What one window shows of a project's Markdown: which document, its text, and
 * the places a reader came through to reach it.
 *
 * One per window, above every host that draws it, so the host can change — over a
 * card or beside it — without the place or Back going with it, and with no second
 * parse of the text. Where a document stands on screen is the viewer's to say, and
 * it is asked for that place when a link leaves it behind or a host hands it over.
 */
import { computed, nextTick, ref, shallowRef } from 'vue'

import { useEventListener } from '@vueuse/core'

import { useFocusRight } from '@/widgets/document-viewer/composables/useFocusRight.ts'

import { DocumentRefusal, readDocument } from '@/shared/api/documentApi.ts'
import type { ProjectDocument } from '@/shared/api/documentApi.ts'
import { inlineWords, parseRichDocument } from '@/shared/lib/richText.ts'
import type { RichDocument } from '@/shared/lib/richText.ts'

/** A document and where in it, as the server names it and a link wrote the suffix. */
export interface DocumentPlace {
  path: string
  project: string
  suffix: string
}

/** Why there is no text to show, each with its own words. */
export type DocumentFailure =
  | { kind: 'binary' | 'missing' | 'notUtf8' | 'outside' | 'refused' | 'unknownProject' }
  | { kind: 'tooLarge'; size: number }
  | { kind: 'unreachable' }

/** What happened to a text already shown, when it was read again. */
type Staleness = { at: string; kind: 'changed' } | { kind: 'deleted' } | { kind: 'unreachable' }

/**
 * Where the viewer is to put the reader once a text is drawn: at a suffix, or back at a
 * place left for a link. `serial` makes the same request twice two requests.
 */
export type Placement =
  | { kind: 'scroll'; link: HeldLink | null; serial: number; top: number }
  | { kind: 'suffix'; serial: number; suffix: string }

/**
 * A control in the text by where it stands, since the element goes with the text: the top
 * block that holds it and its place among that block's controls.
 */
export interface HeldLink {
  block: number
  nth: number
}

/** What one host's viewer gives the next: the reader's place, as the text itself knows it. */
export interface ReaderPlace {
  /** The block at the top of the scroller, or -1 with none. */
  block: number
  /** Where focus was: a block, the head, or outside the viewer. */
  focus: number | 'head' | 'outside'
  /** The blocks a suffix marked. */
  marked: readonly number[]
  /** What the viewer says of an anchor it could not find. */
  missing: string
  /** How far down that block its top edge stands, as a share of its height. */
  within: number
}

/** What only the viewer can say about the reader, who is on the page and not in here. */
export interface DocumentReader {
  /** Notes where the reader is, and gives back how to return them after the text changes. */
  hold: () => () => void
  /** Says where the reader is, for the viewer about to take over in another host. */
  leave: () => ReaderPlace | null
  /** The control in the text that holds focus, if one does. */
  link: () => HeldLink | null
  /** Where the text is scrolled to. */
  position: () => number
}

const NOTHING_HELD = () => {}
const NOBODY: DocumentReader = {
  hold: () => NOTHING_HELD,
  leave: () => null,
  link: () => null,
  position: () => 0,
}

interface Visit {
  /** The link that took the reader on, which Back gives focus to again. */
  link: HeldLink | null
  place: DocumentPlace
  /** Where the reader had scrolled it to when a link took them on. */
  top: number
}

function failureOf(error: unknown): DocumentFailure {
  if (!(error instanceof DocumentRefusal) || error.status >= 500) return { kind: 'unreachable' }
  switch (error.code) {
    case 'not_found': {
      return { kind: 'missing' }
    }
    case 'too_large': {
      return { kind: 'tooLarge', size: error.size ?? 0 }
    }
    case 'not_utf8': {
      return { kind: 'notUtf8' }
    }
    case 'binary': {
      return { kind: 'binary' }
    }
    case 'project_unknown': {
      return { kind: 'unknownProject' }
    }
    case 'outside_root': {
      return { kind: 'outside' }
    }
    default: {
      return { kind: 'refused' }
    }
  }
}

const samePlace = (one: DocumentPlace, other: DocumentPlace) =>
  one.project === other.project && one.path === other.path

export function useDocumentView() {
  const place = shallowRef<DocumentPlace | null>(null)
  const document = shallowRef<ProjectDocument | null>(null)
  const failure = shallowRef<DocumentFailure | null>(null)
  const staleness = shallowRef<Staleness | null>(null)
  const loading = ref(false)
  const visits = shallowRef<readonly Visit[]>([])
  const placement = shallowRef<Placement>({ kind: 'scroll', link: null, serial: 0, top: 0 })
  let reader = NOBODY
  let handedOver: ReaderPlace | null = null
  /** The link a document was opened from, which focus goes back to when it closes. */
  let openedFrom: HTMLElement | null = null
  /** Each read is numbered, so an answer that arrives after a newer request is dropped. */
  let reading = 0
  const focusRight = useFocusRight()

  const toSuffix = (suffix: string) => {
    placement.value = { kind: 'suffix', serial: placement.value.serial + 1, suffix }
  }

  async function read(target: DocumentPlace, then: () => void) {
    const serial = ++reading
    place.value = target
    document.value = null
    failure.value = null
    staleness.value = null
    loading.value = true
    try {
      const text = await readDocument(target.project, target.path)
      if (serial !== reading) return
      document.value = text
      then()
    } catch (error) {
      if (serial === reading) {
        failure.value = failureOf(error)
        focusRight.spend()
      }
    } finally {
      if (serial === reading) loading.value = false
    }
  }

  /** From a text outside the viewer: a new reading, with nothing to go back to. */
  function open(target: DocumentPlace) {
    const focused = globalThis.document.activeElement
    openedFrom = focused instanceof HTMLElement ? focused : null
    visits.value = []
    focusRight.give()
    void read(target, () => toSuffix(target.suffix))
  }

  /**
   * From a link inside the document. The same document only moves to the suffix; another
   * leaves the place the reader was at behind them, for Back.
   */
  function go(target: DocumentPlace) {
    focusRight.give()
    const current = place.value
    if (current && samePlace(current, target) && document.value) {
      place.value = target
      toSuffix(target.suffix)
      return
    }
    if (current)
      visits.value = [
        ...visits.value,
        { link: reader.link(), place: current, top: reader.position() },
      ]
    void read(target, () => toSuffix(target.suffix))
  }

  function back() {
    const visit = visits.value.at(-1)
    if (!visit) return
    visits.value = visits.value.slice(0, -1)
    focusRight.give()
    void read(visit.place, () => {
      const serial = placement.value.serial + 1
      placement.value = { kind: 'scroll', link: visit.link, serial, top: visit.top }
    })
  }

  function close() {
    reading++
    focusRight.spend()
    place.value = null
    document.value = null
    failure.value = null
    staleness.value = null
    loading.value = false
    visits.value = []
    const link = openedFrom
    openedFrom = null
    void nextTick(() => {
      if (link?.isConnected) link.focus()
    })
  }

  /**
   * A refusal already drawn stays until the answer: read again on the window's return, this
   * state went through loading first, and every return flashed the waiting panel over words
   * that were still true.
   */
  async function readAgainFromFailure(target: DocumentPlace, serial: number) {
    try {
      const text = await readDocument(target.project, target.path)
      if (serial !== reading) return
      document.value = text
      failure.value = null
      toSuffix(target.suffix)
    } catch (error) {
      if (serial === reading) failure.value = failureOf(error)
    }
  }

  /**
   * Read the shown document again: on «Refresh», and when the window comes back. A text
   * that has not changed is not drawn again; one that has is drawn where the reader was.
   */
  async function refresh() {
    const target = place.value
    if (!target || loading.value) return
    const serial = ++reading
    if (!document.value) {
      await readAgainFromFailure(target, serial)
      return
    }
    try {
      const text = await readDocument(target.project, target.path)
      if (serial !== reading) return
      if (text.revision === document.value.revision) {
        if (staleness.value?.kind !== 'changed') staleness.value = null
        return
      }
      const restore = reader.hold()
      document.value = text
      staleness.value = { kind: 'changed', at: text.modified_at }
      await nextTick()
      restore()
    } catch (error) {
      if (serial !== reading) return
      const failed = failureOf(error)
      if (failed.kind === 'missing') staleness.value = { kind: 'deleted' }
      else if (failed.kind === 'unreachable') staleness.value = { kind: 'unreachable' }
      else {
        // The text a line of change spoke of is gone with it: what stands now is the refusal.
        document.value = null
        staleness.value = null
        failure.value = failed
      }
    }
  }

  // The file may have been edited while the reader was in another window. No watcher on
  // the disk: coming back is when the reader looks, as a card is read again then too.
  const comeBack = () => void refresh()
  useEventListener(window, 'focus', comeBack)
  useEventListener(globalThis.document, 'visibilitychange', () => {
    if (globalThis.document.visibilityState === 'visible') comeBack()
  })

  const parsed = computed<RichDocument | null>(() => {
    const file = document.value
    return file ? parseRichDocument(file.markdown, { base: file.path }) : null
  })

  return {
    back,
    close,
    document,
    failure,
    go,
    loading,
    open,
    parsed,
    place,
    placement,
    refresh,
    staleness,
    focusRight,
    canGoBack: computed(() => visits.value.length > 0),
    /**
     * The viewer answers for the reader, for a place a link or a new text leaves behind.
     * Gives back how to stop: the next host's viewer may have taken over by then.
     */
    attachReader(next: DocumentReader) {
      reader = next
      return () => {
        if (reader === next) reader = NOBODY
      }
    },
    /** The host is about to change, while the one being left can still say where the reader is. */
    handOver() {
      handedOver = reader.leave()
    },
    /** What the host before this one said of the reader, once. */
    takeOver() {
      const place_ = handedOver
      handedOver = null
      return place_
    },
    /** The first `#` of the file, without a comment in it; else its name. */
    title: computed(() => {
      const first = parsed.value?.blocks.find(
        ({ block }) => block.kind === 'heading' && block.level === 2,
      )
      const words = first?.block.kind === 'heading' ? inlineWords(first.block.children).trim() : ''
      return words || (place.value?.path.split('/').at(-1) ?? '')
    }),
    /** Where Back goes, for its name. */
    previous: computed(() => visits.value.at(-1)?.place ?? null),
  }
}

export type DocumentView = ReturnType<typeof useDocumentView>
