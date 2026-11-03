/**
 * Which host the window's one document stands in, and how long: the surface it was opened
 * from answers for both.
 */
import { defineComponent, h, nextTick, ref } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAppDocuments } from '@/app/composables/useAppDocuments.ts'

import {
  createDocumentPanes,
  useDocumentPane,
} from '@/widgets/document-viewer/composables/useDocumentPanes.ts'
import { useDocumentView } from '@/widgets/document-viewer/composables/useDocumentView.ts'
import type { DocumentView } from '@/widgets/document-viewer/composables/useDocumentView.ts'

import { readDocument } from '@/shared/api/documentApi.ts'
import { i18n } from '@/shared/i18n/index.ts'

vi.mock('@/shared/api/documentApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/documentApi.ts')>()),
  readDocument: vi.fn(),
  resolveDocuments: vi.fn(),
}))

const TARGET = { project: 'demo', path: 'docs/plan.md', suffix: '' }
const FITS = { active: true, fits: true }

const mounted: ReturnType<typeof mount>[] = []
const NOTHING = () => {}
const NOTHING_HELD = () => NOTHING
const AT_NOTHING = () => 0
const CARD_TITLE = () => 'The card'
const NOTHING_BELOW = () => null

/** Runs a setup in a component, as a shell or a surface would, with what stands below it. */
const Part = defineComponent({
  props: {
    run: { type: Function, required: true },
    below: { type: Function, default: NOTHING_BELOW },
  },
  setup(props) {
    props.run()
    return () => props.below()
  },
})

function within(run: () => void, below: () => unknown = NOTHING_BELOW) {
  const wrapper = mount(Part, { props: { run, below }, global: { plugins: [i18n] } })
  mounted.push(wrapper)
}

/** The panes under a component, as the shell holds them. */
function shell() {
  let view: DocumentView | undefined
  let panes: ReturnType<typeof createDocumentPanes> | undefined
  within(() => {
    view = useDocumentView()
    panes = createDocumentPanes(view)
  })
  if (!view || !panes) throw new Error('No panes')
  return { panes, view }
}

beforeEach(() => {
  vi.mocked(readDocument).mockResolvedValue({
    project: 'demo',
    path: TARGET.path,
    markdown: '# The plan\n\nText.\n',
    size: 18,
    modified_at: '2026-11-03T15:12:09Z',
    revision: 'a'.repeat(16),
  })
})

afterEach(async () => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  await flushPromises()
})

describe('where a document stands', () => {
  it('beside the surface on top when it fits, and over it when it does not', async () => {
    const { panes } = shell()
    panes.stand('card', FITS)
    panes.open(TARGET)
    expect(panes.where.value).toBe('card')
    panes.stand('card', { active: true, fits: false })
    expect(panes.where.value).toBe('over')
    panes.stand('card', FITS)
    expect(panes.where.value).toBe('card')
    await flushPromises()
  })

  it('beside the questions when they lie over the card, whichever came first', async () => {
    const { panes } = shell()
    panes.stand('card', { active: false, fits: true })
    panes.stand('hub', FITS)
    panes.open(TARGET)
    expect(panes.where.value).toBe('hub')
    await flushPromises()
  })

  it('over a surface that is itself covered: by a dialog on it, say', async () => {
    const { panes } = shell()
    panes.stand('card', { active: false, fits: true })
    panes.open(TARGET)
    expect(panes.where.value).toBe('over')
    expect(panes.owned()).toBe(false)
    await flushPromises()
  })

  it('stays with the surface it was opened from while another comes and goes', async () => {
    const { panes, view } = shell()
    panes.stand('card', FITS)
    panes.open(TARGET)
    panes.stand('card', { active: false, fits: true })
    panes.stand('hub', FITS)
    expect(panes.where.value).toBe('card')
    panes.stand('hub', null)
    expect(panes.where.value).toBe('card')
    expect(view.place.value).not.toBeNull()
    await flushPromises()
  })

  it('goes when that surface goes, and only that one', async () => {
    const { panes, view } = shell()
    panes.stand('card', FITS)
    panes.stand('hub', { active: false, fits: true })
    panes.open(TARGET)
    panes.stand('hub', null)
    expect(view.place.value).not.toBeNull()
    panes.stand('card', null)
    expect(view.place.value).toBeNull()
    expect(panes.where.value).toBeNull()
    await flushPromises()
  })
})

describe('a host handed over', () => {
  it('asks the host being left where the reader is before the page changes', async () => {
    const { panes, view } = shell()
    panes.stand('card', FITS)
    panes.open(TARGET)
    await flushPromises()
    const place = { block: 4, focus: 2, marked: [2], missing: '', within: 0.5 }
    const leave = vi.fn(() => place)
    view.attachReader({ hold: NOTHING_HELD, leave, position: AT_NOTHING })

    panes.stand('card', { active: true, fits: false })
    await nextTick()
    expect(leave).toHaveBeenCalledOnce()
    expect(view.takeOver()).toBe(place)
    // Once: a later open has nothing to take over.
    expect(view.takeOver()).toBeNull()
  })

  it('leaves a reader that has already taken over alone when the old one detaches', async () => {
    const { panes, view } = shell()
    panes.stand('card', FITS)
    panes.open(TARGET)
    await flushPromises()
    const leavingPlace = { block: 1, focus: 'outside', marked: [], missing: '', within: 0 } as const
    const old = view.attachReader({
      hold: NOTHING_HELD,
      leave: () => ({ ...leavingPlace, block: 1 }),
      position: AT_NOTHING,
    })
    view.attachReader({
      hold: NOTHING_HELD,
      leave: () => ({ ...leavingPlace, block: 2 }),
      position: AT_NOTHING,
    })
    old()
    panes.stand('card', { active: true, fits: false })
    await nextTick()
    expect(view.takeOver()?.block).toBe(2)
  })

  it('does not ask on an open or a close, which leave nobody to tell', async () => {
    const { panes, view } = shell()
    const leave = vi.fn(() => null)
    view.attachReader({ hold: NOTHING_HELD, leave, position: AT_NOTHING })
    panes.stand('card', FITS)
    panes.open(TARGET)
    await flushPromises()
    view.close()
    await nextTick()
    expect(leave).not.toHaveBeenCalled()
  })
})

describe('what a surface is told', () => {
  it('with no shell above it there is no document to hold', () => {
    let held: ReturnType<typeof useDocumentPane> | undefined
    within(() => {
      held = useDocumentPane('card', CARD_TITLE)
    })
    expect(held?.view).toBeNull()
    expect(held?.pane).toBeNull()
  })
})

/** A shell with a surface below it, which stands for as long as it is mounted. */
function appDocuments() {
  const count = ref(0)
  let documents: ReturnType<typeof useAppDocuments> | undefined
  let held: ReturnType<typeof useDocumentPane> | undefined
  within(
    () => {
      documents = useAppDocuments([count])
    },
    () =>
      h(Part, {
        run: () => {
          held = useDocumentPane('card', CARD_TITLE)
        },
      }),
  )
  if (!documents || !held) throw new Error('No documents')
  return { documents, held, moved: () => (count.value += 1) }
}

describe('the shell’s own moves', () => {
  it('leave a document a surface answers for, and take one nothing answers for', async () => {
    const { documents, held, moved } = appDocuments()
    held.stand(FITS)
    documents.openDocument({ ...TARGET, line: null })
    await flushPromises()
    expect(held.pane?.main).toBe('The card')
    expect(held.pane?.label).toBe('Document: The plan')

    // A card to a card: the surface stays, and so does what is read beside it.
    moved()
    await flushPromises()
    expect(documents.documentView.place.value).not.toBeNull()

    // A surface covered when it opened answers for nothing, as a dialog over a card does.
    held.stand({ active: false, fits: true })
    documents.openDocument({ ...TARGET, line: null })
    await flushPromises()
    moved()
    await flushPromises()
    expect(documents.documentView.place.value).toBeNull()
  })
})
