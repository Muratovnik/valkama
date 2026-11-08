import { defineComponent, h, nextTick } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import DocumentViewer from '@/widgets/document-viewer/components/DocumentViewer.vue'
import { useDocumentView } from '@/widgets/document-viewer/composables/useDocumentView.ts'

import { i18n } from '@/shared/i18n/index.ts'

import {
  control,
  disk,
  file,
  opened,
  refused,
  surface,
  viewerSuite,
} from '../support/documentViewer.ts'
import { hintOf } from '../support/hint.ts'

vi.mock('@/shared/api/documentApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/documentApi.ts')>()),
  readDocument: vi.fn(),
  resolveDocuments: vi.fn(),
}))

viewerSuite()

const NEW_WINDOW = 'Open in a new window'
const comeBack = async () => {
  window.dispatchEvent(new Event('focus'))
  await flushPromises()
  await nextTick()
}

async function page(path = 'docs/plan.md') {
  const wrapper = mount(
    defineComponent({
      setup() {
        const view = useDocumentView()
        view.open({ project: 'demo', path, suffix: '' })
        return () => h(DocumentViewer, { view, page: true })
      },
    }),
    { attachTo: document.body, global: { plugins: [i18n] } },
  )
  await flushPromises()
  await nextTick()
  return wrapper
}
const named = (wrapper: ReturnType<typeof mount>, name: string) =>
  wrapper.find(`button[aria-label="${name}"]`).exists()

describe('another window for a document', () => {
  it('opens its own page, cut off from this one, and the document closes here', async () => {
    disk['docs/plan.md'] = file('docs/plan.md', '# The plan\n')
    const open = vi.fn()
    vi.stubGlobal('open', open)
    const view = await opened('docs/plan.md', ':42-50')
    control(NEW_WINDOW)?.click()
    expect(open).toHaveBeenCalledExactlyOnceWith(
      '/doc?project=demo&path=docs%2Fplan.md#L42-L50',
      '_blank',
      'noopener',
    )
    expect(view.place.value).toBeNull()
  })

  it('says what it does in its name and its tooltip', async () => {
    disk['docs/plan.md'] = file('docs/plan.md', '# The plan\n')
    await opened()
    expect(hintOf(control(NEW_WINDOW))).toBe(NEW_WINDOW)
  })

  it('is not there while the document cannot be shown', async () => {
    disk['docs/plan.md'] = refused(415, 'not_utf8')
    await opened()
    expect(control(NEW_WINDOW)).toBeUndefined()
  })

  it('goes when the text on screen is no longer the file', async () => {
    disk['docs/plan.md'] = file('docs/plan.md', '# The plan\n')
    const view = await opened()
    expect(control(NEW_WINDOW)).toBeDefined()
    disk['docs/plan.md'] = refused(404, 'not_found')
    await comeBack()
    expect(view.staleness.value?.kind).toBe('deleted')
    expect(control(NEW_WINDOW)).toBeUndefined()
  })
})

describe('the viewer as a page of its own', () => {
  it('stands in no drawer, offers no way out and names the tab', async () => {
    disk['docs/plan.md'] = file('docs/plan.md', '# The plan\n\nA line.\n')
    const wrapper = await page()
    expect(surface()).toBeNull()
    expect(wrapper.find('.overlay-header-close').exists()).toBe(false)
    expect(named(wrapper, NEW_WINDOW)).toBe(false)
    expect(named(wrapper, 'Refresh')).toBe(true)
    expect(document.title).toBe('The plan')
    wrapper.unmount()
  })

  it('says why it refuses in its own place, and offers again only what could change', async () => {
    disk['docs/plan.md'] = refused(403, 'outside_root')
    const refusal = await page()
    expect(refusal.text()).toContain('The file is outside the project')
    expect(refusal.find('.overlay-header-close').exists()).toBe(false)
    expect(named(refusal, 'Refresh')).toBe(false)
    refusal.unmount()

    disk['docs/plan.md'] = new Error('The connection went away')
    const unreachable = await page()
    expect(unreachable.text()).toContain('Could not read the document')
    expect(named(unreachable, 'Refresh')).toBe(true)
    unreachable.unmount()
  })
})
