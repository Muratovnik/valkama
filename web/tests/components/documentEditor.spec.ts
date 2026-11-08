/**
 * The viewer's head opens the document's own file in the editor, at the line the reader
 * is at: the one a link named while the block it marked is in view, and the first line of
 * the block at the top once the reader has moved on. A plan that refuses leaves the path
 * copied, and the shell's status line says why.
 *
 * jsdom lays nothing out, so the boxes stand where this spec puts them: the scroller is
 * 500 px tall, and each top block 80 px tall and 100 px under the one before, moved by
 * `scrollTop`.
 */
import { defineComponent, h, nextTick } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import DocumentDrawer from '@/widgets/document-viewer/components/DocumentDrawer.vue'
import { useDocumentView } from '@/widgets/document-viewer/composables/useDocumentView.ts'
import type { DocumentView } from '@/widgets/document-viewer/composables/useDocumentView.ts'

import { provideOpenNotice } from '@/features/session-open/openNotice.ts'

import { provideDocumentOpener } from '@/entities/project-document/documentLinks.ts'
import type { DocumentOpener } from '@/entities/project-document/documentLinks.ts'

import { i18n } from '@/shared/i18n/index.ts'

import {
  body,
  control,
  copied,
  disk,
  file,
  refused,
  viewerSuite,
} from '../support/documentViewer.ts'
import { hintOf } from '../support/hint.ts'

vi.mock('@/shared/api/documentApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/documentApi.ts')>()),
  readDocument: vi.fn(),
  resolveDocuments: vi.fn(),
}))

viewerSuite()

/* The source lines, counted by hand from 1: the second paragraph runs over lines 5 and 6,
   the heading with the anchor is line 10, «Six.» line 14. */
const PLAN = [
  '# The plan',
  '',
  'One.',
  '',
  'Two starts here',
  'and runs on.',
  '',
  'Three.',
  '',
  '## Four <!-- kb:four -->',
  '',
  'Five.',
  '',
  'Six.',
  '',
  'Seven.',
  '',
  'Eight.',
  '',
].join('\n')

const EDITOR = 'Open in VS Code'
const BLOCK = 100
const TALL = 80
const VIEW = 500

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 600,
    height,
    width: 600,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }
}

/** Every top block a hundred pixels under the one before, with room between them. */
function layOut() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains('document-body')) return rect(0, VIEW)
    if (!this.classList.contains('document-block')) return rect(0, 0)
    const siblings = [...(this.parentElement?.children ?? [])].filter((each) =>
      each.classList.contains('document-block'),
    )
    const scrolled = body()?.scrollTop ?? 0
    return rect(siblings.indexOf(this) * BLOCK - scrolled, TALL)
  })
}

const said = vi.fn()
const mounted: ReturnType<typeof mount>[] = []
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})
const openFile = vi.fn<NonNullable<DocumentOpener['openFile']>>(() => true)

async function shown(suffix = '', opener: Partial<DocumentOpener> = { openFile }) {
  let view: DocumentView | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        view = useDocumentView()
        provideDocumentOpener({ say: vi.fn(), editor: 'VS Code', ...opener })
        provideOpenNotice(said)
        const current = view
        return () => h(DocumentDrawer, { view: current })
      },
    }),
    { attachTo: document.body, global: { plugins: [i18n] } },
  )
  mounted.push(wrapper)
  await nextTick()
  view?.open({ project: 'demo', path: 'docs/plan.md', suffix })
  await flushPromises()
  await nextTick()
  return view
}

async function press() {
  control(EDITOR)?.click()
  await flushPromises()
}

/** An answer kept back until the spec lets it go. */
function held() {
  let settle: ((opened: boolean) => void) | undefined
  const promise = new Promise<boolean>((resolve) => {
    settle = resolve
  })
  return { promise, finish: (opened: boolean) => settle?.(opened) }
}

const lineSent = () => openFile.mock.calls.at(-1)?.[0].line

describe('the line the editor opens on', () => {
  beforeEach(() => {
    said.mockReset()
    openFile.mockReset()
    openFile.mockReturnValue(true)
    disk['docs/plan.md'] = file('docs/plan.md', PLAN)
    layOut()
  })

  it('is the line a link named, not the first of its block, while that block is in view', async () => {
    await shown(':6')
    await press()
    expect(openFile).toHaveBeenCalledExactlyOnceWith({
      project: 'demo',
      path: 'docs/plan.md',
      suffix: '',
      line: 6,
    })
  })

  it('is the line of the block an anchor marked, even where that block is not the top', async () => {
    await shown('#kb:four')
    await press()
    expect(lineSent()).toBe(10)
  })

  it('is the first line of the block at the top once the named one is out of view', async () => {
    await shown(':6')
    const scroller = body()
    if (!scroller) throw new Error('No body')
    scroller.scrollTop = 6 * BLOCK
    await press()
    expect(lineSent()).toBe(14)
  })

  it('is the top block’s with no link behind it, the start included', async () => {
    await shown()
    await press()
    expect(lineSent()).toBe(1)
    const scroller = body()
    if (!scroller) throw new Error('No body')
    scroller.scrollTop = 2 * BLOCK + 40
    await press()
    expect(lineSent()).toBe(5)
  })

  it('is not a block that starts above the edge and ends there too, but the next', async () => {
    await shown()
    const scroller = body()
    if (!scroller) throw new Error('No body')
    // «Two» runs from -90 to -10, wholly gone; «Three» starts 10 px down.
    scroller.scrollTop = 3 * BLOCK - 10
    await press()
    expect(lineSent()).toBe(8)
  })
})

describe('what a press comes to', () => {
  beforeEach(() => {
    said.mockReset()
    openFile.mockReset()
    disk['docs/plan.md'] = file('docs/plan.md', PLAN)
    layOut()
  })

  it('opened: the opener says so, and nothing is copied', async () => {
    openFile.mockReturnValue(true)
    await shown()
    expect(hintOf(control(EDITOR))).toBe('Open this file in VS Code at the line you are reading')
    await press()
    expect(copied).not.toHaveBeenCalled()
    expect(said).not.toHaveBeenCalled()
  })

  it('refused: the path is copied and the shell says why, in its own words', async () => {
    openFile.mockResolvedValue('Nothing is there.')
    await shown()
    await press()
    expect(copied).toHaveBeenCalledExactlyOnceWith('docs/plan.md')
    expect(said).toHaveBeenCalledExactlyOnceWith('Nothing is there. The path was copied', 'refused')
  })

  it('failed with no reason: the path is copied and the shell says only that', async () => {
    openFile.mockImplementation(() => {
      throw new Error('gone')
    })
    await shown()
    await press()
    expect(copied).toHaveBeenCalledExactlyOnceWith('docs/plan.md')
    expect(said).toHaveBeenCalledExactlyOnceWith(
      'Could not open it, so the path was copied',
      'refused',
    )
  })

  it('takes no second press while the first is out, and is busy meanwhile', async () => {
    const { promise, finish } = held()
    openFile.mockReturnValue(promise)
    await shown()
    control(EDITOR)?.click()
    await nextTick()
    expect(control(EDITOR)?.getAttribute('aria-busy')).toBe('true')
    control(EDITOR)?.click()
    finish(true)
    await flushPromises()
    expect(openFile).toHaveBeenCalledTimes(1)
    expect(control(EDITOR)?.hasAttribute('aria-busy')).toBe(false)
  })
})

describe('where it is offered', () => {
  beforeEach(() => {
    openFile.mockReset()
  })

  it('not where nothing here opens a file', async () => {
    disk['docs/plan.md'] = file('docs/plan.md', PLAN)
    await shown('', {})
    expect(control('Refresh')).toBeDefined()
    expect(control(EDITOR)).toBeUndefined()
  })

  it.each([
    ['too large', refused(413, 'too_large', { size: 600 * 1024 })],
    ['not UTF-8', refused(422, 'not_utf8')],
    ['not text', refused(422, 'binary')],
  ])('for a file the viewer cannot show, %s, at no line', async (_name, refusal) => {
    disk['docs/plan.md'] = refusal
    await shown()
    await press()
    expect(lineSent()).toBeNull()
  })

  it.each([
    ['gone', refused(404, 'not_found')],
    ['outside the project', refused(403, 'outside_root')],
  ])('not for a file that is %s', async (_name, refusal) => {
    disk['docs/plan.md'] = refusal
    await shown()
    expect(control('Close the document')).toBeDefined()
    expect(control(EDITOR)).toBeUndefined()
  })

  it('not once the file was deleted under the text', async () => {
    disk['docs/plan.md'] = file('docs/plan.md', PLAN)
    await shown()
    expect(control(EDITOR)).toBeDefined()
    disk['docs/plan.md'] = refused(404, 'not_found')
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    await nextTick()
    expect(control(EDITOR)).toBeUndefined()
  })
})
