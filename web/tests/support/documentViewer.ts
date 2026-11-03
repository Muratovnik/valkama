/**
 * The viewer under its real parts, with the server mocked at its two calls. A spec holds
 * the mock itself (`vi.mock('@/shared/api/documentApi.ts', ...)`) and fills `disk`, what
 * a read finds, and `known`, what a resolve says of a path.
 */
import { defineComponent, h, nextTick } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, vi } from 'vitest'

import DocumentDrawer from '@/widgets/document-viewer/components/DocumentDrawer.vue'
import { useDocumentView } from '@/widgets/document-viewer/composables/useDocumentView.ts'
import type { DocumentView } from '@/widgets/document-viewer/composables/useDocumentView.ts'

import { provideDocumentOpener } from '@/entities/project-document/documentLinks.ts'
import type { DocumentOpener } from '@/entities/project-document/documentLinks.ts'

import { DocumentRefusal, readDocument, resolveDocuments } from '@/shared/api/documentApi.ts'
import type { ProjectDocument, ResolvedPath } from '@/shared/api/documentApi.ts'
import { i18n } from '@/shared/i18n/index.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import type { ReferenceLink } from '@/shared/lib/referenceLinks.ts'

export const read = vi.mocked(readDocument)
export const resolve = vi.mocked(resolveDocuments)

export function file(path: string, markdown: string, revision = 'a'.repeat(16)): ProjectDocument {
  return {
    project: 'demo',
    path,
    markdown,
    size: markdown.length,
    modified_at: '2026-11-03T15:12:09Z',
    revision,
  }
}

export const refused = (status: number, code: string, more: { size?: number } = {}) =>
  new DocumentRefusal(status, { code, ...more } as ConstructorParameters<typeof DocumentRefusal>[1])

export const disk: Record<string, ProjectDocument | Error> = {}
export const known: Record<string, object> = {}
export const scrolledInto: Element[] = []
export const copied = vi.fn((_text: string) => Promise.resolve())
const mounted: ReturnType<typeof mount>[] = []

const emptied = (record: Record<string, unknown>) => {
  for (const key of Object.keys(record)) Reflect.deleteProperty(record, key)
}

/** Each test of the spec that calls this starts from an empty disk and a closed viewer. */
export function viewerSuite() {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
    emptied(disk)
    emptied(known)
    read.mockReset()
    resolve.mockReset()
    read.mockImplementation((_project, path) => {
      const held = disk[path]
      if (held === undefined) return Promise.reject(refused(404, 'not_found'))
      return held instanceof Error ? Promise.reject(held) : Promise.resolve(held)
    })
    resolve.mockImplementation((_base, paths) =>
      Promise.resolve(
        paths.map((path) => ({ path, ...(known[path] ?? { status: 'missing' }) }) as ResolvedPath),
      ),
    )
    scrolledInto.length = 0
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolledInto.push(this)
    }
    copied.mockClear()
    vi.stubGlobal('navigator', { clipboard: { writeText: copied } })
  })

  afterEach(async () => {
    Reflect.deleteProperty(HTMLElement.prototype, 'offsetTop')
    for (const wrapper of mounted.splice(0)) wrapper.unmount()
    await flushPromises()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.style.overflow = ''
  })
}

export async function viewer(parent?: () => ReferenceLink | null, opener?: DocumentOpener) {
  let view: DocumentView | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        view = useDocumentView()
        if (parent) provideReferenceLinks(parent)
        if (opener) provideDocumentOpener(opener)
        const shown = view
        return () => h(DocumentDrawer, { view: shown })
      },
    }),
    { attachTo: document.body, global: { plugins: [i18n] } },
  )
  mounted.push(wrapper)
  await nextTick()
  if (!view) throw new Error('No view')
  return view
}

export const surface = () => document.querySelector<HTMLElement>('.document-drawer')
export const status = () => surface()?.querySelector('[role="status"]')?.textContent?.trim() ?? ''
export const blocks = () => [...(surface()?.querySelectorAll<HTMLElement>('.document-block') ?? [])]
export const body = () => surface()?.querySelector<HTMLElement>('.document-body')

export function control(name: string) {
  return [...(surface()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (button) => button.getAttribute('aria-label') === name || button.textContent?.trim() === name,
  )
}

export async function opened(path = 'docs/plan.md', suffix = '') {
  const view = await viewer()
  view.open({ project: 'demo', path, suffix })
  await flushPromises()
  await nextTick()
  return view
}
